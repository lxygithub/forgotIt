'use client';

import { useState } from 'react';
import { BrainCircuit, LogOut, Palette, Settings2 } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AiSettingsDialog } from '@/components/forgotit/ai-settings-dialog';
import { SyncSettingsSection } from '@/components/forgotit/sync-panel';
import { ThemeToggle } from '@/components/forgotit/theme-toggle';

/** 应用设置：将同步、AI 与外观配置集中在一个可返回的页面中。 */
export function SettingsView() {
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  return (
    <section aria-label="设置" className="mx-auto max-w-2xl space-y-8">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Settings2 className="size-5 text-primary" aria-hidden="true" />
          设置
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">同步节奏、AI 能力和外观都在这里调整。</p>
      </div>

      <section className="space-y-4" aria-labelledby="sync-settings-title">
        <div>
          <h3 id="sync-settings-title" className="text-base font-semibold">同步与设备</h3>
          <p className="mt-1 text-sm text-muted-foreground">网络不可用或较弱时会自动本地保存，恢复后自动同步待处理变更。</p>
        </div>
        <SyncSettingsSection />
      </section>

      <section className="space-y-3" aria-labelledby="ai-settings-title">
        <div>
          <h3 id="ai-settings-title" className="text-base font-semibold">AI 模型</h3>
          <p className="mt-1 text-sm text-muted-foreground">配置 OpenAI 兼容端点、端侧 AI 和连接测试。</p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <BrainCircuit className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-medium">AI 模型配置</span>
              <span className="block text-xs text-muted-foreground">端点、密钥和端侧推理选项</span>
            </span>
          </span>
          <Button variant="outline" className="h-11 shrink-0 sm:h-9" onClick={() => setAiSettingsOpen(true)}>
            配置
          </Button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="appearance-settings-title">
        <div>
          <h3 id="appearance-settings-title" className="text-base font-semibold">外观</h3>
          <p className="mt-1 text-sm text-muted-foreground">切换浅色和深色显示。</p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Palette className="size-4 text-primary" aria-hidden="true" />
            深色模式
          </span>
          <ThemeToggle />
        </div>
      </section>

      <section className="border-t pt-6" aria-label="账户操作">
        <Button
          variant="ghost"
          className="h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-9"
          onClick={() => setLogoutConfirmOpen(true)}
        >
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </Button>
      </section>

      <AiSettingsDialog open={aiSettingsOpen} onOpenChange={setAiSettingsOpen} />
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent className="max-w-sm p-5 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
            <AlertDialogDescription>
              退出后需要重新输入密码才能访问你的笔记。本机缓存不会因此删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">取消</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-white hover:bg-destructive/90 sm:h-9"
              onClick={() => void signOut({ callbackUrl: '/login' })}
            >
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
