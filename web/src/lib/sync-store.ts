'use client';

// 「记不住」同步引擎（客户端，本地优先）
// 对应文档 v2.0 第 6.5 节同步策略：
//   - 离线优先：本地写入（overlay + outbox）→ 联网后自动推送
//   - 增量同步：pull 按 seq 游标；push 带 updatedAt/version，服务端 LWW
//   - local_only：入队前过滤，永不出本地
//   - 同步触发：启动时 / 网络恢复 / 手动 / 定时
//   - 网络不可用或被浏览器判为弱网时自动本地优先；恢复后自动同步

import { create } from 'zustand';
import type { NoteDto, SyncPushChange } from '@/lib/api';
import { ApiError, getConflicts, syncPull, syncPush, type ConflictDto } from '@/lib/api';

const LS_DEVICE_ID = 'forgotit.deviceId';
const LS_OUTBOX = 'forgotit.outbox';
const LS_CURSOR = 'forgotit.pullCursor';
const LS_SYNC_INTERVAL_MINUTES = 'forgotit.syncIntervalMinutes';

export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const MIN_SYNC_INTERVAL_MINUTES = 1;
const MAX_SYNC_INTERVAL_MINUTES = 60;
const SYNC_REQUEST_TIMEOUT_MS = 12_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;

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
  syncIntervalMinutes: number;
  conflicts: ConflictDto[];
  overlay: Record<string, LocalOverlayEntry>;
  dataVersion: number; // 服务端数据变更计数（驱动列表刷新）
  initialized: boolean;

  init: () => void;
  /** 网络请求失败时供本地优先写入层切换状态；不是用户可配置的模式。 */
  markOffline: () => void;
  setSyncIntervalMinutes: (minutes: number) => number;
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

function normalizeSyncIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.min(MAX_SYNC_INTERVAL_MINUTES, Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.round(value)));
}

function readSyncIntervalMinutes(): number {
  const raw = Number(localStorage.getItem(LS_SYNC_INTERVAL_MINUTES));
  return raw ? normalizeSyncIntervalMinutes(raw) : DEFAULT_SYNC_INTERVAL_MINUTES;
}

function schedulePeriodicSync(syncNow: () => Promise<void>, minutes: number): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => void syncNow(), minutes * 60_000);
}

type NetworkConnection = EventTarget & { effectiveType?: string };

function getNetworkConnection(): NetworkConnection | undefined {
  return (navigator as Navigator & { connection?: NetworkConnection }).connection;
}

/** 浏览器提供弱网信息时，2G / slow-2G 直接使用本地优先，避免请求长时间卡住。 */
function hasUsableNetwork(): boolean {
  if (!navigator.onLine) return false;
  const effectiveType = getNetworkConnection()?.effectiveType;
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/** 弱网下同步请求不能无限挂起；超时后由调用方切到本地优先并等待网络恢复。 */
async function withSyncTimeout<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
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
  syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  conflicts: [],
  overlay: {},
  dataVersion: 0,
  initialized: false,

  init: () => {
    if (get().initialized || typeof window === 'undefined') return;
    const deviceId = getDeviceId();
    // 迁移旧版手动开关：以后完全由网络状态决定。
    localStorage.removeItem('forgotit.offlineMode');
    const offlineMode = !hasUsableNetwork();
    const syncIntervalMinutes = readSyncIntervalMinutes();
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
    set({
      deviceId,
      offlineMode,
      status: offlineMode ? 'offline' : 'idle',
      syncIntervalMinutes,
      overlay,
      pendingCount: readOutbox().length,
      initialized: true,
    });

    // 同步触发：启动时 / 网络状态改善 / 定时（默认每 5 分钟，可在设置中调整）
    void get().syncNow();
    window.addEventListener('online', () => void get().syncNow());
    window.addEventListener('offline', () => get().markOffline());
    getNetworkConnection()?.addEventListener('change', () => void get().syncNow());
    schedulePeriodicSync(get().syncNow, syncIntervalMinutes);
  },

  markOffline: () => set({ offlineMode: true, status: 'offline' }),

  setSyncIntervalMinutes: (minutes) => {
    const next = normalizeSyncIntervalMinutes(minutes);
    localStorage.setItem(LS_SYNC_INTERVAL_MINUTES, String(next));
    set({ syncIntervalMinutes: next });
    if (get().initialized) schedulePeriodicSync(get().syncNow, next);
    return next;
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
    if (state.status === 'syncing' || typeof window === 'undefined') return;
    if (!hasUsableNetwork()) {
      get().markOffline();
      return;
    }

    // 已恢复网络：解除自动离线，继续推送本地队列。
    if (state.offlineMode) set({ offlineMode: false, status: 'idle' });
    set({ status: 'syncing' });
    try {
      // 1) push：把离线队列推给服务端（LWW 在服务端裁决）
      const outbox = readOutbox();
      let hadConflict = false;
      if (outbox.length > 0) {
        const res = await withSyncTimeout((signal) => syncPush({ deviceId: state.deviceId, changes: outbox }, signal));
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
      const pullRes = await withSyncTimeout((signal) => syncPull(cursor, signal));
      localStorage.setItem(LS_CURSOR, String(pullRes.cursor));

      set({ lastSyncAt: pullRes.serverTime, status: 'idle' });
      if (pullRes.changes.length > 0 || hadConflict) get().bumpDataVersion();
    } catch (error) {
      if (isNetworkError(error) || !hasUsableNetwork()) {
        get().markOffline();
      } else {
        // 服务端业务错误不等同于离线，仍允许下一次定时同步重试。
        set({ status: 'idle' });
      }
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
