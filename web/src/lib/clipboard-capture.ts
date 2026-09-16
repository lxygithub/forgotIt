'use client';

// 「记不住」剪贴板快记：首页任意位置 Ctrl+V 直接成笔记（无需显式入口）
//   - 文本 → 正文；图片 → 附件（AI 看图识字）；两者都有 → mixed
//   - 标题：AI 可用时由整理顺带生成；否则正文首行截断兜底
//   - AI 解析（v1.5 三级降级）：端侧 WebLLM → 服务端 AI → 静默兜底
//   - 图片文字（v1.5 端侧 OCR）：Tesseract.js 在设备内提取印刷体文字并入正文，
//     离线 + 端侧就绪时也能「贴图识字」成纯文本笔记
//
// 设计要点：
//   - 焦点在输入控件（input/textarea/contentEditable）内时不劫持 paste，
//     保证搜索框/问答框的正常粘贴体验；其余任意位置粘贴即记。
//   - 附件没有离线暂存（与编辑器同约束）：离线粘贴图片会尝试端侧 OCR 后
//     以纯文本记录（提不出文字才明确提示）。
//   - capturing 标志由调用方持有，防止重复触发。

import { aiOrganize, applyOrganize, uploadAttachment, type NoteType } from '@/lib/api';
import { createNoteLocalFirst, updateNoteLocalFirst } from '@/lib/local-first';
import { useSyncStore } from '@/lib/sync-store';
import { ocrImageText } from '@/lib/ondevice/ocr';
import { organizeOnDevice } from '@/lib/ondevice/organize';
import { getOnDevicePrefs } from '@/lib/ondevice/prefs';
import { getEngineState } from '@/lib/ondevice/engine';

const MAX_PASTE_TEXT = 50_000;
const MAX_PASTE_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 快记场景最多端侧 OCR 的张数（OCR 较慢，多张图时优先保「记下」的时效） */
const QUICK_OCR_MAX_IMAGES = 1;

export interface CapturedContent {
  text: string;
  imageFiles: File[];
}

/** 从 paste 事件的 clipboardData 提取文本与图片（都没有时返回 null） */
export function extractFromClipboard(dt: DataTransfer | null): CapturedContent | null {
  if (!dt) return null;
  let text = '';
  try {
    text = (dt.getData('text/plain') ?? '').trim().slice(0, MAX_PASTE_TEXT);
  } catch {
    // 某些浏览器在非用户手势下可能拒绝读取，按空处理
  }
  const imageFiles: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file && file.size > 0 && file.size <= MAX_IMAGE_BYTES) imageFiles.push(file);
    }
  }
  if (!text && imageFiles.length === 0) return null;
  return { text, imageFiles: imageFiles.slice(0, MAX_PASTE_IMAGES) };
}

