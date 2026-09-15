'use client';

// 「记不住」同步引擎（客户端，本地优先）
// 对应文档 v2.0 第 6.5 节同步策略：
//   - 离线优先：本地写入（overlay + outbox）→ 联网后自动推送
//   - 增量同步：pull 按 seq 游标；push 带 updatedAt/version，服务端 LWW
//   - local_only：入队前过滤，永不出本地
//   - 同步触发：启动时 / 网络恢复 / 手动 / 定时

import { create } from 'zustand';
import type { NoteDto, SyncPushChange } from '@/lib/api';
import { getConflicts, syncPull, syncPush, type ConflictDto } from '@/lib/api';

const LS_DEVICE_ID = 'forgotit.deviceId';
const LS_OUTBOX = 'forgotit.outbox';
const LS_CURSOR = 'forgotit.pullCursor';
const LS_OFFLINE = 'forgotit.offlineMode';

export type SyncStatus = 'idle' | 'syncing' | 'offline';

interface LocalOverlayEntry {
  note: NoteDto;
  dirty: boolean; // true = 尚未确认同步到服务端
}

interface SyncState {
  deviceId: string;
  offlineMode: boolean;
  status: SyncStatus;
  pendingCount: number;
  lastSyncAt: string | null;
  conflicts: ConflictDto[];
  overlay: Record<string, LocalOverlayEntry>;
  dataVersion: number; // 服务端数据变更计数（驱动列表刷新）
  panelOpen: boolean;
  initialized: boolean;

  init: () => void;
  setOfflineMode: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setOverlayEntry: (note: NoteDto, dirty: boolean) => void;
  clearOverlayEntry: (id: string) => void;
  enqueue: (change: SyncPushChange) => void;
  syncNow: () => Promise<void>;
  refreshConflicts: () => Promise<void>;
  bumpDataVersion: () => void;
}

