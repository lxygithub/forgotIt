'use client';

// 端侧 OCR（Tesseract.js，WASM 跑在浏览器自动开的 Web Worker 里）
//
// 用途：粘贴/上传图片时在**设备内**提取文字（印刷体），配合端侧整理或
// 作为正文素材；服务端 VLM 的「看图写描述」能力仍由服务端链路兜底。
//
// 成本说明：中文语言包（chi_sim best_int，约 20-40MB）首次使用时下载并缓存
// 于浏览器，之后离线可用。worker 单例复用，识别完不销毁（连续贴图场景免
// 重复初始化）。
//
// 打包约束：tesseract.js 主线程库与其 core WASM（约 44MB）必须留在构建图外，
// 一律经 assets.ts 运行时 URL 加载；worker/core/语言包在生产环境全部走
// 同源 R2（/api/ai-assets/*），本地开发回落官方 CDN。

import { getEngineState } from './engine';
import { loadTesseract, ocrWorkerPaths } from './assets';

export type OcrPhase = 'idle' | 'initializing' | 'recognizing' | 'done' | 'error';

interface OcrState {
  phase: OcrPhase;
  /** 0-1，初始化下载语言包与识别阶段都会推进 */
  progress: number;
  error?: string;
}

let state: OcrState = { phase: 'idle', progress: 0 };
const listeners = new Set<(s: OcrState) => void>();

function setState(next: Partial<OcrState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function getOcrState(): OcrState {
  return state;
}

export function subscribeOcr(listener: (s: OcrState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let tesseractWorker: import('tesseract.js').Worker | null = null;
let initPromise: Promise<import('tesseract.js').Worker> | null = null;

async function ensureTesseractWorker(): Promise<import('tesseract.js').Worker> {
  if (tesseractWorker) return tesseractWorker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    setState({ phase: 'initializing', progress: 0, error: undefined });
    // 运行时 URL import：tesseract.js 主线程库不进 bundle
    const { createWorker } = await loadTesseract();
    const worker = await createWorker('chi_sim+eng', 1, {
      // self 模式：worker 脚本 / core WASM / 语言包全部同源 R2；
      // cdn 模式传 undefined，回落 tesseract 官方 CDN 默认值
      ...ocrWorkerPaths(),
      logger: (m) => {
        if (m.progress !== undefined) setState({ progress: Math.min(1, Math.max(0, m.progress)) });
      },
    });
    tesseractWorker = worker;
    setState({ phase: 'idle', progress: 0 });
    return worker;
  })();

  try {
    return await initPromise;
  } catch (err) {
    setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    initPromise = null;
    throw err;
  } finally {
    // 让下一次失败后可重试
    if (!tesseractWorker) initPromise = null;
  }
}

/**
 * 识别图片中的文字（印刷体中文 + 英文）。
 * @param image File / Blob / dataURL
 * @returns 识别文本（trim 后；无文字时为空串）。失败抛错，由调用方降级。
 */
export async function ocrImageText(image: File | Blob | string): Promise<string> {
  // 引擎不可用时直接失败，让上层走服务端链路（不在 OCR 层静默降级，职责分离）
  if (getEngineState().status === 'unsupported' && !tesseractWorker) {
    // Tesseract 是 WASM，不依赖 WebGPU——浏览器本身能跑，仅受内存约束，
    // 因此这里不做 WebGPU 联动拦截，真正不支持时会在 createWorker 处抛错。
  }
  const worker = await ensureTesseractWorker();
  setState({ phase: 'recognizing', progress: 0, error: undefined });
  try {
    const { data } = await worker.recognize(image);
    setState({ phase: 'done', progress: 1 });
    return (data.text ?? '').trim();
  } catch (err) {
    setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** 释放 OCR worker（少用：浏览器刷新即回收；保留给设置页「清理端侧资源」） */
export async function disposeOcr(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate().catch(() => undefined);
    tesseractWorker = null;
    initPromise = null;
    setState({ phase: 'idle', progress: 0 });
  }
}
