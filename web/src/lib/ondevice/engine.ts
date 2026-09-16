'use client';

// 端侧 LLM 引擎单例（WebLLM + WebGPU，跑在 Web Worker 里）
//
// 职责：
//   - WebGPU 能力探测（不支持 → 上层直接走服务端，端侧静默缺席）
//   - 模型懒加载：首次点「启用端侧 AI」才 new Worker + 下载权重（Cache API 持久化）
//   - generate()：单条文本生成（整理任务用），串行化 + 超时兜底
//   - 状态 pub/sub：设置 UI 与编排层订阅同一份状态
//
// 不做的事（有意为之）：
//   - 不把 @mlc-ai/web-llm 打进首屏：只在 ensureReady() 时动态 import
//   - 不做流式输出：整理任务是「算完再入库」，非流式更简单可控

import { getOnDeviceModelId, type OnDeviceModelId } from './prefs';

export type EngineStatus = 'unsupported' | 'idle' | 'loading' | 'ready' | 'error';

export interface EngineState {
  status: EngineStatus;
  modelId: OnDeviceModelId | null;
  /** 0-1，仅 loading 阶段有意义 */
  progress: number;
  /** WebLLM 原始进度文案（下载 shard 等） */
  progressText: string;
  error?: string;
}

let state: EngineState = {
  status: 'idle',
  modelId: null,
  progress: 0,
  progressText: '',
};

const listeners = new Set<(s: EngineState) => void>();

function setState(next: Partial<EngineState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getEngineState(): EngineState {
  return state;
}

export function subscribeEngine(listener: (s: EngineState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** WebGPU 能力探测：navigator.gpu 存在且能拿到适配器（headless/老设备会返回 false） */
export async function probeWebGpu(): Promise<boolean> {
  try {
    // 结构化探测，不依赖 @webgpu/types（避免为一句类型引入一个 dev 依赖）
    const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
    if (!gpu?.requestAdapter) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

interface LoadedEngine {
  worker: Worker;
  engine: import('@mlc-ai/web-llm').MLCEngineInterface;
  modelId: OnDeviceModelId;
}

let loaded: LoadedEngine | null = null;
let ensurePromise: Promise<void> | null = null;

/** 确保引擎已加载目标模型（幂等；换档位时自动 reload，权重走浏览器缓存） */
export async function ensureReady(modelId?: OnDeviceModelId): Promise<void> {
  const target = modelId ?? getOnDeviceModelId();

  if (loaded && loaded.modelId === target && state.status === 'ready') return;
  if (ensurePromise) {
    await ensurePromise;
    if (loaded && loaded.modelId === target && state.status === 'ready') return;
    // 上一次加载在别的档位上：继续往下 reload
  }

  ensurePromise = (async () => {
    setState({ status: 'loading', modelId: target, progress: 0, progressText: '准备中…', error: undefined });
    try {
      // 动态 import：web-llm 体积可观，绝不能进首屏 bundle
      const webllm = await import('@mlc-ai/web-llm');

      if (!loaded) {
        const worker = new Worker(new URL('./worker.ts', import.meta.url));
        const engine = await webllm.CreateWebWorkerMLCEngine(worker, target, {
          initProgressCallback: (report) => {
            const progress = report.progress ?? 0;
            const quantized = Math.floor(progress * 100) / 100;
            if (quantized !== state.progress || report.text !== state.progressText) {
              setState({ progress: quantized, progressText: report.text });
            }
          },
        });
        loaded = { worker, engine, modelId: target };
      } else if (loaded.modelId !== target) {
        await loaded.engine.reload(target);
        loaded.modelId = target;
      }

      setState({ status: 'ready', modelId: target, progress: 1, progressText: '' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: message });
      // 加载失败即释放，避免半初始化状态
      disposeEngine();
    } finally {
      ensurePromise = null;
    }
  })();

  await ensurePromise;
}

/** 单条文本生成（串行化；整理任务专用） */
export async function generate(
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  if (!loaded || state.status !== 'ready') {
    throw new Error('端侧引擎尚未就绪');
  }
  const engine = loaded.engine;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  const run = (async () => {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 512,
      stream: false,
    });
    return completion.choices[0]?.message?.content ?? '';
  })();

  // web-llm 非流式不支持 abort：超时只能放弃本次结果并整体重置，
  // 避免半途请求长期占住引擎（重置后 reload 很快，权重已在本地缓存）。
  const timer = setTimeout(() => {
    void disposeEngine();
  }, timeoutMs);
  try {
    return await run;
  } finally {
    clearTimeout(timer);
  }
}

/** 卸载模型与 Worker（用户关闭端侧 AI / 出错重置时调用） */
export function disposeEngine(): void {
  if (loaded) {
    void loaded.engine.unload().catch(() => undefined);
    loaded.worker.terminate();
    loaded = null;
  }
  setState({ status: 'idle', modelId: null, progress: 0, progressText: '' });
}
