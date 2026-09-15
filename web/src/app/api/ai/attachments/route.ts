// 图片上传 + VLM 图像理解（描述）+ OCR（文字提取）
// POST /api/ai/attachments  { noteId?, dataUrl, mimeType }
// 对应文档 v2.0 第 4.3 节分工规则与 16.4 节图片理解 Prompt

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { aiAnalyzeImage } from '@/lib/ai';
import { recomputeNoteType } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      noteId?: string;
      dataUrl?: string;
      mimeType?: string;
    };

    const mimeType = (body.mimeType ?? '').toLowerCase();
    if (!MIME_EXT[mimeType]) {
      return NextResponse.json({ error: '仅支持 png / jpg / webp / gif 图片' }, { status: 400 });
    }
    const dataUrl = body.dataUrl ?? '';
    const match = dataUrl.match(/^data:image\/[a-z+]+;base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: '图片数据格式不正确' }, { status: 400 });
    }
    const base64 = match[1];
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) {
      return NextResponse.json({ error: '图片内容为空' }, { status: 400 });
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: '图片太大了，请控制在 8MB 以内' }, { status: 400 });
    }

    // 保存到 public/uploads（dev 环境下静态可访问 /uploads/xxx）
    const ext = MIME_EXT[mimeType];
    const fileName = `${randomUUID()}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), buffer);
    const filePath = `/uploads/${fileName}`;

    // VLM 描述 + OCR（并行不需要，单次调用同时返回两项）
    let description: string | null = null;
    let ocrText: string | null = null;
    try {
      const vision = await aiAnalyzeImage(`data:${mimeType};base64,${base64}`);
      description = vision.description;
      ocrText = vision.ocrText || null;
    } catch (e) {
      console.error('[aiAnalyzeImage] failed', e);
      // AI 失败不阻塞入库，稍后可重新整理
    }

    // 图片尺寸（sharp 可用则取，失败忽略）
    let width: number | null = null;
    let height: number | null = null;
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // ignore
    }

    const attachment = await db.attachment.create({
      data: {
        noteId: body.noteId && (await db.note.findUnique({ where: { id: body.noteId } }))
          ? body.noteId
          : null,
        filePath,
        mimeType,
        size: buffer.length,
        width,
        height,
        description,
        ocrText,
      },
    });

    if (attachment.noteId) {
      await recomputeNoteType(attachment.noteId);
    }

    return NextResponse.json({
      attachment: {
        id: attachment.id,
        filePath: attachment.filePath,
        mimeType: attachment.mimeType,
        description: attachment.description,
        ocrText: attachment.ocrText,
        createdAt: attachment.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('[POST /api/ai/attachments]', err);
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 });
  }
}
