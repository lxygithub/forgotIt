'use client';

import { Brain } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/forgotit/theme-toggle';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';

export type AppView = 'notes' | 'ask' | 'tags' | 'trash';

const NAV_ITEMS: { key: AppView; label: string }[] = [
  { key: 'notes', label: '笔记' },
  { key: 'ask', label: '问答' },
  { key: 'tags', label: '标签' },
  { key: 'trash', label: '回收站' },
];

interface AppHeaderProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
}

export function AppHeader({ view, onViewChange }: AppHeaderProps) {
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

        {/* 右侧：主题切换 + 本地模式徽章 */}
        <div className="ml-auto flex items-center gap-2 sm:ml-3">
          <Badge
            variant="outline"
            className="hidden md:inline-flex border-primary/30 text-primary"
          >
            {BRAND.localModeBadge}
          </Badge>
          <Badge
            variant="outline"
            className="border-primary/30 text-primary md:hidden"
          >
            {BRAND.localModeBadgeShort}
          </Badge>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
