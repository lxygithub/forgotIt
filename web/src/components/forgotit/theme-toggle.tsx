'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

/**
 * 主题切换按钮：图标用 CSS（dark: 前缀）切换，
 * 避免 mounted 状态的水合问题，无需 setState-in-effect。
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="切换深色 / 浅色模式"
      title="切换深色 / 浅色模式"
      className="size-11 sm:size-9"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
      <Moon className="block size-4 dark:hidden" aria-hidden="true" />
    </Button>
  );
}
