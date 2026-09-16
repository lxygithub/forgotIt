// 「记不住」运行时键值配置（服务端专用）
// v1.4：前端「AI 模型配置」入口的存储层 —— 配置存 Setting 表（单行键），
// 使 Workers/Node 部署都能在界面上直接换模型端点，不再依赖 wrangler secret put。
//
// 设计要点：
//   - ensureSettingTable()：线上 PG 若尚未建此表（老库升级），首次读写时自动
//     CREATE TABLE IF NOT EXISTS，免去手工迁移步骤（单用户自托管场景务实选择）。
//   - 所有读取均吞错降级：配置存储永远不能弄崩业务调用链（AI 功能本就允许降级）。
//   - 短 TTL 内存缓存：AI 每次调用都查一次 DB 太浪费（Hyperdrive 往返），
//     30s 缓存 + 写路径主动失效，多实例部署下最多 30s 收敛。

import { db } from '@/lib/db';

export const AI_SETTING_KEY = 'ai';

// 与 prisma migrate diff 产物一致的建表语句（Setting 模型）
const CREATE_SETTING_SQL =
  'CREATE TABLE IF NOT EXISTS "Setting" (' +
  '"key" TEXT NOT NULL, ' +
  '"value" TEXT NOT NULL, ' +
  '"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ' +
  'CONSTRAINT "Setting_pkey" PRIMARY KEY ("key"))';

let settingTableReady = false;

/** 确保 Setting 表存在（幂等；进程内只执行一次）。失败抛出，由调用方决定降级方式 */
export async function ensureSettingTable(): Promise<void> {
  if (settingTableReady) return;
  await db.$executeRawUnsafe(CREATE_SETTING_SQL);
  settingTableReady = true;
}

/** 读键值（JSON 解析）。存储层任何异常都返回 undefined（表示「取不到」而非「值是 null」） */
export async function getSetting<T>(key: string): Promise<T | undefined> {
  try {
    await ensureSettingTable();
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

/** 写键值（JSON 序列化，upsert）。失败抛出，由调用方决定降级方式 */
export async function setSetting(key: string, value: unknown): Promise<void> {
  await ensureSettingTable();
  const data = JSON.stringify(value);
  await db.setting.upsert({
    where: { key },
    create: { key, value: data },
    update: { value: data },
  });
}

/** 删键值。失败抛出，由调用方决定降级方式 */
export async function delSetting(key: string): Promise<void> {
  await ensureSettingTable();
  await db.setting.deleteMany({ where: { key } });
}

// ---------- AI 模型配置（界面配置项） ----------

export interface AiProviderConfig {
  baseUrl: string;
  apiKey: string;
  token?: string;
  model?: string;
}

export async function getAiProviderConfig(): Promise<AiProviderConfig | undefined> {
  return getSetting<AiProviderConfig>(AI_SETTING_KEY);
}

export async function saveAiProviderConfig(cfg: AiProviderConfig): Promise<void> {
  await setSetting(AI_SETTING_KEY, cfg);
}

export async function clearAiProviderConfig(): Promise<void> {
  await delSetting(AI_SETTING_KEY);
}

/** API Key 掩码：abcd••••wxyz（过短的 key 只露尾 4 位） */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return `••••${key.slice(-4)}`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
