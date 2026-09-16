'use client';

// 「记不住」剪贴板快记：首页任意位置 Ctrl+V 直接成笔记（无需显式入口）
//   - 文本 → 正文；图片 → 附件（服务端 AI 看图识字）；两者都有 → mixed
//   - 标题：AI 可用时由 ai-organize 顺带生成；否则正文首行截断兜底
//   - AI 解析：配置了 AI 且在线时自动触发（等价「保存并让 AI 整理」）
//
// 设计要点：
//   - 焦点在输入控件（input/textarea/contentEditable）内时不劫持 paste，
//     保证搜索框/问答框的正常粘贴体验；其余任意位置粘贴即记。
//   - 附件没有离线暂存（与编辑器同约束）：离线粘贴图片会明确提示，文本照常记录。
//   - capturing 标志由调用方持有，防止重复触发。

import { aiOrganize, uploadAttachment, type NoteType } from '@/lib/api';
import { createNoteLocalFirst, updateNoteLocalFirst } from '@/lib/local-first';
import { useSyncStore } from '@/lib/sync-store';

const MAX_PASTE_TEXT = 50_000;
const MAX_PASTE_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

export interface QuickCaptureResult {
  id: string;
  title: string | null;
  /** true = 已触发 AI 解析并成功（含标题/标签/摘要） */
  organized: boolean;
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

/**
 * 剪贴板内容 → 笔记（在线直建；离线降级本地优先）。
 * aiConfigured=true 且在线时自动 aiOrganize（含无标题时的 AI 标题生成）。
 */
export async function quickCapture(
  captured: CapturedContent,
  aiConfigured: boolean
): Promise<QuickCaptureResult> {
  const offline = useSyncStore.getState().offlineMode;
  const willOrganize = aiConfigured && !offline;

  // 1. 图片 → 附件（离线不支持附件，明确降级）
  const attachmentIds: string[] = [];
  let failedImages = 0;
  if (captured.imageFiles.length > 0) {
    if (offline) {
      if (!captured.text) {
        throw new QuickCaptureError('离线状态暂不支持粘贴图片，联网后再试', true);
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
      if (attachmentIds.length === 0 && !captured.text) {
        throw new QuickCaptureError('图片上传失败，请稍后再试', true);
      }
    }
  }

  const hasText = captured.text.length > 0;
  const hasImages = attachmentIds.length > 0;
  const type: NoteType = hasImages && hasText ? 'mixed' : hasImages ? 'image' : 'text';

  // 2. 标题策略：AI 可用 → 留空交给 organize 生成；否则首行兜底
  const title = willOrganize ? undefined : hasText ? fallbackTitle(captured.text) : undefined;

  const note = await createNoteLocalFirst({
    title,
    content: hasText ? captured.text : undefined,
    type,
    localOnly: false,
    attachmentIds,
  });

  // 3. AI 解析（organize 服务端内含：类目/标签/摘要/语义关键词/标题生成 + 索引重建）
  let organized = false;
  if (willOrganize) {
    try {
      await aiOrganize(note.id);
      organized = true;
    } catch {
      organized = false; // 笔记已记上，整理失败不作为整体失败
    }
  }

  // 4. 标题兑底：AI 整理失败（或未走 AI）且笔记仍无标题时，用首行截断补上
  let finalTitle = note.title ?? null;
  if (!organized && !finalTitle && hasText) {
    const t = fallbackTitle(captured.text) ?? null;
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
    organized,
    failedImages: failedImages,
  };
}
