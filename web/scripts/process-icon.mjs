// 「记不住」favicon 处理脚本 v2（AI 吉祥物原图 → 品牌化全套资产）
// 输入：tmp-icon/ai-mascot-v2.png（1024x1024）
// 处理：1) 从四边泛洪填充，把「与背景连通的橙色系像素」统一替换为品牌色 #D37000
//         （只动连通背景+投影，绝不触碰大脑内部 → 无噪点）
//       2) trim 出主体 → 居中扩展成正方形（主体占 ~80%，留足圆角安全边距）
//       3) 圆角遮罩（favicon 用）与全出血（apple-touch 用）
// 输出：public/favicon.ico(16/32/48) / icon-192.png / icon-512.png /
//       apple-touch-icon.png / assets/preview-*.png（目检）

import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'assets', 'icon-source.png');
const PUBLIC = path.join(ROOT, 'public');

const BRAND = { r: 211, g: 112, b: 0 }; // #D37000 = oklch(0.646 0.16 58)

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** 背景判定：橙色相、有饱和度、中高亮度（深色描边 l≈0.14 天然屏障） */
function isBgLike(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return h >= 15 && h <= 55 && s > 0.3 && l > 0.3;
}

/** 从四边 BFS 泛洪，只替换与边界连通的背景像素 */
function floodFillBg(data, w, h) {
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0, replaced = 0;
  const push = (x, y) => {
    const idx = y * w + x;
    if (visited[idx]) return;
    const p = idx * 4;
    if (!isBgLike(data[p], data[p + 1], data[p + 2])) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (head < tail) {
    const idx = queue[head++];
    const p = idx * 4;
    data[p] = BRAND.r; data[p + 1] = BRAND.g; data[p + 2] = BRAND.b; data[p + 3] = 255;
    replaced++;
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return replaced;
}

async function main() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = floodFillBg(data, info.width, info.height);
  console.log(`[flood] 背景替换 ${n} 像素 → #D37000`);
  const recolored = await sharp(data, { raw: info }).png().toBuffer();
  writeFileSync(path.join(ROOT, 'assets', 'icon-recolored.png'), recolored);

  // trim + 居中方形（主体占 80%）
  const trimmed = await sharp(recolored).trim({ threshold: 40 }).toBuffer({ resolveWithObject: true });
  const t = trimmed.info;
  console.log(`[trim] 主体 ${t.width}x${t.height}`);
  const side = Math.round(Math.max(t.width, t.height) / 0.8);
  const padTop = Math.round((side - t.height) / 2);
  const padLeft = Math.round((side - t.width) / 2);
  const master = await sharp(trimmed.data)
    .extend({
      top: padTop,
      bottom: side - t.height - padTop,
      left: padLeft,
      right: side - t.width - padLeft,
      background: { r: BRAND.r, g: BRAND.g, b: BRAND.b, alpha: 1 },
    })
    // 注意：不要在此处链式 .resize()——sharp 内部固定先 resize 后 extend，
    // 会先放大裁剪内容再加边距。正方形由 extend 直接保证，后续输出各自 resize。
    .png()
    .toBuffer();
  writeFileSync(path.join(ROOT, 'assets', 'icon-master.png'), master);
  console.log('[ok] assets/icon-master.png');

  // 圆角遮罩 + 全出血
  const roundedMask = (size) =>
    Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.234)}" ry="${Math.round(size * 0.234)}"/></svg>`
    );
  const rounded = (size) =>
    sharp(master).resize(size, size, { fit: 'cover' })
      .composite([{ input: roundedMask(size), blend: 'dest-in' }])
      .png()
      .toBuffer();
  const fullBleed = (size) => sharp(master).resize(size, size, { fit: 'cover' }).png().toBuffer();

  const p512 = await rounded(512);
  const p192 = await rounded(192);
  const p48 = await rounded(48);
  const p32 = await rounded(32);
  const p16 = await rounded(16);

  writeFileSync(path.join(PUBLIC, 'icon-512.png'), p512);
  writeFileSync(path.join(PUBLIC, 'icon-192.png'), p192);
  writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), await fullBleed(180));
  console.log('[ok] public/icon-512.png / icon-192.png / apple-touch-icon.png');

  // favicon.ico（PNG-in-ICO：16+32+48）
  const packIco = (bufs) => {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(bufs.length, 4);
    let offset = 6 + 16 * bufs.length;
    const entries = bufs.map(({ size, data: d }) => {
      const e = Buffer.alloc(16);
      e.writeUInt8(size >= 256 ? 0 : size, 0);
      e.writeUInt8(size >= 256 ? 0 : size, 1);
      e.writeUInt16LE(1, 4);
      e.writeUInt16LE(32, 6);
      e.writeUInt32LE(d.length, 8);
      e.writeUInt32LE(offset, 12);
      offset += d.length;
      return e;
    });
    return Buffer.concat([header, ...entries, ...bufs.map((b) => b.data)]);
  };
  writeFileSync(path.join(PUBLIC, 'favicon.ico'), packIco([
    { size: 16, data: p16 }, { size: 32, data: p32 }, { size: 48, data: p48 },
  ]));
  console.log('[ok] public/favicon.ico (16+32+48)');

  // 目检预览
  const zoom = (buf, size, px) => sharp(buf).resize(size * px, size * px, { kernel: 'nearest' }).png();
  await zoom(p16, 16, 4).toFile(path.join(ROOT, 'assets', 'preview-16.png'));
  await zoom(p32, 32, 4).toFile(path.join(ROOT, 'assets', 'preview-32.png'));
  await sharp(p192).toFile(path.join(ROOT, 'assets', 'preview-192.png'));
  console.log('[ok] assets/preview-16.png / preview-32.png / preview-192.png');

  rmSync(path.join(PUBLIC, 'favicon.svg'), { force: true });
  console.log('[rm] public/favicon.svg（如存在）');
}

main().catch((e) => { console.error(e); process.exit(1); });
