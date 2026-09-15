'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Sparkles, PenLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/forgotit/empty-state';
import { NoteCard } from '@/components/forgotit/note-card';
import { BRAND } from '@/lib/brand';
import {
  deleteNote,
  getStats,
  hybridSearch,
  listNotes,
  seedDemoData,
  semanticSearch,
  updateNote,
  type NoteDto,
  type NotesQuery,
  type StatsDto,
  type TagDto,
} from '@/lib/api';
import { mergeOverlay } from '@/lib/local-first';
import { useSyncStore } from '@/lib/sync-store';
import { cn } from '@/lib/utils';

export type NotesFilterType = 'all' | 'text' | 'image';
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface NotesFilter {
  q: string;
  type: NotesFilterType;
  pinned: boolean;
  tag: TagDto | null;
  mode: SearchMode;
}

interface NotesViewProps {
  filter: NotesFilter;
  onFilterChange: (filter: NotesFilter) => void;
  refreshKey: number;
  onEditNote: (note: NoteDto) => void;
  onNewNote: () => void;
}

const TYPE_CHIPS: { key: NotesFilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
];

const MODE_CHIPS: { key: SearchMode; label: string; hint: string }[] = [
  { key: 'keyword', label: BRAND.searchModeKeyword, hint: '按字面匹配' },
  { key: 'semantic', label: BRAND.searchModeSemantic, hint: BRAND.semanticSearchHint },
  { key: 'hybrid', label: BRAND.searchModeHybrid, hint: '双路检索 + RRF 合并' },
];

