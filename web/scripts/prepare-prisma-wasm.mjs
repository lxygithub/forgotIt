#!/usr/bin/env bun
// 让 Prisma 引擎走 Wrangler 的静态 CompiledWasm import，而不是 webpack 产物中的
// `import(绝对路径)` / `WebAssembly.instantiate(bytes)`。后者被 Workers 明确禁止。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = '.open-next/server-functions/default';
const source = join(root, 'node_modules/.prisma/client/query_engine_bg.wasm');
const handler = join(root, 'handler.mjs');
const destination = '.open-next/static/wasm/prisma-query-engine.wasm';

if (!existsSync(source) || !existsSync(handler)) {
  console.error('[prepare-prisma-wasm] Prisma 或 OpenNext 产物缺失');
  process.exit(1);
}

mkdirSync('.open-next/static/wasm', { recursive: true });
copyFileSync(source, destination);
const original = readFileSync(handler, 'utf8');
const patched = original.replace(
  /wasm_worker_loader_default=import\("[^"]*\/query_engine_bg\.wasm"\)/,
  'wasm_worker_loader_default=Promise.resolve({default:globalThis.__forgotItPrismaQueryEngineWasm})',
);

if (patched === original) {
  console.error('[prepare-prisma-wasm] 未找到 Prisma WASM 动态导入补丁点');
  process.exit(1);
}

writeFileSync(handler, patched);
console.log('[prepare-prisma-wasm] staged static module and patched Prisma loader');
