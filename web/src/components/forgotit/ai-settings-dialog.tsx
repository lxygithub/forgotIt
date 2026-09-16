'use client';

// AI 模型配置对话框（v1.4「设置」入口）
// 用途：界面上直接配置 OpenAI 兼容端点 + API Key，替代 wrangler secret put。
// 优先级：界面配置 → 环境变量 → 配置文件（见 src/lib/ai.ts 凭证解析链）。
// 安全：完整 Key 只在服务端流转；对话框只显示掩码，留空 = 沿用已保存 Key。

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, PlugZap, Settings2, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  clearAiConfig,
  getAiConfig,
  saveAiConfig,
  testAiConfig,
  type AiConfigInfoDto,
  type AiConfigSourceDto,
  type AiTestResultDto,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<AiConfigSourceDto, { label: string; className: string; hint: string }> = {
  db: {
    label: '界面配置',
    className: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    hint: '当前生效的是下面保存的配置。',
  },
  env: {
    label: '环境变量',
    className: 'border-sky-600/30 bg-sky-600/10 text-sky-700 dark:text-sky-400',
    hint: '当前生效的是部署环境变量（ZAI_BASE_URL / ZAI_API_KEY）。在下方保存后会优先于它。',
  },
  file: {
    label: '配置文件',
    className: 'border-sky-600/30 bg-sky-600/10 text-sky-700 dark:text-sky-400',
    hint: '当前生效的是 .z-ai-config 文件。在下方保存后会优先于它。',
  },
  none: {
    label: '未配置',
    className: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500',
    hint: '还没有任何 AI 凭证，AI 整理 / 问答 / 语义搜索不可用。填好端点和 Key 保存即可开启。',
  },
};

interface AiSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AiSettingsDialog({ open, onOpenChange }: AiSettingsDialogProps) {
  const [info, setInfo] = useState<AiConfigInfoDto | null>(null);
  const [loading, setLoading] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResultDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const applyInfo = useCallback((next: AiConfigInfoDto) => {
    setInfo(next);
    // 表单预填当前生效配置；Key 永不回显，只以掩码出现在 placeholder
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setToken('');
    setApiKey('');
    setTestResult(null);
  }, []);

  // 每次打开拉取当前配置
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    getAiConfig(ac.signal)
      .then(applyInfo)
      .catch((err) => {
        if (ac.signal.aborted) return;
        toast.error(err instanceof Error ? err.message : '读取 AI 配置失败');
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => {
      ac.abort();
      abortRef.current = null;
    };
  }, [open, applyInfo]);

  const sourceMeta = SOURCE_META[info?.source ?? 'none'];
  const isDbSource = info?.source === 'db';

  const buildPayload = () => ({
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim() || undefined,
    token: token.trim() || undefined,
    model: model.trim() || undefined,
  });

  const handleTest = async () => {
    if (!baseUrl.trim()) {
      toast.error('请先填写 API 端点');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiConfig(buildPayload());
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!baseUrl.trim()) {
      toast.error('请先填写 API 端点');
      return;
    }
    if (!apiKey.trim() && !info?.apiKeyMasked) {
      toast.error('请填写 API Key');
      return;
    }
    setSaving(true);
    try {
      const next = await saveAiConfig(buildPayload());
      applyInfo(next);
      toast.success('AI 配置已保存，立即生效。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const next = await clearAiConfig();
      applyInfo(next);
      toast.success('已清除界面配置。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清除失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4.5 text-primary" aria-hidden="true" />
            AI 模型配置
          </DialogTitle>
          <DialogDescription>
            接入任意 OpenAI 兼容端点，AI 整理、问答、语义搜索都会用它。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            正在读取当前配置…
          </div>
        ) : (
          <div className="space-y-5">
            {/* 当前生效状态 */}
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">当前状态</span>
                <Badge variant="outline" className={cn('text-[11px]', sourceMeta.className)}>
                  {sourceMeta.label}
                </Badge>
              </div>
              {info?.configured ? (
                <p className="break-all text-xs text-muted-foreground">
                  {info.baseUrl || '（未设置端点）'}
                  {info.apiKeyMasked && (
                    <>
                      <span className="mx-1.5">·</span>
                      Key {info.apiKeyMasked}
                    </>
                  )}
                  {info.model && (
                    <>
                      <span className="mx-1.5">·</span>
                      {info.model}
                    </>
                  )}
                  {info.hasToken && (
                    <>
                      <span className="mx-1.5">·</span>
                      含 X-Token
                    </>
                  )}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{sourceMeta.hint}</p>
            </div>

            {/* 表单 */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ai-base-url">API 端点</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://open.bigmodel.cn/api/paas/v4"
                  autoComplete="url"
                  inputMode="url"
                  className="h-11 sm:h-10"
                />
                <p className="text-xs text-muted-foreground">
                  OpenAI 兼容端点，如智谱 open.bigmodel.cn/api/paas/v4、DeepSeek api.deepseek.com、自建 OneAPI 等。
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="ai-api-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      info?.apiKeyMasked
                        ? `留空沿用已保存的 Key（${info.apiKeyMasked}）`
                        : 'sk-…'
                    }
                    autoComplete="off"
                    className="h-11 pr-10 sm:h-10"
                  />
                  <button
                    type="button"
                    aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-model">
                  模型名<span className="ml-1 text-xs font-normal text-muted-foreground">（可选）</span>
                </Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="如 deepseek-chat、glm-4-flash；留空 = 由服务端决定"
                  autoComplete="off"
                  className="h-11 sm:h-10"
                />
                <p className="text-xs text-muted-foreground">
                  DeepSeek 等「要求必传 model」的端点必须填写，否则请求会被拒绝。
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-token">
                  X-Token<span className="ml-1 text-xs font-normal text-muted-foreground">（可选，仅 Z.ai 私有端点需要）</span>
                </Label>
                <Input
                  id="ai-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="一般端点留空即可"
                  autoComplete="off"
                  className="h-11 sm:h-10"
                />
              </div>
            </div>

            {/* 测试结果 */}
            {testResult && (
              <div
                role="status"
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3 text-sm',
                  testResult.ok
                    ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 break-all">
                  {testResult.ok ? (
                    <>
                      连接成功 · {testResult.latencyMs}ms
                      {testResult.reply && <span className="block text-xs opacity-80">模型回复：{testResult.reply}</span>}
                    </>
                  ) : (
                    <>
                      连接失败（{testResult.latencyMs}ms）
                      <span className="block text-xs opacity-80">{testResult.error}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 操作区 */}
            <div className="flex flex-wrap items-center gap-2">
              {isDbSource && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-9"
                      disabled={clearing || saving}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      清除配置
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>清除界面保存的 AI 配置？</AlertDialogTitle>
                      <AlertDialogDescription>
                        保存的端点和 Key 会被删除。若部署时配过环境变量，AI 会回落到那份配置；否则 AI 功能将不可用。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleClear()}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        清除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => void handleTest()}
                disabled={testing || saving || !baseUrl.trim()}
              >
                {testing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlugZap className="size-4" aria-hidden="true" />}
                测试连接
              </Button>
              <Button
                className="ml-auto h-11 sm:h-9"
                onClick={() => void handleSave()}
                disabled={testing || saving || !baseUrl.trim()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                保存
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