function getDeviceId(): string {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

function readOutbox(): SyncPushChange[] {
  try {
    const raw = localStorage.getItem(LS_OUTBOX);
    const arr = raw ? (JSON.parse(raw) as SyncPushChange[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeOutbox(changes: SyncPushChange[]): void {
  localStorage.setItem(LS_OUTBOX, JSON.stringify(changes.slice(-100)));
}

function makeLocalNote(partial: Partial<NoteDto> & { id: string }): NoteDto {
  const now = new Date().toISOString();
  return {
    type: 'text',
    title: null,
    content: null,
    summary: null,
    localOnly: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    tags: [],
    attachments: [],
    ...partial,
  };
}

/** 把 NoteDto 转成 push 变更（localOnly 在此过滤，永不出本地） */
export function noteToPushChange(note: NoteDto, op: 'upsert' | 'delete'): SyncPushChange | null {
  if (note.localOnly) return null;
  return {
    entity: 'note',
    op,
    data: {
      id: note.id,
      title: note.title ?? null,
      content: note.content ?? null,
      summary: note.summary ?? null,
      pinned: note.pinned,
      localOnly: false,
      type: note.type,
      deletedAt: op === 'delete' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      newVersion: 1,
    },
  };
}

export const useSyncStore = create<SyncState>((set, get) => ({
  deviceId: '',
  offlineMode: false,
  status: 'idle',
  pendingCount: 0,
  lastSyncAt: null,
  conflicts: [],
  overlay: {},
  dataVersion: 0,
  panelOpen: false,
  initialized: false,

  init: () => {
    if (get().initialized || typeof window === 'undefined') return;
    const deviceId = getDeviceId();
    const offlineMode = localStorage.getItem(LS_OFFLINE) === '1';
    const overlay: Record<string, LocalOverlayEntry> = {};
    // 恢复未同步的本地草稿（服务端没有、推送失败留下的）
    for (const change of readOutbox()) {
      if (change.entity === 'note' && change.op === 'upsert' && change.data.id) {
        overlay[change.data.id] = {
          note: makeLocalNote({ id: change.data.id, ...change.data, type: (change.data.type as NoteDto['type']) ?? 'text' }),
          dirty: true,
        };
      }
    }
    set({ deviceId, offlineMode, overlay, pendingCount: readOutbox().length, initialized: true });

    // 同步触发：启动时 / 网络恢复 / 定时（文档 6.5）
    void get().syncNow();
    window.addEventListener('online', () => void get().syncNow());
    setInterval(() => void get().syncNow(), 30_000);
  },

  setOfflineMode: (on) => {
    localStorage.setItem(LS_OFFLINE, on ? '1' : '0');
    set({ offlineMode: on, status: on ? 'offline' : 'idle' });
    if (!on) void get().syncNow();
  },

  setPanelOpen: (open) => {
    set({ panelOpen: open });
    if (open) void get().refreshConflicts();
  },

  setOverlayEntry: (note, dirty) => {
    set((s) => ({ overlay: { ...s.overlay, [note.id]: { note, dirty } } }));
  },

  clearOverlayEntry: (id) => {
    set((s) => {
      const next = { ...s.overlay };
      delete next[id];
      return { overlay: next };
    });
  },

  enqueue: (change) => {
    const outbox = readOutbox();
    // 同一实体的连续变更合并为最后一条（LWW 语义下安全）
    const filtered = outbox.filter((c) => !(c.entity === change.entity && c.data.id === change.data.id));
    filtered.push(change);
    writeOutbox(filtered);
    set({ pendingCount: filtered.length });
  },

  bumpDataVersion: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),

  refreshConflicts: async () => {
    try {
      const res = await getConflicts();
      set({ conflicts: res.conflicts });
    } catch {
      // 离线时静默
    }
  },

  syncNow: async () => {
    const state = get();
    if (state.offlineMode || state.status === 'syncing' || typeof window === 'undefined') return;
    if (!navigator.onLine) {
      set({ status: 'offline' });
      return;
    }

    set({ status: 'syncing' });
    try {
      // 1) push：把离线队列推给服务端（LWW 在服务端裁决）
      const outbox = readOutbox();
      let hadConflict = false;
      if (outbox.length > 0) {
        const res = await syncPush({ deviceId: state.deviceId, changes: outbox });
        const stillPending: SyncPushChange[] = [];
        for (const change of outbox) {
          const result = res.results.find((r) => r.id === change.data.id);
          if (!result || result.status === 'invalid') {
            stillPending.push(change); // 保留下次重试
            continue;
          }
          if (result.status === 'applied' && change.data.id) {
            get().clearOverlayEntry(change.data.id);
          }
          if (result.status === 'local-only-skipped') {
            // 本地隐私笔记：留在本地（overlay 保持 dirty，仅本机可见）
          }
          if (result.status === 'conflict') {
            hadConflict = true;
          }
        }
        writeOutbox(stillPending);
        set({ pendingCount: stillPending.length });
        if (hadConflict) {
          await get().refreshConflicts();
          const { toast } = await import('sonner');
          toast.warning('同步有冲突：两个版本都帮你留着了，去同步面板看看。');
        }
      }

      // 2) pull：拉取其他设备的增量变更（有变化就触发列表刷新）
      const cursor = Number(localStorage.getItem(LS_CURSOR) ?? '0') || 0;
      const pullRes = await syncPull(cursor);
      localStorage.setItem(LS_CURSOR, String(pullRes.cursor));

      set({ lastSyncAt: pullRes.serverTime, status: 'idle' });
      if (pullRes.changes.length > 0 || hadConflict) get().bumpDataVersion();
    } catch {
      set({ status: navigator.onLine ? 'idle' : 'offline' });
    }
  },
}));

/** 生成客户端临时笔记 id（离线新建用） */
export function newLocalNoteId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `local-${crypto.randomUUID()}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export { makeLocalNote };
