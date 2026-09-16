'use client';

// 端侧 AI 设置区块（v1.5）——嵌在「AI 模型配置」对话框底部
//
// 三级降级链的第一级的控制台：
//   - WebGPU 能力检测：不支持则整块禁用并说明（三级链自动只剩服务端级）
//   - 启用开关 + 模型档位（0.5B/1.5B，Qwen2.5 量化版）
//   - 首次启用触发权重下载（Cache API 持久化，之后离线可用），进度实时可见
//   - 出错可重试；「清理模型缓存」真正删掉本地权重释放空间

import { useEffect, useRef, useState } from 'react';
import { Cpu, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { disposeEngine, ensureReady, getEngineState, probeWebGpu, subscribeEngine, type EngineState } from '@/lib/ondevice/engine';
import { loadWebllm, selfHostedAppConfig } from '@/lib/ondevice/assets';
import {
  getOnDeviceModelId,
  getOnDevicePrefs,
  ONDEVICE_MODEL_OPTIONS,
  setOnDeviceEnabled,
  setOnDeviceModelId,
  type OnDeviceModelId,
} from '@/lib/ondevice/prefs';

const STATUS_META: Record<EngineState['status'], { label: string; className: string }> = {
  unsupported: { label: '设备不支持', className: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500' },
  idle: { label: '未加载', className: 'border-muted-foreground/30 bg-muted text-muted-foreground' },
  loading: { label: '下载/加载中', className: 'border-sky-600/30 bg-sky-600/10 text-sky-700 dark:text-sky-400' },
  ready: { label: '就绪', className: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  error: { label: '出错', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

export function OnDeviceSettingsSection() {
  const [webgpuOk, setWebgpuOk] = useState<boolean | null>(null); // null=检测中
  const [enabled, setEnabled] = useState(false);
  const [modelId, setModelId] = useState<OnDeviceModelId>(getOnDeviceModelId());
  const [engine, setEngineState] = useState<EngineState>(getEngineState());
  const [clearing, setClearing] = useState(false);
  const enabledRef = useRef(false);

  // 订阅引擎状态（下载进度/就绪/出错实时反映）
  useEffect(() => subscribeEngine(setEngineState), []);

  // 挂载：WebGPU 探测 + 回读偏好
  useEffect(() => {
    let cancelled = false;
    void probeWebGpu().then((ok) => {
      if (!cancelled) setWebgpuOk(ok);
    });
    const prefs = getOnDevicePrefs();
    setEnabled(prefs.enabled);
    enabledRef.current = prefs.enabled;
    setModelId(prefs.modelId);
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = engine.status === 'loading';

  const handleToggle = async (next: boolean) => {
    setEnabled(next);
    enabledRef.current = next;
    setOnDeviceEnabled(next);
    if (!next) {
      // 停用：卸载模型释放内存（权重缓存保留，下次启用免重下）
      disposeEngine();
      toast.success('端侧 AI 已停用，整理将走服务端。');
      return;
    }
    if (webgpuOk === false) {
      toast.error('当前设备/浏览器不支持 WebGPU，无法启用端侧 AI。');
      setEnabled(false);
      enabledRef.current = false;
      setOnDeviceEnabled(false);
      return;
    }
    try {
      await ensureReady(modelId);
      toast.success('端侧 AI 已就绪，笔记整理会优先在本设备完成。');
    } catch (err) {
      toast.error(err instanceof Error ? `端侧引擎加载失败：${err.message}` : '端侧引擎加载失败');
    }
  };

  const handleModelChange = async (next: OnDeviceModelId) => {
    setModelId(next);
    setOnDeviceModelId(next);
    if (enabledRef.current) {
      try {
        await ensureReady(next);
        toast.success(`已切换到 ${ONDEVICE_MODEL_OPTIONS.find((o) => o.id === next)?.label ?? next}。`);
      } catch (err) {
        toast.error(err instanceof Error ? `模型切换失败：${err.message}` : '模型切换失败');
      }
    }
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      disposeEngine();
      const webllm = await loadWebllm();
      // 传入 selfHostedAppConfig：self 模式下缓存键基于 R2 地址，需按同一份
      // 配置查找；cdn 模式返回 undefined，走官方预置（HuggingFace 地址）
      await webllm.deleteModelAllInfoInCache(modelId, selfHostedAppConfig(webllm));
      toast.success('已清理该模型的本地缓存。');
    } catch (err) {
      toast.error(err instanceof Error ? `清理失败：${err.message}` : '清理失败');
    } finally {
      setClearing(false);
    }
  };

  const meta = STATUS_META[engine.status];
  const disabled = webgpuOk === false;

  return (
    <section aria-label="端侧 AI 设置" className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="size-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-medium">端侧 AI（在本设备上推理）</span>
        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
        {webgpuOk === null && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" /> 检测 WebGPU…
          </span>
        )}
        <div className="ml-auto">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            disabled={disabled || webgpuOk === null}
            aria-label="启用端侧 AI"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {disabled
          ? '此设备的浏览器不支持 WebGPU，端侧 AI 不可用；笔记整理将继续使用下方配置的服务端模型。'
          : '启用后，笔记整理/自动标题会优先用本设备的模型完成，笔记内容不出设备；引擎不可用时自动回落到服务端模型。首次启用需下载模型权重（之后离线可用）。'}
      </p>

      {!disabled && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="ondevice-model" className="text-xs text-muted-foreground">模型档位</Label>
            <Select value={modelId} onValueChange={(v) => void handleModelChange(v as OnDeviceModelId)}>
              <SelectTrigger id="ondevice-model" className="h-9 w-auto min-w-52" aria-label="选择端侧模型档位">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ONDEVICE_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label} · {option.sizeHint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {ONDEVICE_MODEL_OPTIONS.find((o) => o.id === modelId)?.description}
          </p>

          {busy && (
            <div className="space-y-1.5" role="status">
              <Progress value={engine.progress * 100} aria-label="模型下载进度" />
              <p className="break-all text-xs text-muted-foreground">
                {Math.round(engine.progress * 100)}% · {engine.progressText || '下载中…'}
              </p>
            </div>
          )}

          {engine.status === 'error' && engine.error && (
            <p className="break-all text-xs text-destructive">{engine.error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {engine.status === 'idle' || engine.status === 'error' ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => void handleToggle(true)}
                disabled={webgpuOk === null}
              >
                <RefreshCcw className="size-3.5" aria-hidden="true" />
                下载并启用
              </Button>
            ) : null}
            {engine.status === 'ready' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void handleClearCache()}
                disabled={clearing}
              >
                {clearing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
                清理模型缓存
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
