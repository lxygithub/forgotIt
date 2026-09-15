// Cloudflare Workers 运行时访问助手（双部署支持，v1.3）
// 仅当 DB_DRIVER=d1 / STORAGE_DRIVER=r2 时才会被实际调用；Node 部署永不触碰。
// binding 约定见 web/wrangler.jsonc：D1 → "DB"，R2 → "BUCKET"。
//
// 说明：@opennextjs/cloudflare/cloudflare-context 是自包含模块（读取 worker 入口
// 预埋在 globalThis 的上下文），在 Node 侧仅被解析、从不执行，不影响现有部署。
import { PrismaD1 } from '@prisma/adapter-d1';
import { getCloudflareContext } from '@opennextjs/cloudflare/cloudflare-context';

export type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

export interface R2ObjectLike {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
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
  DB: D1Binding;
  BUCKET: R2BucketLike;
}

function env(): CloudflareEnv {
  return getCloudflareContext().env as unknown as CloudflareEnv;
}

export function getD1Binding(): D1Binding {
  const binding = env()?.DB;
  if (!binding) {
    throw new Error(
      'DB_DRIVER=d1 未找到 D1 binding：检查 wrangler.jsonc 中 d1_databases.binding 是否为 "DB"'
    );
  }
  return binding;
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
