#!/usr/bin/env bun
// 从 prisma/schema.prisma 派生 Workers 专用 schema（单一事实源，防漂移）：
//  - 换用新一代 prisma-client 生成器，runtime=workerd
//    （wasm 引擎经 `import('./query_engine_bg.wasm?module')` 静态加载，
//     与 wrangler 的 wasm 约定和 OpenNext 的 Turbopack wasm 补丁兼容；
//     旧 prisma-client-js 的 #wasm-engine-loader 动态导入在 OpenNext esbuild 上不可用）
//  - 输出到 src/generated/prisma-worker（已 gitignore，build:cf 时自动重新生成）
//  - 数据模型与主 schema 完全一致（本脚本仅替换 generator 块）
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'prisma/schema.prisma';
const DST = 'prisma/schema.workers.prisma';

const WORKER_GENERATOR = `generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma-worker"
  runtime      = "workerd"
  moduleFormat = "esm"
}`;

const src = readFileSync(SRC, 'utf8');
if (!/generator client \{[\s\S]*?\n\}/.test(src)) {
  console.error('[gen-workers-schema] 主 schema 缺少 generator client 块');
  process.exit(1);
}
const out = src.replace(/generator client \{[\s\S]*?\n\}/, WORKER_GENERATOR);
writeFileSync(DST, out);
console.log('[gen-workers-schema] wrote', DST);
