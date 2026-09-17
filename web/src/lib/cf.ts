// Cloudflare Workers 运行时访问助手
// 数据库已迁往自建 PostgreSQL，连接逻辑见 src/lib/db.ts（走 SQL Gateway）；
// 这里只负责对象存储 R2。
// binding 约定见 web/wrangler.jsonc：R2 → "BUCKET"。
//
// 说明：@opennextjs/cloudflare/cloudflare-context 是自包含模块（读取 worker 入口
// 预埋在 globalThis 的上下文），在 Node 侧仅被解析、从不执行，不影响现有部署。
import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context';

export interface R2ObjectLike {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
  /** 对象字节数（/api/ai-assets 依赖它回 Content-Length，供下载进度计算） */
  size?: number;
  /** R2 返回的 HTTP 形态 ETag（弱验证用，可缺省） */
  httpEtag?: string;
}

export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<unknown>;
}

interface CloudflareEnv {
  BUCKET: R2BucketLike;
}

function env(): CloudflareEnv {
  return getCloudflareContext().env as unknown as CloudflareEnv;
}

export function getR2Bucket(): R2BucketLike {
  const bucket = env()?.BUCKET;
  if (!bucket) {
    throw new Error(
      'STORAGE_DRIVER=r2 未找到 R2 binding：检查 wrangler.jsonc 中 r2_buckets.binding 是否为 "BUCKET"'
    );
  }
  return bucket;
}
