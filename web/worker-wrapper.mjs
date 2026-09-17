// Prisma 的引擎必须作为 Cloudflare 的 CompiledWasm 模块静态导入；Workers 禁止
// 从字节流动态编译 WebAssembly。OpenNext 的 Node/webpack 产物会把 Prisma 的动态
// import 降级，因此由构建后脚本改为从这个全局模块读取。
import prismaQueryEngine from './.open-next/static/wasm/prisma-query-engine.wasm';
import worker from './.open-next/worker.js';

globalThis.__forgotItPrismaQueryEngineWasm = prismaQueryEngine;

export default worker;
