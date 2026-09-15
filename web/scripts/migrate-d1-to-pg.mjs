#!/usr/bin/env bun
// 把 D1 导出的 JSON 数据迁移到 PostgreSQL（2026-09 从 D1 迁往自建 PG 时使用）
//
// 前置：先把各表导出到 /tmp/d1-export/<表名>.json
//   for t in Note Tag NoteTag Attachment Embedding SyncLog ConflictSnapshot Tombstone; do
//     npx wrangler d1 execute forgotit --remote --json --config web/wrangler.jsonc \
//       --command "SELECT * FROM \"$t\"" > /tmp/d1-export/$t.json
//   done
//
// 转换规则（已在真实数据上核对）：
//   - SQLite 的 boolean 存的是 0/1，PostgreSQL 的 boolean 不接受整数 → 显式转换
//   - 时间戳是 ISO 字符串（含毫秒与偏移），直接交给 PG 的 TIMESTAMP(3)，
//     毫秒精度必须保留 —— LWW 冲突解决依赖毫秒比较
//   - semanticKeywords / vector / losingPayload 是 JSON 字符串，原样搬运，
//     绝不能 JSON.parse 再回写（浮点往返会改变向量）
//
// 可重复执行：开头会按外键依赖倒序 TRUNCATE。
import { readFileSync } from 'node:fs';
import pg from 'pg';

const PG_URL =
  process.env.PG_URL ?? 'postgres://forgotit:forgotit@127.0.0.1:5432/forgotit';

// 按外键依赖排序：被引用的先插
const TABLES = [
  'Tag',
  'Note',
  'Attachment',
  'Embedding',
  'NoteTag',
  'SyncLog',
  'ConflictSnapshot',
  'Tombstone',
];

// 需要把 0/1 转成 false/true 的字段
const BOOL_FIELDS = {
  Note: ['localOnly', 'pinned'],
  ConflictSnapshot: ['resolved'],
};

const client = new pg.Client({ connectionString: PG_URL });
await client.connect();

// 清空（倒序，避免外键报错）；CASCADE 兜底
for (const t of [...TABLES].reverse()) {
  await client.query(`TRUNCATE TABLE "${t}" CASCADE`);
}

let total = 0;
for (const table of TABLES) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(`/tmp/d1-export/${table}.json`, 'utf8'))[0].results;
  } catch {
    console.log(`  ${table.padEnd(18)} (无导出文件，跳过)`);
    continue;
  }
  if (!rows.length) {
    console.log(`  ${table.padEnd(18)} 0 行`);
    continue;
  }

  const bools = BOOL_FIELDS[table] ?? [];
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c];
      if (bools.includes(c)) return v === 1 || v === true;
      return v;
    });
    await client.query(sql, values);
  }
  console.log(`  ${table.padEnd(18)} ${rows.length} 行`);
  total += rows.length;
}

// 显式插入过 seq 之后，把序列推到最大值，避免后续自增撞主键
await client.query(
  `SELECT setval('"SyncLog_seq_seq"', COALESCE((SELECT MAX(seq) FROM "SyncLog"), 0) + 1, false)`
);

await client.end();
console.log(`\n迁移完成：共 ${total} 行`);
