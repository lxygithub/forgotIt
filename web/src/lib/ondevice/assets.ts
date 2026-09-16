'use client';

// 端侧资源定位与运行时加载（v1.5.1）
//
// 为什么需要这个模块：
//   @mlc-ai/web-llm（lib/index.js 约 6.6MB）与 tesseract.js-core（6 个 WASM 变体共约 44MB）
//   一旦出现在 Next 的 SSR 模块图里（哪怕是 client 组件里的动态 import），就会被
//   OpenNext 打进 Worker bundle，触发 Cloudflare 64MiB 未压缩上限（2026-09 生产
//   部署 10027 报错的根因）。因此约定：
//
//   1) 这些库的代码一律通过 `new Function('return import(url)')` 在浏览器运行时
//      按需加载——bundler 无法静态分析 new Function 的内容，构建产物中对它们
//      保持零引用（包本体已移入 devDependencies，仅提供类型）。
//   2) 库文件、模型权重、OCR 语言包等大资源自托管在 R2（复用 wrangler.jsonc 的
//      BUCKET，key 前缀 `ai-assets/v1/`），经同源路由 /api/ai-assets/* 提供。
//      上传命令：`bun run upload:ai-assets`（scripts/upload-ai-assets.mjs）。
//
// 双模式（ONDEVICE_ASSET_SOURCE）：
//   - self（生产默认）：全部走同源 R2。首次下载后浏览器/Cache API 持久化，离线可用。
//   - cdn（仅本地开发回退）：库走 jsdelivr、权重走 HuggingFace（即两个库的官方
//     默认行为），用于沙盒/本地无 R2 binding 时的 UI 调试。生产构建永远不会
//     使用该模式（NODE_ENV !== 'development' 时缺省为 self）。
//
// 版本升级：更换模型/库版本时把 R2_PREFIX 里的 v1 升到 v2 并重跑上传脚本
// （旧版本对象可手动清理），浏览器侧 immutable 缓存因此可以放心开一年。

export type OnDeviceAssetSource = 'self' | 'cdn';

/** R2 同源路由 + 版本前缀（与 scripts/upload-ai-assets.mjs 的 R2_PREFIX 保持一致） */
const R2_PREFIX = '/api/ai-assets/v1';

/** 资源来源：生产 self，开发默认 cdn（可用 NEXT_PUBLIC_ONDEVICE_ASSET_SOURCE 强制覆盖） */
export const ONDEVICE_ASSET_SOURCE: OnDeviceAssetSource =
  (process.env.NEXT_PUBLIC_ONDEVICE_ASSET_SOURCE as OnDeviceAssetSource | undefined) ??
  (process.env.NODE_ENV === 'development' ? 'cdn' : 'self');

/** self 模式同源基址（带尾斜杠） */
export function selfAssetBase(): string {
  return `${R2_PREFIX}/`;
}

/**
 * bundler 不透明的运行时动态 import。
 * 必须用 new Function 包一层：直接写 `import(url)` 会被 webpack/turbopack 改写
 * 并把目标（或其报错）编进构建产物，破坏「零引用」约定。
 */
const runtimeImport = new Function('url', 'return import(url);') as (
  url: string
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// WebLLM
// ---------------------------------------------------------------------------

const WEBLLM_VERSION = '0.2.85';

/** web-llm ESM 入口（self=自托管 R2；cdn=jsdelivr 官方包文件） */
export function webllmEsmUrl(): string {
  return ONDEVICE_ASSET_SOURCE === 'self'
    ? `${R2_PREFIX}/webllm/lib/index.js`
    : `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/lib/index.js`;
}

/** 运行时加载 web-llm（绝不能被静态 import） */
export async function loadWebllm(): Promise<typeof import('@mlc-ai/web-llm')> {
  return (await runtimeImport(webllmEsmUrl())) as typeof import('@mlc-ai/web-llm');
}

/** 本方案在 R2 自托管权重的模型（与 prefs.ts 的档位一致） */
const SELF_HOSTED_MODEL_IDS = new Set<string>([
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
]);

const HF_MODEL_PREFIX = 'https://huggingface.co/';
const MLC_LIBS_PREFIX = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/';

/**
 * 构造指向自托管 R2 的 AppConfig：把预置 model_list 里两个 Qwen 档位的
 * 权重地址（HuggingFace）与 model_lib 地址（GitHub raw）重写到 /api/ai-assets/*。
 * cdn 模式返回 undefined → WebLLM 使用自己的预置配置（官方默认行为）。
 */
export function selfHostedAppConfig(
  webllm: typeof import('@mlc-ai/web-llm')
): import('@mlc-ai/web-llm').AppConfig | undefined {
  if (ONDEVICE_ASSET_SOURCE !== 'self') return undefined;
  const base = selfAssetBase();
  return {
    ...webllm.prebuiltAppConfig,
    model_list: webllm.prebuiltAppConfig.model_list
      .filter((m) => SELF_HOSTED_MODEL_IDS.has(m.model_id))
      .map((m) => ({
        ...m,
        model: m.model.startsWith(HF_MODEL_PREFIX)
          ? `${base}hf/${m.model.slice(HF_MODEL_PREFIX.length)}`
          : m.model,
        model_lib: m.model_lib.startsWith(MLC_LIBS_PREFIX)
          ? `${base}libs/${m.model_lib.slice(MLC_LIBS_PREFIX.length)}`
          : m.model_lib,
      })),
  };
}

// ---------------------------------------------------------------------------
// Tesseract.js（OCR）
// ---------------------------------------------------------------------------

const TESSERACT_VERSION = '7.0.0';

/** tesseract.js 主线程 ESM 入口（worker/core/语言包路径见 ocrWorkerPaths） */
export function tesseractEsmUrl(): string {
  return ONDEVICE_ASSET_SOURCE === 'self'
    ? `${R2_PREFIX}/tesseract/tesseract.esm.min.js`
    : `https://cdn.jsdelivr.net/npm/tesseract.js@v${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
}

/** 运行时加载 tesseract.js（绝不能被静态 import） */
export async function loadTesseract(): Promise<typeof import('tesseract.js')> {
  return (await runtimeImport(tesseractEsmUrl())) as typeof import('tesseract.js');
}

export interface OcrAssetPaths {
  /** worker 脚本（tesseract 会先 fetch 再建 Blob Worker，同源/跨域皆可） */
  workerPath: string;
  /** core 目录（内含 6 个变体的 .wasm.js 胶水 + .wasm，按 SIMD/LSTM 特性自动挑选） */
  corePath: string;
  /** 语言包目录（内含 {lang}.traineddata.gz，会拼 `${langPath}/${lang}.traineddata.gz`） */
  langPath: string;
}

/**
 * OCR 资源路径。cdn 模式返回 undefined → 用 tesseract 官方 CDN 默认值；
 * self 模式指向同源 R2（与上传脚本的 key 布局一一对应）。
 */
export function ocrWorkerPaths(): OcrAssetPaths | undefined {
  if (ONDEVICE_ASSET_SOURCE !== 'self') return undefined;
  return {
    workerPath: `${R2_PREFIX}/tesseract/worker.min.js`,
    corePath: `${R2_PREFIX}/tesseract-core/`,
    langPath: `${R2_PREFIX}/tessdata`,
  };
}
