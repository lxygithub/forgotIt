'use client';

import { Brain } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BRAND } from '@/lib/brand';

export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-background/45 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-primary/15 text-primary" aria-hidden="true">
            <Brain className="size-3.5" />
          </span>
          <span className="text-sm font-semibold">{BRAND.appName}</span>
          <span className="text-xs text-muted-foreground">· {BRAND.slogan}</span>
        </div>
        {/* sm:pr-24 给悬浮 FAB（fixed bottom-6 right-6）让位，避免遮挡右侧徽章 */}
        <div className="flex flex-col items-center gap-1.5 sm:flex-row sm:items-center sm:gap-3 sm:pr-24">
          <span className="text-xs text-muted-foreground">{BRAND.tagline}</span>
          <Badge variant="outline" className="border-primary/30 text-primary">
            {BRAND.localModeBadge}
          </Badge>
        </div>
      </div>
    </footer>
  );
}
