// 上传存储抽象（双部署支持，v1.3）
//  - local（默认）：本地磁盘 public/uploads，行为与 v1.x 完全一致（/uploads/ 静态访问）
//  - r2：Cloudflare R2（Workers 部署），读取统一走 /uploads/[...key] 路由
// 切换开关：环境变量 STORAGE_DRIVER（缺省 local），见部署文档 §11
import { localStorage } from './local';
import { r2Storage } from './r2';

export interface StoredFile {
  data: Uint8Array;
  mime: string;
}

export interface StorageAdapter {
  /** 保存文件，返回公开访问路径（/uploads/<name>） */
  save(fileName: string, data: Uint8Array, mime: string): Promise<string>;
  /** 按公开路径读取；不存在时返回 null */
  get(publicPath: string): Promise<StoredFile | null>;
  /** 删除（幂等） */
  remove(publicPath: string): Promise<void>;
}

export function getStorage(): StorageAdapter {
  return process.env.STORAGE_DRIVER === 'r2' ? r2Storage : localStorage;
}
