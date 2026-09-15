// Cloudflare R2 存储（Workers 部署专用，STORAGE_DRIVER=r2 时启用）
// 键空间约定：uploads/<fileName>；公开路径仍是 /uploads/<fileName>，
// 读取统一经 src/app/uploads/[...key]/route.ts（受 proxy.ts 门禁保护）。
import { getR2Bucket } from '@/lib/cf';
import type { StorageAdapter, StoredFile } from './index';
import { guessMime } from './mime';

const PUBLIC_PATH_RE = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

function toKey(publicPath: string): string | null {
  const match = publicPath.match(PUBLIC_PATH_RE);
  return match ? `uploads/${match[1]}` : null;
}

export const r2Storage: StorageAdapter = {
  async save(fileName, data, mime) {
    await getR2Bucket().put(`uploads/${fileName}`, data, {
      httpMetadata: { contentType: mime },
    });
    return `/uploads/${fileName}`;
  },

  async get(publicPath): Promise<StoredFile | null> {
    const key = toKey(publicPath);
    if (!key) return null;
    const object = await getR2Bucket().get(key);
    if (!object) return null;
    // workerd 的 ReadableStream 没有 .arrayBuffer()（Node 有）——用 Response 包装后读取，两端通用
    const buffer = await new Response(object.body as unknown as BodyInit).arrayBuffer();
    return {
      data: new Uint8Array(buffer),
      mime: object.httpMetadata?.contentType || guessMime(publicPath),
    };
  },

  async remove(publicPath) {
    const key = toKey(publicPath);
    if (!key) return;
    await getR2Bucket().delete(key);
  },
};
