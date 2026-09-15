'use client';

// 「记不住」本地优先写入层：离线先记（overlay + outbox），联网自动同步
// 对应文档 v2.0 第 6.5 节「离线优先：本地写入 → 加入 sync_queue → 联网后自动推送」

import { ApiError, createNote, deleteNote, restoreNote, updateNote, type CreateNoteBody, type NoteDto, type UpdateNoteBody } from '@/lib/api';
import { makeLocalNote, newLocalNoteId, noteToPushChange, useSyncStore } from '@/lib/sync-store';

function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

/** 创建笔记（离线可用；localOnly 只进本地 overlay，不入同步队列） */
export async function createNoteLocalFirst(body: CreateNoteBody): Promise<NoteDto> {
  const store = useSyncStore.getState();
  if (!store.offlineMode) {
    try {
      const res = await createNote(body);
      return res.note;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // 网络失败 → 降级为离线写入
    }
  }

  const id = newLocalNoteId();
  const note = makeLocalNote({
    id,
    title: body.title ?? null,
    content: body.content ?? null,
    type: body.type ?? 'text',
    localOnly: Boolean(body.localOnly),
  });
  store.setOverlayEntry(note, true);
  const change = noteToPushChange(note, 'upsert');
  if (change) store.enqueue(change);
  return note;
}

/** 更新笔记（离线可用：改动落在 overlay，联网后 LWW 推送） */
export async function updateNoteLocalFirst(
  id: string,
  body: UpdateNoteBody & { attachmentIds?: string[] },
  base?: NoteDto | null
): Promise<NoteDto> {
  const store = useSyncStore.getState();
  if (!store.offlineMode) {
    try {
      const res = await updateNote(id, body);
      return res.note;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }

  const existing = store.overlay[id]?.note ?? base ?? null;
  if (!existing) {
    // 本地也没有基准 → 走在线接口报错
    const res = await updateNote(id, body);
    return res.note;
  }
  const merged: NoteDto = {
    ...existing,
    ...('title' in body ? { title: body.title ?? null } : {}),
    ...('content' in body ? { content: body.content ?? null } : {}),
    ...('pinned' in body ? { pinned: Boolean(body.pinned) } : {}),
    ...('localOnly' in body ? { localOnly: Boolean(body.localOnly) } : {}),
    updatedAt: new Date().toISOString(),
  };
  store.setOverlayEntry(merged, true);
  const change = noteToPushChange(merged, 'upsert');
  if (change) store.enqueue(change);
  return merged;
}

/** 删除笔记（离线可用：overlay 打删除标记隐藏，推送时走 delete op） */
export async function deleteNoteLocalFirst(id: string, base?: NoteDto | null): Promise<void> {
  const store = useSyncStore.getState();
  if (!store.offlineMode) {
    try {
      await deleteNote(id);
      store.clearOverlayEntry(id);
      return;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }

  const existing = store.overlay[id]?.note ?? base ?? null;
  if (!existing) return;
  if (existing.localOnly || existing.id.startsWith('local-')) {
    // 纯本地条目直接移除
    store.clearOverlayEntry(id);
    return;
  }
  store.setOverlayEntry({ ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, true);
  const change = noteToPushChange(existing, 'delete');
  if (change) {
    // delete 变更的 updatedAt 取现在（LWW 依据）
    change.data.updatedAt = new Date().toISOString();
    store.enqueue(change);
  }
}

/** 恢复笔记（离线可用） */
export async function restoreNoteLocalFirst(id: string, base?: NoteDto | null): Promise<NoteDto> {
  const store = useSyncStore.getState();
  if (!store.offlineMode) {
    try {
      const res = await restoreNote(id);
      store.clearOverlayEntry(id);
      return res.note;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
    }
  }

  const existing = store.overlay[id]?.note ?? base ?? null;
  if (!existing) {
    const res = await restoreNote(id);
    return res.note;
  }
  const restored: NoteDto = { ...existing, deletedAt: null, updatedAt: new Date().toISOString() };
  store.setOverlayEntry(restored, true);
  const change = noteToPushChange(restored, 'upsert');
  if (change) store.enqueue(change);
  return restored;
}

/** 合并 overlay 到服务端笔记列表（本地优先展示；overlay 条目带 _pending 标记） */
export function mergeOverlay(
  serverNotes: NoteDto[],
  overlay: Record<string, { note: NoteDto; dirty: boolean }>,
  query?: string
): (NoteDto & { _pending?: boolean })[] {
  const merged = new Map<string, NoteDto & { _pending?: boolean }>();
  for (const n of serverNotes) merged.set(n.id, n);
  const q = (query ?? '').trim().toLowerCase();
  for (const [id, entry] of Object.entries(overlay)) {
    if (entry.note.deletedAt) {
      merged.delete(id); // 本地已删（尚未同步）
      continue;
    }
    // 带搜索词时，仅注入确实匹配的本地条目（避免无关待同步笔记混入搜索结果）
    if (q) {
      const hay = [entry.note.title, entry.note.content, entry.note.summary, ...entry.note.tags.map((t) => t.name)]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    merged.set(id, { ...entry.note, _pending: entry.dirty });
  }
  return [...merged.values()].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
