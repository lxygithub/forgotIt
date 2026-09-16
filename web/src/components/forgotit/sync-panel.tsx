'use client';

// 设置页中的同步区：设备信息 / 离线模式 / 手动同步 / 重建语义索引 / 冲突记录处置
// 对应文档 v2.0 第 6.5 节（冲突快照供用户查看）与第 8 节（换 embedding 模型后重索引）

import { useEffect, useState } from 'react';
import { CloudOff, DatabaseBackup, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BRAND } from '@/lib/brand';
import { resolveConflict, reindexEmbeddings } from '@/lib/api';
import { useSyncStore } from '@/lib/sync-store';

export function SyncSettingsSection() {
  const deviceId = useSyncStore((s) => s.deviceId);
  const offlineMode = useSyncStore((s) => s.offlineMode);
  const setOfflineMode = useSyncStore((s) => s.setOfflineMode);
  const syncIntervalMinutes = useSyncStore((s) => s.syncIntervalMinutes);
  const setSyncIntervalMinutes = useSyncStore((s) => s.setSyncIntervalMinutes);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const conflicts = useSyncStore((s) => s.conflicts);
  const syncNow = useSyncStore((s) => s.syncNow);
  const refreshConflicts = useSyncStore((s) => s.refreshConflicts);
  const bumpDataVersion = useSyncStore((s) => s.bumpDataVersion);

  const [syncing, setSyncing] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [intervalDraft, setIntervalDraft] = useState(String(syncIntervalMinutes));

  useEffect(() => {
    setIntervalDraft(String(syncIntervalMinutes));
  }, [syncIntervalMinutes]);

  useEffect(() => {
    void refreshConflicts();
  }, [refreshConflicts]);

  const handleSaveInterval = () => {
    const value = Number(intervalDraft);
    if (!Number.isFinite(value) || value < 1 || value > 60) {
      toast.error('同步间隔请输入 1 到 60 分钟。');
      setIntervalDraft(String(syncIntervalMinutes));
      return;
    }
    const saved = setSyncIntervalMinutes(value);
    setIntervalDraft(String(saved));
    toast.success(`已设为每 ${saved} 分钟自动同步。`);
  };

  const handleSync = async () => {
    setSyncing(true);
    const toastId = toast.loading(BRAND.syncToast);
    try {
      await syncNow();
      toast.success('同步完成。', { id: toastId });
      await refreshConflicts();
      bumpDataVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败', { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    const toastId = toast.loading('正在给脑子建语义索引…');
    try {
      const res = await reindexEmbeddings();
      toast.success(`索引完成：${res.indexed} 条笔记${res.keywordsGenerated > 0 ? `，新补 ${res.keywordsGenerated} 条语义关键词` : ''}。`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重建索引失败', { id: toastId });
    } finally {
      setReindexing(false);
    }
  };

  const handleResolve = async (id: string, action: 'restore-mine' | 'discard') => {
    try {
      await resolveConflict(id, action);
      toast.success(action === 'restore-mine' ? '已恢复为你改的版本。' : '已采用服务器版本。');
      await refreshConflicts();
      bumpDataVersion();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '处理冲突失败');
    }
  };

  return (
    <div className="space-y-4">
      {/* 设备与状态 */}
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">设备 ID</span>
            <span className="font-mono text-xs">{deviceId ? `${deviceId.slice(0, 13)}…` : '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">上次同步</span>
            <span className="text-xs">
              {lastSyncAt
                ? new Date(lastSyncAt).toLocaleString('zh-CN', { hour12: false })
                : '还没同步过'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">待同步变更</span>
            <Badge variant={pendingCount > 0 ? 'default' : 'outline'}>{pendingCount} 条</Badge>
          </div>
          <Button onClick={handleSync} disabled={syncing || offlineMode} className="h-11 w-full sm:h-9">
            {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {syncing ? BRAND.syncToast : BRAND.syncNowText}
          </Button>
        </div>

      {/* 自动同步频率 */}
      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">自动同步频率</p>
          <p className="mt-1 text-xs text-muted-foreground">默认每 5 分钟同步一次；启动、网络恢复和手动同步不受此设置影响。</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            step={1}
            value={intervalDraft}
            onChange={(event) => setIntervalDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSaveInterval();
            }}
            aria-label="自动同步间隔（分钟）"
            className="h-11 w-24 sm:h-9"
          />
          <span className="text-sm text-muted-foreground">分钟</span>
          <Button variant="outline" className="ml-auto h-11 sm:h-9" onClick={handleSaveInterval}>
            保存频率
          </Button>
        </div>
      </div>

      {/* 离线模式 */}
      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-4">
          <span className="space-y-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <CloudOff className="size-4" aria-hidden="true" />
              {BRAND.syncOfflineLabel}
            </span>
            <span className="block text-xs text-muted-foreground">{BRAND.syncOfflineDesc}</span>
          </span>
          <Switch
            checked={offlineMode}
            onCheckedChange={setOfflineMode}
            aria-label={BRAND.syncOfflineLabel}
            className="mt-0.5"
          />
      </label>

      {/* 语义索引 */}
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="space-y-1">
            <span className="block text-sm font-medium">{BRAND.reindexText}</span>
            <span className="block text-xs text-muted-foreground">存量笔记补建向量与语义关键词，供语义搜索与问答使用。</span>
          </span>
          <Button variant="outline" size="sm" className="h-11 shrink-0 sm:h-8" onClick={handleReindex} disabled={reindexing}>
            {reindexing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <DatabaseBackup className="size-4" aria-hidden="true" />}
            {reindexing ? '索引中…' : '开始'}
          </Button>
      </div>

      {/* 冲突记录 */}
      <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <TriangleAlert className="size-4 text-amber-500" aria-hidden="true" />
            {BRAND.conflictTitle}
            {conflicts.length > 0 && <Badge variant="destructive">{conflicts.length}</Badge>}
          </div>
          {conflicts.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              暂无冲突。多设备改同一条笔记时，两边都会留住。
            </p>
          ) : (
            <ul className="space-y-2">
              {conflicts.map((c) => (
                <li key={c.id} className="space-y-2 rounded-lg border p-3">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <span className="block truncate text-sm font-medium">{c.noteTitle}</span>
                    <span className="block text-xs text-muted-foreground">
                      你的改动 {new Date(c.losingUpdatedAt).toLocaleString('zh-CN', { hour12: false })} ·
                      服务器版本 {new Date(c.winnerUpdatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </button>
                  {expandedId === c.id && (
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded border bg-muted/40 p-2">
                        <div className="mb-1 font-medium text-primary">我的版本</div>
                        <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{c.losingContent || '（无正文）'}</p>
                      </div>
                      <div className="rounded border bg-muted/40 p-2">
                        <div className="mb-1 font-medium">服务器版本</div>
                        <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{c.winnerContent || '（无正文）'}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="h-9 flex-1" onClick={() => handleResolve(c.id, 'restore-mine')}>
                      {BRAND.conflictKeepMine}
                    </Button>
                    <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => handleResolve(c.id, 'discard')}>
                      {BRAND.conflictKeepServer}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
