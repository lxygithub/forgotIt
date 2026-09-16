#!/usr/bin/env bun
// 端侧 AI 资产一键上传 R2（v1.5.1）
//
// 作用：把端侧 AI 三级链需要的大文件下载/收集后上传到 Cloudflare R2
// （wrangler.jsonc 的 BUCKET = forgotit-uploads），key 前缀 ai-assets/v1/，
// 与 src/lib/ondevice/assets.ts 的 self 模式地址一一对应：
//
//   ai-assets/v1/tesseract/worker.min.js          ← node_modules/tesseract.js/dist
//   ai-assets/v1/tesseract/tesseract.esm.min.js   ← 同上（主线程 ESM）
//   ai-assets/v1/tesseract-core/*                 ← node_modules/tesseract.js-core（6 变体）
//   ai-assets/v1/tessdata/{lang}.traineddata.gz   ← jsdelivr @tesseract.js-data（4.0.0_best_int）
//   ai-assets/v1/webllm/lib/index.js              ← node_modules/@mlc-ai/web-llm/lib
//   ai-assets/v1/libs/web-llm-models/v0_2_84/base/*.wasm   ← GitHub raw（model_lib）
//   ai-assets/v1/hf/mlc-ai/<repo>/*               ← HuggingFace（权重 + config + tokenizer）
//
// 用法（需 Cloudflare 凭证，二选一）：
//   1) export CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx   # 推荐（无人值守）
//   2) bunx wrangler login                                         # OAuth 交互登录
// 之后：
//   bun run upload:ai-assets              # 全量（tesseract + webllm + 三个模型，约 3.5GB）
//   bun run upload:ai-assets --tesseract  # 只传 OCR 部分（约 70MB）
//   bun run upload:ai-assets --models=1.5b,0.5b   # 只传指定模型
//   bun run upload:ai-assets --force      # 忽略已上传清单强制重传
//
// 幂等：已按相同字节数上传过的 key 会跳过（清单 .ai-assets-cache/uploaded.json，
// 已 gitignore）。模型权重 shard 均在单次 PUT 限制内（≤300MiB）。

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, '.ai-assets-cache');
const BUCKET = 'forgotit-uploads'; // 与 wrangler.jsonc r2_buckets 一致
const VERSION = 'v1'; // 与 assets.ts 的 R2_PREFIX 一致；升级资产时同步升 v2
const PREFIX = `ai-assets/${VERSION}`;

// ---- 与 assets.ts 保持一致的版本锚点 ----
const WEBLLM_VERSION = '0.2.85';
const TESSERACT_VERSION = '7.0.0';
const MLC_LIBS_BASE = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/';
const MLC_LIBS_VERSION_PATH = 'v0_2_84/base';

const MODELS = {
  '0.5b': { repo: 'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC', lib: 'Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm' },
  '1.5b': { repo: 'mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC', lib: 'Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm' },
  '3b': { repo: 'mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC', lib: 'Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm' },
};

const MIME = {
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  json: 'application/json; charset=utf-8',
  gz: 'application/octet-stream',
  bin: 'application/octet-stream',
};

