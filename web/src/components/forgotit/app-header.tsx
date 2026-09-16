'use client';

import { Brain, CloudOff, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { useSyncStore } from '@/lib/sync-store';

export type AppView = 'notes' | 'ask' | 'tags' | 'trash' | 'settings';

const NAV_ITEMS: { key: AppView; label: string }[] = [
  { key: 'notes', label: '笔记' },
  { key: 'ask', label: '问答' },
  { key: 'tags', label: '标签' },
  { key: 'trash', label: '回收站' },
];

interface AppHeaderProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
  /** 编辑器关闭后仍在后台执行的保存 / AI 整理任务。 */
  backgroundTask?: string | null;
}

export function AppHeader({ view, onViewChange, backgroundTask }: AppHeaderProps) {
  const syncStatus = useSyncStore((s) => s.status);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const offlineMode = useSyncStore((s) => s.offlineMode);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <Brain className="size-5" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">{BRAND.appName}</div>
            <div className="text-[11px] text-muted-foreground">{BRAND.slogan}</div>
          </div>
        </div>

        {/* 导航 Tabs：移动端换行到第二行，桌面端居右 */}
        <nav
          aria-label="主导航"
          className="no-scrollbar order-last w-full overflow-x-auto sm:order-none sm:ml-auto sm:w-auto"
        >
          <div className="flex items-center gap-1" role="tablist">
            {NAV_ITEMS.map((item) => {
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onViewChange(item.key)}
                  className={cn(
                    'inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors sm:h-9 sm:px-3.5',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* 右侧：同步状态 + 设置 */}
        <div className="ml-auto flex items-center gap-2 sm:ml-3">
          <button
            type="button"
            aria-label={offlineMode ? '同步：离线模式，点击打开设置' : '同步状态，点击打开设置'}
            onClick={() => onViewChange('settings')}
            className={cn(
              'relative inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:size-9',
              offlineMode && 'text-amber-600 dark:text-amber-500'
            )}
          >
            {syncStatus === 'syncing' ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
            ) : offlineMode ? (
              <CloudOff className="size-[18px]" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-[18px]" aria-hidden="true" />
            )}
            {pendingCount > 0 && !offlineMode && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground"
              >
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label="打开设置"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => onViewChange('settings')}
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:size-9',
              view === 'settings' && 'bg-accent text-accent-foreground'
            )}
          >
            <Settings2 className="size-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
      {backgroundTask && (
        <div
          role="status"
          aria-live="polite"
          className="border-t border-primary/15 bg-primary/10 text-primary"
        >
          <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-1.5 text-xs font-medium">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {backgroundTask}
          </div>
        </div>
      )}
    </header>
  );
}
