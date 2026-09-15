// 本地磁盘存储：与 v1.x 行为逐字节一致（public/uploads + /uploads/ 静态访问）
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import type { StorageAdapter, StoredFile } from './index';
import { guessMime } from './mime';

function uploadDir(): string {
  return path.join(process.cwd(), 'public', 'uploads');
}

/** 公开路径 → 磁盘路径；白名单正则防目录穿越 */
function toDiskPath(publicPath: string): string | null {
  const match = publicPath.match(/^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  return match ? path.join(uploadDir(), match[1]) : null;
}

export const localStorage: StorageAdapter = {
  async save(fileName, data) {
    const dir = uploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), data);
    return `/uploads/${fileName}`;
  },

  async get(publicPath): Promise<StoredFile | null> {
    const diskPath = toDiskPath(publicPath);
    if (!diskPath) return null;
    try {
      const data = new Uint8Array(await readFile(diskPath));
      return { data, mime: guessMime(publicPath) };
    } catch {
      return null;
    }
  },

  async remove(publicPath) {
    const diskPath = toDiskPath(publicPath);
    if (!diskPath) return;
    try {
      await unlink(diskPath);
    } catch {
      // 幂等：文件不存在视为已删除
    }
  },
};
