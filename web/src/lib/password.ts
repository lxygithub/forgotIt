// 「记不住」密码校验工具（方案 A：单用户鉴权）
// 推荐生产使用 scrypt 哈希（AUTH_PASSWORD_HASH，用 `bun run hash-password` 生成）；
// 开发/快速体验可直接用明文（AUTH_PASSWORD），verify 时走恒定时间比较。

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

/** 生成 scrypt 哈希，格式：scrypt$<salt hex>$<hash hex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/**
 * 校验密码：
 * - 存储值以 scrypt$ 开头 → 按 scrypt 哈希校验（恒定时间比较）
 * - 否则视为明文配置 → 恒定时间字符串比较
 */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!password || !stored) return false;

  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const derived = await scryptAsync(password, salt);
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  const a = Buffer.from(password, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