// ---- CLI 参数 ----
const args = process.argv.slice(2);
const force = args.includes('--force');
const wantAll = args.filter((a) => a !== '--force').length === 0; // 无参数 = 全量
const wantTesseract = wantAll || args.includes('--tesseract');
const modelsArg = args.find((a) => a.startsWith('--models'));
const wantModels = wantAll || !!modelsArg;
const selectedModels = modelsArg
  ? modelsArg.replace('--models=', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : Object.keys(MODELS);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

function log(msg) { console.log(`[ai-assets] ${msg}`); }

function contentTypeFor(key) {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

// ---- 上传清单（幂等）----
const manifestPath = join(CACHE_DIR, 'uploaded.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

async function downloadTo(url, destPath, minSizeHint = 0) {
  mkdirSync(join(destPath, '..'), { recursive: true });
  if (existsSync(destPath) && statSync(destPath).size > Math.max(0, minSizeHint)) {
    log(`  已缓存，跳过下载: ${basename(destPath)} (${mb(statSync(destPath).size)})`);
    return destPath;
  }
  log(`  下载: ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载失败 ${resp.status}: ${url}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.byteLength <= minSizeHint) throw new Error(`下载体积异常 (${buf.byteLength}B): ${url}`);
  writeFileSync(destPath, buf);
  log(`  已缓存: ${basename(destPath)} (${mb(buf.byteLength)})`);
  return destPath;
}

function r2Put(key, filePath) {
  const size = statSync(filePath).size;
  if (size > 300 * 1024 * 1024) {
    throw new Error(`${key} 单文件 ${mb(size)} 超过 API 单次 PUT 上限（300MiB），请用 S3 SDK 分片上传`);
  }
  if (!force && manifest[key]?.size === size) {
    log(`  已上传过，跳过: ${key} (${mb(size)})`);
    return;
  }
  log(`  上传: ${key} (${mb(size)})`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = spawnSync('bunx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', filePath, '--content-type', contentTypeFor(key), '--remote'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env,
    });
    if (res.status === 0) {
      manifest[key] = { size, uploadedAt: new Date().toISOString() };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      return;
    }
    const errText = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    // 老版本 wrangler 不认 --remote 时去掉重试
    if (errText.includes('Unknown') && errText.includes('--remote')) {
      const retry = spawnSync('bunx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', filePath, '--content-type', contentTypeFor(key)], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env,
      });
      if (retry.status === 0) {
        manifest[key] = { size, uploadedAt: new Date().toISOString() };
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return;
      }
    }
    if (attempt === 3) {
      console.error(errText);
      throw new Error(`wrangler 上传失败: ${key}`);
    }
    log(`  重试 ${attempt}/2 …（检查 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / 网络后自动重试）`);
  }
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // 凭证预检：wrangler 会给出明确报错，避免传到最后一个文件才失败
  log('预检 wrangler 凭证（whoami）…');
  const who = spawnSync('bunx', ['wrangler', 'whoami'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (who.status !== 0) {
    console.error(`${who.stdout ?? ''}${who.stderr ?? ''}`);
    throw new Error('wrangler 未认证。请先 export CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account>（或 bunx wrangler login）后重试。');
  }
  log((who.stdout || '').split('\n').filter((l) => /logged in|Account|邮箱|email/i.test(l)).slice(0, 3).join(' | ') || '凭证 OK');

  // ---------- Tesseract（OCR）----------
  if (wantTesseract) {
    log('== Tesseract：worker / esm / core WASM / 语言包 ==');
    const tessDist = join(ROOT, `node_modules/tesseract.js@${TESSERACT_VERSION}/dist`);
    const dist = existsSync(tessDist) ? tessDist : join(ROOT, 'node_modules/tesseract.js/dist');
    r2Put(`${PREFIX}/tesseract/worker.min.js`, join(dist, 'worker.min.js'));
    r2Put(`${PREFIX}/tesseract/tesseract.esm.min.js`, join(dist, 'tesseract.esm.min.js'));

    const coreDir = join(ROOT, 'node_modules/tesseract.js-core');
    if (!existsSync(coreDir)) throw new Error('缺少 node_modules/tesseract.js-core，先 bun install');
    for (const file of ['tesseract-core.wasm', 'tesseract-core.wasm.js', 'tesseract-core-simd.wasm', 'tesseract-core-simd.wasm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd.wasm', 'tesseract-core-relaxedsimd.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
      r2Put(`${PREFIX}/tesseract-core/${file}`, join(coreDir, file));
    }

    // 语言包：与 tesseract.js oem=1（LSTM）默认档位一致（4.0.0_best_int）
    for (const lang of ['chi_sim', 'eng']) {
      const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
      const dest = await downloadTo(url, join(CACHE_DIR, 'tessdata', `${lang}.traineddata.gz`));
      r2Put(`${PREFIX}/tessdata/${lang}.traineddata.gz`, dest);
    }
  }

  // ---------- WebLLM（ESM + model_lib）----------
  if (wantModels) {
    log('== WebLLM：ESM 入口 + model_lib WASM ==');
    const esm = join(ROOT, 'node_modules/@mlc-ai/web-llm/lib/index.js');
    if (!existsSync(esm)) throw new Error(`缺少 @mlc-ai/web-llm@${WEBLLM_VERSION}，先 bun install`);
    r2Put(`${PREFIX}/webllm/lib/index.js`, esm);

    for (const key of selectedModels) {
      const m = MODELS[key];
      if (!m) throw new Error(`未知模型 ${key}（可选：${Object.keys(MODELS).join('/')}）`);
      const url = `${MLC_LIBS_BASE}${MLC_LIBS_VERSION_PATH}/${m.lib}`;
      const dest = await downloadTo(url, join(CACHE_DIR, 'libs', m.lib));
      r2Put(`${PREFIX}/libs/web-llm-models/${MLC_LIBS_VERSION_PATH}/${m.lib}`, dest);
    }

    // ---------- 模型权重（HuggingFace）----------
    for (const key of selectedModels) {
      const m = MODELS[key];
      log(`== 模型权重 ${m.repo} ==`);
      const treeResp = await fetch(`https://huggingface.co/api/models/${m.repo}/tree/main`);
      if (!treeResp.ok) throw new Error(`HF tree API 失败 ${treeResp.status}`);
      const tree = await treeResp.json();
      const files = tree.filter((f) => f.type === 'file' && !f.path.startsWith('.'));
      log(`  共 ${files.length} 个文件，总 ${mb(files.reduce((s, f) => s + f.size, 0))}`);
      for (const f of files) {
        const dest = join(CACHE_DIR, 'hf', m.repo, f.path);
        const local = await downloadTo(`https://huggingface.co/${m.repo}/resolve/main/${f.path}`, dest, 0);
        r2Put(`${PREFIX}/hf/${m.repo}/${f.path}`, local);
      }
    }
  }

  const total = Object.values(manifest).reduce((s, e) => s + (e.size ?? 0), 0);
  log(`完成 ✅ 累计已上传 ${Object.keys(manifest).length} 个对象 / ${mb(total)}（清单: ${manifestPath}）`);
  log('生产端侧 AI 现在可从 /api/ai-assets/* 同源加载；浏览器首次下载后离线可用。');
}

main().catch((err) => {
  console.error('[ai-assets] 失败:', err.message);
  process.exit(1);
});
