#!/usr/bin/env bun
// OpenNext 的 webpack 产物会让 Prisma 以 node:fs 从
// `static/wasm/<content-id>.wasm` 懒加载 Query Compiler。源文件虽被 trace 到
// server-functions 下，但不会以该运行时路径自动上传到 Workers，因此在部署前显式
// 放入该路径，再由 wrangler.jsonc 的 CompiledWasm rule 打包。
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outputRoot = '.open-next';
const handler = join(outputRoot, 'server-functions/default/handler.mjs');
const wasmSource = join(outputRoot, 'server-functions/default/src/generated/prisma-worker/internal/query_engine_bg.wasm');

if (!existsSync(handler) || !existsSync(wasmSource)) {
  console.error('[stage-prisma-wasm] OpenNext 或 Prisma 构建产物缺失');
  process.exit(1);
}

// webpack 把文件名拼接为 `static/wasm/" + id + ".wasm`，因此从 wasm runtime
// 的 module id（且限定 Prisma 的 JS import）提取，而不是匹配最终路径字符串。
const ids = [...new Set([...readFileSync(handler, 'utf8')
  .matchAll(/\.v\([^,]+,[^,]+,"([a-f0-9]+)",\{"\.\/query_engine_bg\.js"/g)]
  .map((match) => match[1]))];
if (ids.length !== 1) {
  console.error(`[stage-prisma-wasm] 期望一个 Prisma wasm 模块标识，实际得到 ${ids.length}`);
  process.exit(1);
}

const destinationDir = join(outputRoot, 'static/wasm');
mkdirSync(destinationDir, { recursive: true });
const destination = join(destinationDir, `${ids[0]}.wasm`);
copyFileSync(wasmSource, destination);
console.log('[stage-prisma-wasm] staged', destination);
