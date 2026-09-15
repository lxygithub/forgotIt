// 生成 scrypt 密码哈希（单用户鉴权，方案 A）
// 用法：bun run hash-password <你的密码>
// 产出 AUTH_PASSWORD_HASH=... 写入 .env，并删除明文 AUTH_PASSWORD 行

import { hashPassword } from '../src/lib/password';

const password = process.argv[2];

if (!password) {
  console.error('用法：bun run hash-password <你的密码>');
  console.error('（密码会留在 shell 历史里，介意的话用完请清理历史）');
  process.exit(1);
}

if (password.length < 8) {
  console.error('建议密码长度 ≥ 8 位，太短的钥匙配不上你的脑子。');
  process.exit(1);
}

const hash = await hashPassword(password);

console.log('\n已生成。将 .env 中的明文 AUTH_PASSWORD 行删除，替换为：\n');
console.log(`AUTH_PASSWORD_HASH=${hash}`);
console.log('\n改完重启服务（生产环境重新 build）即可生效。\n');