/** paste 目标是否在可编辑控件内（是则放行原生粘贴，不劫持建笔记） */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 无 AI 时的标题兜底：正文第一个非空行截 30 字（与卡片标题同宽观感） */
export function fallbackTitle(text: string): string | undefined {
  const firstLine = text
    .split('\n')
    .map((s) => s.trim().replace(/^#+\s*/, ''))
    .find(Boolean);
  if (!firstLine) return undefined;
  return firstLine.slice(0, 30);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export type OrganizeLevel = 'device' | 'server' | 'none';

export interface QuickCaptureResult {
  id: string;
  title: string | null;
  /** 本次整理实际到达的层级：device=端侧 / server=服务端 / none=没整理成 */
  organizeLevel: OrganizeLevel;
  /** true = 端侧 OCR 至少识出了一张图的文字（toast 文案用） */
  ocrUsed: boolean;
  /** 上传失败的图片张数（离线/失败；0 = 全部成功或无图片） */
  failedImages: number;
}

export class QuickCaptureError extends Error {
  /** 部分图片上传失败时：true 表示图片全部没传上（笔记可能仍以文本创建） */
  allImagesFailed: boolean;
  constructor(message: string, allImagesFailed = false) {
    super(message);
    this.name = 'QuickCaptureError';
    this.allImagesFailed = allImagesFailed;
  }
}

/** 端侧整理是否就绪（用户启用 + 引擎 loaded） */
function deviceOrganizeReady(): boolean {
  const { enabled } = getOnDevicePrefs();
  return enabled && getEngineState().status === 'ready';
}

/** 对图片做端侧 OCR；失败返回 null（快记不被 OCR 卡死） */
async function tryOcr(file: File): Promise<string | null> {
  try {
    const text = await ocrImageText(file);
    return text || null;
  } catch {
    return null;
  }
}

/**
 * 剪贴板内容 → 笔记（在线直建；离线降级本地优先）。
 * 整理链：端侧 WebLLM → 服务端 ai-organize → 静默（标题首行兜底）。
 */
export async function quickCapture(
  captured: CapturedContent,
  aiConfigured: boolean
): Promise<QuickCaptureResult> {
  const offline = useSyncStore.getState().offlineMode;
  const canOrganize = (aiConfigured || deviceOrganizeReady()) && !offline;

  // 0. 端侧 OCR：把图片文字先「读」出来（离线也有价值；OCR 失败静默跳过）
  let ocrText = '';
  let ocrUsed = false;
  const ocrCandidates = captured.imageFiles.slice(0, QUICK_OCR_MAX_IMAGES);
  for (const file of ocrCandidates) {
    const text = await tryOcr(file);
    if (text) {
      ocrText += (ocrText ? '\n\n' : '') + text;
      ocrUsed = true;
    }
  }

  // 1. 图片 → 附件（离线不支持附件；端侧 OCR 已把文字留在了正文里）
  const attachmentIds: string[] = [];
  let failedImages = 0;
  if (captured.imageFiles.length > 0) {
    if (offline) {
      if (!captured.text && !ocrText) {
        throw new QuickCaptureError('离线状态暂不支持粘贴图片（端侧识字也未就绪），联网后再试', true);
      }
      failedImages = captured.imageFiles.length;
    } else {
      for (const file of captured.imageFiles) {
        try {
          const dataUrl = await fileToDataUrl(file);
          const res = await uploadAttachment({ dataUrl, mimeType: file.type });
          attachmentIds.push(res.attachment.id);
        } catch {
          failedImages++;
        }
      }
      if (attachmentIds.length === 0 && !captured.text && !ocrText) {
        throw new QuickCaptureError('图片上传失败，请稍后再试', true);
      }
    }
  }

  const hasText = captured.text.length > 0;
  const hasOcr = ocrText.length > 0;
  const hasImages = attachmentIds.length > 0;
  const type: NoteType = hasImages && (hasText || hasOcr) ? 'mixed' : hasImages ? 'image' : 'text';

  // 正文 = 手贴文本 + 图片识别文字（后者加个来源说明，便于日后辨认）
  const content = [
    captured.text,
    hasOcr ? `【图片识别文字】\n${ocrText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_PASTE_TEXT);

  // 2. 标题策略：AI 可用 → 留空交给整理生成；否则优先用 OCR 首行/文本首行兜底
  const title = canOrganize ? undefined : fallbackTitle(content);

  const note = await createNoteLocalFirst({
    title,
    content: content || undefined,
    type,
    localOnly: false,
    attachmentIds,
  });

  // 3. AI 解析（三级降级；端侧拿不到 R2 图片，但图片文字已并入正文，整理不受影响）
  let organizeLevel: OrganizeLevel = 'none';
  if (canOrganize) {
    const deviceReady = deviceOrganizeReady();
    if (deviceReady) {
      try {
        const result = await organizeOnDevice({ title: null, content });
        await applyOrganize(note.id, result);
        organizeLevel = 'device';
      } catch {
        organizeLevel = 'none'; // 降级到服务端
      }
    }
    if (organizeLevel === 'none') {
      try {
        await aiOrganize(note.id);
        organizeLevel = 'server';
      } catch {
        organizeLevel = 'none'; // 笔记已记上，整理失败不作为整体失败
      }
    }
  }

  // 4. 标题兑底：整理没成（或未走 AI）且笔记仍无标题时，用首行截断补上
  let finalTitle = note.title ?? null;
  if (organizeLevel === 'none' && !finalTitle && content) {
    const t = fallbackTitle(content) ?? null;
    if (t) {
      try {
        await updateNoteLocalFirst(note.id, { title: t });
        finalTitle = t;
      } catch {
        // 补标题失败保留无标题，不影响主流程
      }
    }
  }

  return {
    id: note.id,
    title: finalTitle,
    organizeLevel,
    ocrUsed,
    failedImages,
  };
}
