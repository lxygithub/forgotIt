// /api/ai-assets/* —— 端侧 AI 自托管资源出口（v1.5.1）
//
// 把 R2（wrangler.jsonc 的 BUCKET，key 前缀 ai-assets/）里的静态资产以**同源**
// 方式提供给浏览器：
//   - web-llm ESM（/webllm/lib/index.js）
//   - WebLLM 模型权重与 mlc-chat-config（/hf/mlc-ai/<repo>/*，镜像 HuggingFace 布局）
//   - WebLLM model_lib WASM（/libs/web-llm-models/...，镜像 GitHub raw 布局）
//   - Tesseract worker / core WASM / 语言包（/tesseract*、/tessdata/*）
//
// 设计要点：
//   - 免鉴权（proxy.ts matcher 放行）：这里只有公共模型文件，不含任何用户数据；
//     同源也免去 WebLLM/Tesseract 在 Worker/Cache 场景下的 CORS 与 cookie 纠缠
//   - R2 对象体直接流式转发（绝不读进内存）：模型 shard 可达百 MB 级，
//     Workers 只有 128MB 内存，缓冲即 OOM
//   - Content-Length 必给：WebLLM 的下载进度条依赖它按 shard 汇总百分比
//   - immutable 缓存一年：资源版本化在 key 里（ai-assets/v1/...），升级时升版本
//     前缀重传，见 src/lib/ondevice/assets.ts 顶部说明
import { NextRequest, NextResponse } from 'next/server';
import { getR2Bucket } from '@/lib/cf';

export const dynamic = 'force-dynamic';

const MIME_BY_EXT: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  gz: 'application/octet-stream', // tesseract 语言包（worker 内自行解压）
  bin: 'application/octet-stream', // 模型权重 shard
  model: 'application/octet-stream',
};

function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function objectKey(segments: string[]): string | null {
  // Next 已按 / 解码分段；拒绝路径穿越与内嵌斜杠
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\0')) {
      return null;
    }
  }
  return `ai-assets/${segments.join('/')}`;
}

function assetHeaders(key: string, size: number, etag?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(key),
    'Content-Length': String(size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };
  if (etag) headers.ETag = etag;
  return headers;
}

async function serve(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const key = objectKey(segments);
  if (!key) return new NextResponse('Bad Request', { status: 400 });

  try {
    const obj = await getR2Bucket().get(key);
    if (!obj) return new NextResponse('Not Found', { status: 404 });

    const headers = assetHeaders(key, obj.size ?? 0, obj.httpEtag);
    if (req.method === 'HEAD') return new NextResponse(null, { headers });
    return new NextResponse(obj.body as unknown as BodyInit, { headers });
  } catch (err) {
    // 典型场景：本地 Node dev 无 Cloudflare binding（开发请用 cdn 资源模式）
    console.error('[GET /api/ai-assets]', err);
    return new NextResponse('Asset Storage Unavailable', { status: 503 });
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return serve(req, path ?? []);
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  return serve(req, path ?? []);
}
