// 「记不住」同步引擎（服务端）
// 对应文档 v2.0 第 6.4/6.5 节：/sync/push（批量 upsert + version）、/sync/pull（since 游标）、
// LWW 冲突解决（D6）：以 updated_at 为准，落败方保留为 ConflictSnapshot 快照（防数据丢失底线）
// local_only 笔记：入队前过滤 + 服务端拒收（文档：永不出本地）
//
// 【2026-09 迁移 PostgreSQL 后的变更】
// seq 不再用数据库自增，改由 SyncCounter 单行表在写事务内分配 —— 见 logSyncInTx 的说明。

import { db } from '@/lib/db';
import { serializeNote, noteInclude } from '@/lib/note-repo';
import { indexNoteAsync } from '@/lib/embedding';
import type { Prisma } from '@prisma/client';

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

const SYNC_COUNTER_ID = 1;

/**
 * 在调用方的事务内写同步流水（pull 增量游标依据），并返回分配到的 seq。
 *
 * 为什么必须放在事务里：PostgreSQL 的序列分配不参与事务。若用 serial，事务 A 拿到
 * seq=5、事务 B 拿到 seq=6，B 先提交时 pull 端会读到 6 并把游标推过 5，
 * 于是 A 提交后 seq=5 这条变更永远不会下发。
 *
 * 这里改为 UPDATE SyncCounter（单行）取号：该 UPDATE 会持有行锁直到事务提交，
 * 所有写者被迫串行化，于是「拿到号的顺序」就等于「提交顺序」，
 * pull 端以窗口内最大 seq 作为游标才是安全的。
 *
 * 注：只要没有写操作，SyncCounter 就不会被更新，因此读多写少的场景无额外开销。
 */
export async function logSyncInTx(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  op: SyncOp,
  deviceId?: string
): Promise<number> {
  const counter = await tx.syncCounter.update({
    where: { id: SYNC_COUNTER_ID },
    data: { value: { increment: 1 } },
    select: { value: true },
  });
  await tx.syncLog.create({
    data: {
      seq: counter.value,
      entityType,
      entityId,
      op,
      deviceId: deviceId ?? null,
    },
  });
  return counter.value;
}

/** 事务外写流水（供未包事务的调用方使用；内部自建事务以保证 seq 分配语义一致） */
export async function logSync(
  entityType: string,
  entityId: string,
  op: SyncOp,
  deviceId?: string
): Promise<void> {
  await db.$transaction(
    (tx) => logSyncInTx(tx, entityType, entityId, op, deviceId),
    { timeout: 15000 }
  );
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

/** 应用一条 push 变更（LWW）。整个写入 + 流水在同一事务内完成。 */
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

  const buildData = (version: number) => ({
    title: change.data.title ?? null,
    content: change.data.content ?? null,
    summary: change.data.summary ?? null,
    semanticKeywords: parseKeywords(change.data.semanticKeywords),
    localOnly: false,
    // 删除时顺带取消置顶（回收站里的笔记不该再占据置顶位）
    pinned: change.op === 'delete' ? false : Boolean(change.data.pinned),
    deletedAt: change.op === 'delete' ? incomingAt : null,
    type: ['text', 'image', 'mixed'].includes(change.data.type ?? '') ? change.data.type : undefined,
    version,
  });

  // 笔记写入与流水写入必须原子：否则流水写失败会静默丢掉一次可见变更，
  // 而笔记却已落库（pull 端永远看不到）。
  const { indexTarget, result } = await db.$transaction(
    async (tx): Promise<{ indexTarget: string | null; result: PushResult }> => {
      const existing = clientId
        ? await tx.note.findUnique({ where: { id: clientId } })
        : null;

      // 1) 服务端不存在 → 直接落库（离线新建的笔记）
      if (!existing) {
        const created = await tx.note.create({
          data: {
            ...(clientId ? { id: clientId } : {}),
            ...buildData(change.data.newVersion ?? 1),
            updatedAt: incomingAt,
          },
        });
        await logSyncInTx(tx, 'note', created.id, change.op, deviceId);
        const full = await tx.note.findUnique({
          where: { id: created.id },
          include: noteInclude,
        });
        return {
          indexTarget: change.op === 'upsert' ? created.id : null,
          result: {
            id: clientId,
            noteId: created.id,
            status: 'applied',
            note: serializeNote(full!),
          },
        };
      }

      // 2) LWW：进入方更新 → 覆盖服务端
      const serverMs = existing.updatedAt.getTime();
      if (isNewer(incomingMs, serverMs)) {
        const nextVersion = Math.max(existing.version, change.data.baseVersion ?? 0) + 1;
        await tx.note.update({
          where: { id: existing.id },
          data: { ...buildData(nextVersion), updatedAt: incomingAt },
        });
        await logSyncInTx(tx, 'note', existing.id, change.op, deviceId);
        const full = await tx.note.findUnique({
          where: { id: existing.id },
          include: noteInclude,
        });
        return {
          indexTarget: change.op === 'upsert' ? existing.id : null,
          result: {
            id: clientId,
            noteId: existing.id,
            status: 'applied',
            note: serializeNote(full!),
          },
        };
      }

      // 3) 服务端更新 → 冲突，落败方存快照（文档 6.5：变更不丢弃）
      await tx.conflictSnapshot.create({
        data: {
          noteId: existing.id,
          losingDevice: deviceId,
          losingPayload: JSON.stringify({ ...change.data, op: change.op }),
          losingUpdatedAt: incomingAt,
          winnerUpdatedAt: existing.updatedAt,
        },
      });
      const full = await tx.note.findUnique({
        where: { id: existing.id },
        include: noteInclude,
      });
      return {
        indexTarget: null,
        result: {
          id: clientId,
          noteId: existing.id,
          status: 'conflict',
          note: serializeNote(full!),
        },
      };
    },
    { timeout: 15000 }
  );

  // 向量索引放在事务之外：它要发外部 HTTP（embedding 接口），
  // 若留在事务内会长时间占住一条 origin 连接。
  if (indexTarget) indexNoteAsync(indexTarget);

  return result;
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
