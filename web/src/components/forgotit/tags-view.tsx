'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/forgotit/empty-state';
import { getTags, type TagWithCount } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TagsViewProps {
  refreshKey: number;
  onSelectTag: (tag: TagWithCount) => void;
}

function tagCloudClass(count: number): string {
  if (count >= 10) return 'text-lg font-semibold';
  if (count >= 6) return 'text-base font-medium';
  if (count >= 3) return 'text-sm';
  return 'text-xs';
}

export function TagsView({ refreshKey, onSelectTag }: TagsViewProps) {
  const [categories, setCategories] = useState<TagWithCount[] | null>(null);
  const [free, setFree] = useState<TagWithCount[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const loading = categories === null || free === null || loadedKey !== String(refreshKey);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await getTags(ac.signal);
        if (ac.signal.aborted) return;
        setCategories(
          [...res.categories].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        );
        setFree([...res.free].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        toast.error(err instanceof Error ? err.message : '加载标签失败');
        setCategories([]);
        setFree([]);
      } finally {
        if (!ac.signal.aborted) setLoadedKey(String(refreshKey));
      }
    })();
    return () => ac.abort();
  }, [refreshKey]);

  if (loading) {
    return (
      <section aria-label="标签" aria-busy="true" className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-full" style={{ width: `${48 + ((i * 17) % 60)}px` }} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const isEmpty = categories.length === 0 && free.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        title="这里啥也没有。"
        description="不过没关系，你记不住，它记得住。记几条笔记，AI 会自动帮你归类。"
      />
    );
  }

  return (
    <section aria-label="标签" className="space-y-8">
      {/* 固定类目 */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">固定类目</h2>
        {categories.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((tag, i) => (
              <motion.button
                key={tag.id}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.2) }}
                whileHover={{ y: -2 }}
                onClick={() => onSelectTag(tag)}
                className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-primary px-4 py-3 text-left text-primary-foreground shadow-sm transition-shadow hover:shadow-md sm:min-h-0"
                aria-label={`查看类目「${tag.name}」下的 ${tag.count} 条笔记`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderOpen className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                  <span className="truncate text-sm font-medium">{tag.name}</span>
                </span>
                <span className="shrink-0 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-semibold">
                  {tag.count}
                </span>
              </motion.button>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有固定类目，记一条并让 AI 整理就有了。
          </p>
        )}
      </div>

      {/* 自由标签云 */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">自由标签</h2>
        {free.length > 0 ? (
          <div
            className="max-h-96 overflow-y-auto rounded-xl border bg-card/40 p-4"
            role="list"
            aria-label="自由标签云"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              {free.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  role="listitem"
                  onClick={() => onSelectTag(tag)}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-primary sm:min-h-8',
                    tagCloudClass(tag.count)
                  )}
                  aria-label={`查看标签「${tag.name}」下的 ${tag.count} 条笔记`}
                >
                  <span className="text-primary/60">#</span>
                  {tag.name}
                  <span className="text-[10px] opacity-70">{tag.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            自由标签还是空的，AI 整理时会自动打上。
          </p>
        )}
      </div>
    </section>
  );
}