export function NotesView({ filter, onFilterChange, refreshKey, onEditNote, onNewNote }: NotesViewProps) {
  const [notes, setNotes] = useState<(NoteDto & { _pending?: boolean })[] | null>(null);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [expansions, setExpansions] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [searchDraft, setSearchDraft] = useState(filter.q);
  const [seeding, setSeeding] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overlay = useSyncStore((s) => s.overlay);

  const filterKey = `${filter.q}|${filter.type}|${filter.pinned}|${filter.tag?.id ?? ''}|${filter.mode}|${refreshKey}|${reloadNonce}`;
  const loading = notes === null || loadedKey !== filterKey;

  // 外部清空/改变搜索时同步输入框（官方推荐的 render 阶段状态调整模式）
  const [prevQ, setPrevQ] = useState(filter.q);
  if (prevQ !== filter.q) {
    setPrevQ(filter.q);
    setSearchDraft(filter.q);
  }

  useEffect(() => {
    const ac = new AbortController();
    const query: NotesQuery = {
      q: filter.q || undefined,
      type: filter.type,
      pinned: filter.pinned,
      tagId: filter.tag?.id,
      view: 'all',
    };
    void (async () => {
      try {
        let merged: (NoteDto & { _pending?: boolean })[] = [];
        let expansionsRes: string[] = [];
        if (filter.q && filter.mode === 'semantic') {
          // 语义模式：查询扩展 + 向量检索（不走关键词过滤参数）
          const [res, statsRes] = await Promise.all([
            semanticSearch(filter.q, ac.signal),
            getStats(ac.signal).catch(() => null),
          ]);
          if (ac.signal.aborted) return;
          merged = mergeOverlay(res.notes, overlay, filter.q);
          expansionsRes = res.expansions;
          if (statsRes) setStats(statsRes);
        } else if (filter.q && filter.mode === 'hybrid') {
          // 混合模式：双路检索 + RRF 合并
          const [res, statsRes] = await Promise.all([
            hybridSearch(filter.q, ac.signal),
            getStats(ac.signal).catch(() => null),
          ]);
          if (ac.signal.aborted) return;
          merged = mergeOverlay(res.hits.map((h) => h.note), overlay, filter.q);
          expansionsRes = res.expansions;
          if (statsRes) setStats(statsRes);
        } else {
          // 关键词模式（默认）：/api/notes 原有过滤逻辑
          const [notesRes, statsRes] = await Promise.all([
            listNotes(query, ac.signal),
            getStats(ac.signal).catch(() => null),
          ]);
          if (ac.signal.aborted) return;
          merged = mergeOverlay(notesRes.notes, overlay, filter.q);
          if (statsRes) setStats(statsRes);
        }
        // 置顶优先，其余按更新时间倒序
        const sorted = [...merged].sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        setNotes(sorted);
        setExpansions(expansionsRes);
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        toast.error(err instanceof Error ? err.message : '加载笔记失败');
        setNotes([]);
      } finally {
        if (!ac.signal.aborted) setLoadedKey(filterKey);
      }
    })();
    return () => ac.abort();
  }, [filter, filterKey, refreshKey, overlay]);

  const hasFilter = Boolean(filter.q || filter.type !== 'all' || filter.pinned || filter.tag);

  const clearFilters = () => {
    onFilterChange({ q: '', type: 'all', pinned: false, tag: null, mode: filter.mode });
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onFilterChange({ ...filter, q: searchDraft.trim() });
    }
  };

  const handleClearSearch = () => {
    setSearchDraft('');
    if (filter.q) onFilterChange({ ...filter, q: '' });
    searchInputRef.current?.focus();
  };

  const handleTogglePin = async (note: NoteDto) => {
    try {
      await updateNote(note.id, { pinned: !note.pinned });
      setNotes((prev) =>
        prev
          ? [...prev]
              .map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))
              .sort(
                (a, b) =>
                  Number(b.pinned) - Number(a.pinned) ||
                  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
              )
          : prev
      );
      toast.success(note.pinned ? '已取消置顶。' : '已置顶，它在脑子最上面。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (note: NoteDto) => {
    try {
      await deleteNote(note.id);
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
      toast.success(`已移入回收站。${BRAND.trashHint}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    const toastId = toast.loading('正在往脑子里塞示例数据…');
    try {
      await seedDemoData();
      toast.success('示例笔记已就位。', { id: toastId });
      setReloadNonce((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '载入示例数据失败', { id: toastId });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section aria-label="笔记列表" className="space-y-4">
      {/* 搜索框 */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={searchInputRef}
          type="text"
          enterKeyHint="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={BRAND.searchPlaceholder}
          aria-label="搜索笔记"
          className="h-11 rounded-full pl-9 pr-10 sm:h-10"
        />
        {searchDraft && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="清空搜索"
            className="absolute right-1.5 top-1/2 size-8 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={handleClearSearch}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* 搜索模式切换（有搜索词时展示） */}
      {filter.q && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="搜索模式">
          {MODE_CHIPS.map((chip) => {
            const active = filter.mode === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                role="radio"
                aria-checked={active}
                title={chip.hint}
                onClick={() => onFilterChange({ ...filter, mode: chip.key })}
                className={cn(
                  'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs transition-colors sm:h-7',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Sparkles className={cn('size-3', !active && 'hidden')} aria-hidden="true" />
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 语义扩展词 */}
      {filter.q && expansions.length > 1 && filter.mode !== 'keyword' && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">帮你按这些意思也找了：</span>
          {expansions.slice(1, 7).map((term) => (
            <span key={term} className="rounded-full bg-muted px-2 py-0.5">{term}</span>
          ))}
        </p>
      )}

      {/* 过滤 chips + 统计 */}
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_CHIPS.map((chip) => {
          const active = filter.type === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange({ ...filter, type: chip.key })}
              className={cn(
                'inline-flex h-11 items-center rounded-full border px-3.5 text-sm transition-colors sm:h-8',
                active
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {chip.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={filter.pinned}
          onClick={() => onFilterChange({ ...filter, pinned: !filter.pinned })}
          className={cn(
            'inline-flex h-11 items-center rounded-full border px-3.5 text-sm transition-colors sm:h-8',
            filter.pinned
              ? 'border-transparent bg-primary text-primary-foreground'
              : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          置顶
        </button>

        {filter.tag && (
          <span className="inline-flex h-11 items-center gap-1 rounded-full bg-primary/15 pl-3 pr-1.5 text-sm text-primary sm:h-8">
            <span className="max-w-32 truncate">标签：{filter.tag.name}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`清除标签筛选 ${filter.tag.name}`}
              className="size-7 rounded-full text-primary hover:bg-primary/20 hover:text-primary"
              onClick={() => onFilterChange({ ...filter, tag: null })}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </span>
        )}

        {stats && !hasFilter && (
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            脑子里有 {stats.notes} 条笔记 · {stats.images} 张图 · {stats.tags} 个标签
          </span>
        )}
      </div>

      {/* 列表 / 加载 / 空状态 */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : notes && notes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note, i) => (
            <NoteCard
              key={note.id}
              note={note}
              index={i}
              pending={note._pending}
              onOpen={onEditNote}
              onTogglePin={handleTogglePin}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : hasFilter ? (
        <EmptyState
          illustration={false}
          title={BRAND.noResultText}
          description="试试换个问法，或者清除筛选条件。"
        >
          <Button variant="outline" onClick={clearFilters} className="h-11 sm:h-9">
            <X className="size-4" aria-hidden="true" />
            清除筛选
          </Button>
        </EmptyState>
      ) : (
        <EmptyState title={BRAND.emptyTitle} description={BRAND.emptyDesc}>
          <Button onClick={handleSeed} disabled={seeding} className="h-11 sm:h-9">
            <Sparkles className="size-4" aria-hidden="true" />
            {seeding ? '正在载入…' : '载入示例笔记'}
          </Button>
          <Button variant="outline" onClick={onNewNote} className="h-11 sm:h-9">
            <PenLine className="size-4" aria-hidden="true" />
            记一条
          </Button>
        </EmptyState>
      )}
    </section>
  );
}
