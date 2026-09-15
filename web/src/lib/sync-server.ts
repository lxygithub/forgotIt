// 「记不住」同步引擎（服务端）
// 对应文档 v2.0 第 6.4/6.5 节：/sync/push（批量 upsert + version）、/sync/pull（since 游标）、
// LWW 冲突解决（D6）：以 updated_at 为准，落败方保留为 ConflictSnapshot 快照（防数据丢失底线）
// local_only 笔记：入队前过滤 + 服务端拒收（文档：永不出本地）

import { db } from '@/lib/db';
import { serializeNote, noteInclude } from '@/lib/note-repo';
import { indexNoteAsync } from '@/lib/embedding';

export type SyncOp = 'upsert' | 'delete';
export type SyncStatus = 'applied' | 'conflict' | 'local-only-skipped' | 'invalid';

export interface PushChange {
  entity: 'note';
  op: SyncOp;
  data: {
    id?: string;
    title?: string | null;
    content?: string | null;
    summary?: string | null;
    semanticKeywords?: string | null;
    pinned?: boolean;
    localOnly?: boolean;
    type?: string;
    deletedAt?: string | null;
    updatedAt: string; // 客户端最后修改时间（LWW 依据）
    baseVersion?: number;
    newVersion?: number;
  };
}

export interface PushResult {
  id: string; // 客户端提供的临时 id 或服务端 id
  noteId?: string;
  status: SyncStatus;
  note?: ReturnType<typeof serializeNote>; // 冲突/应用后的服务端快照
}

/** 写同步流水（pull 增量游标依据） */
export async function logSync(entityType: string, entityId: string, op: SyncOp, deviceId?: string): Promise<void> {
  await db.syncLog.create({ data: { entityType, entityId, op, deviceId: deviceId ?? null } }).catch(() => undefined);
}

function parseKeywords(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? JSON.stringify(arr) : null;
  } catch {
    return null;
  }
}

/** LWW：a 晚于 b 返回 true（客户端时间戳优先，等值时服务端获胜防抖动） */
function isNewer(aMs: number, bMs: number): boolean {
  return aMs > bMs;
}

/** 应用一条 push 变更（LWW） */
export async function applyPushChange(change: PushChange, deviceId: string): Promise<PushResult> {
  const clientId = change.data.id ?? '';
  if (change.entity !== 'note' || !change.data?.updatedAt) {
    return { id: clientId, status: 'invalid' };
  }

  // local_only 永不出本地（文档 6.5）
  if (change.data.localOnly) {
    return { id: clientId, status: 'local-only-skipped' };
  }

  const incomingAt = new Date(change.data.updatedAt);
  const incomingMs = incomingAt.getTime();
  if (Number.isNaN(incomingMs)) return { id: clientId, status: 'invalid' };

  const existing = clientId ? await db.note.findUnique({ where: { id: clientId } }) : null;

  const buildData = (version: number) => ({
    title: change.data.title ?? null,
    content: change.data.content ?? null,
    summary: change.data.summary ?? null,
    semanticKeywords: parseKeywords(change.data.semanticKeywords),
    pinned: Boolean(change.data.pinned),
    localOnly: false,
    ...(change.op === 'delete' ? { deletedAt: incomingAt, pinned: false } : { deletedAt: null }),
    type: ['text', 'image', 'mixed'].includes(change.data.type ?? '') ? change.data.type : undefined,
    version,
  });

  // 1) 服务端不存在 → 直接落库（离线新建的笔记）
  if (!existing) {
    const created = await db.note.create({
      data: {
        ...(clientId ? { id: clientId } : {}),
        ...buildData(change.data.newVersion ?? 1),
        updatedAt: incomingAt,
      },
    });
    await logSync('note', created.id, change.op, deviceId);
    indexNoteAsync(created.id);
    const full = await db.note.findUnique({ where: { id: created.id }, include: noteInclude });
    return { id: clientId, noteId: created.id, status: 'applied', note: serializeNote(full!) };
  }

  // 2) LWW：进入方更新 → 覆盖服务端
  const serverMs = existing.updatedAt.getTime();
  if (isNewer(incomingMs, serverMs)) {
    const nextVersion = Math.max(existing.version, change.data.baseVersion ?? 0) + 1;
    const updated = await db.note.update({
      where: { id: existing.id },
      data: { ...buildData(nextVersion), updatedAt: incomingAt },
    });
    await logSync('note', existing.id, change.op, deviceId);
    if (change.op === 'upsert') indexNoteAsync(existing.id);
    const full = await db.note.findUnique({ where: { id: existing.id }, include: noteInclude });
    return { id: clientId, noteId: existing.id, status: 'applied', note: serializeNote(full!) };
  }

  // 3) 服务端更新 → 冲突，落败方存快照（文档 6.5：变更不丢弃）
  await db.conflictSnapshot.create({
    data: {
      noteId: existing.id,
      losingDevice: deviceId,
      losingPayload: JSON.stringify({ ...change.data, op: change.op }),
      losingUpdatedAt: incomingAt,
      winnerUpdatedAt: existing.updatedAt,
    },
  });
  const full = await db.note.findUnique({ where: { id: existing.id }, include: noteInclude });
  return { id: clientId, noteId: existing.id, status: 'conflict', note: serializeNote(full!) };
}

/** 拉取自 seq 之后的变更（按实体去重，返回最新快照；local_only 不同步） */
export async function pullChanges(sinceSeq: number, take = 200) {
  const events = await db.syncLog.findMany({
    where: { seq: { gt: sinceSeq } },
    orderBy: { seq: 'asc' },
    take,
  });
  if (events.length === 0) return { cursor: sinceSeq, changes: [] };

  const latest = new Map<string, (typeof events)[number]>();
  for (const ev of events) latest.set(ev.entityId, ev);

  const ids = [...latest.keys()];
  const notes = await db.note.findMany({
    where: { id: { in: ids }, localOnly: false },
    include: { ...noteInclude, attachments: true },
  });
  const byId = new Map(notes.map((n) => [n.id, n]));

  const changes = [...latest.entries()]
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([entityId, ev]) => {
      const note = byId.get(entityId);
      return {
        seq: ev.seq,
        op: note ? 'upsert' : 'delete', // 彻底删除后查不到实体 → 下发删除指令
        entityId,
        note: note ? serializeNote(note) : null,
      };
    });

  return { cursor: events[events.length - 1]!.seq, changes };
}
