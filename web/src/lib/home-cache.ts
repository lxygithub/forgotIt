'use client';

// 首页快照缓存：先展示上次成功拉取的数据，再在后台向服务端校验更新。
// 离线写入仍由 sync-store 的 overlay/outbox 负责；这里仅缓存服务端快照。

import type { NoteDto, StatsDto } from '@/lib/api';

const CACHE_KEY = 'forgotit.homeSnapshot.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

interface HomeSnapshot {
  notes: NoteDto[];
  stats: StatsDto;
  cachedAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isStats(value: unknown): value is StatsDto {
  if (!value || typeof value !== 'object') return false;
  const stats = value as StatsDto;
  return [stats.notes, stats.images, stats.tags, stats.trash].every((item) => typeof item === 'number');
}

/** 读取仍在有效期内的首页快照；损坏或过期数据会被忽略。 */
export function readHomeSnapshot(): HomeSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<HomeSnapshot>;
    if (
      !Array.isArray(snapshot.notes) ||
      !isStats(snapshot.stats) ||
      typeof snapshot.cachedAt !== 'number' ||
      Date.now() - snapshot.cachedAt > MAX_AGE_MS
    ) {
      window.localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return snapshot as HomeSnapshot;
  } catch {
    // 隐私模式、配额不足或旧缓存损坏都不应影响正常联网加载。
    return null;
  }
}

/** 保存一次完整、成功的首页响应。超出安全体积时宁可不缓存，避免挤掉离线队列。 */
export function writeHomeSnapshot(notes: NoteDto[], stats: StatsDto): void {
  if (!canUseStorage()) return;
  try {
    const raw = JSON.stringify({ notes, stats, cachedAt: Date.now() } satisfies HomeSnapshot);
    if (raw.length > MAX_CACHE_BYTES) return;
    window.localStorage.setItem(CACHE_KEY, raw);
  } catch {
    // localStorage 不可用时退化为无缓存模式。
  }
}
