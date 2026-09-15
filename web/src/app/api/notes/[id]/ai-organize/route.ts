// AI 整理：自动打标签（1 类目 + 3-6 自由标签）+ 摘要
// POST /api/notes/:id/ai-organize
// 对应文档 v2.0 第 16.1 / 16.2 节 Prompt 规范与 14.4 混合标签体系

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeNote, noteInclude } from '@/lib/note-repo';
import { aiOrganizeNote } from '@/lib/ai';
import { logSync } from '@/lib/sync-server';
import { indexNoteAsync } from '@/lib/embedding';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const note = await db.note.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!note) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });

    const imageHints = note.attachments
      .flatMap((a) => [a.description, a.ocrText].filter((x): x is string => Boolean(x && x.trim())))
      .slice(0, 6);

    const result = await aiOrganizeNote({
      title: note.title,
      content: note.content,
      imageHints,
    });
    if (!result) {
      return NextResponse.json({ error: '这篇笔记没有可整理的内容' }, { status: 400 });
    }

    // 1. 类目标签（固定类目，kind=category）
    const categoryTag = await db.tag.upsert({
      where: { name_kind: { name: result.category, kind: 'category' } },
      update: {},
      create: { name: result.category, kind: 'category' },
    });

    // 2. 自由标签（kind=free）
    const freeTagIds: string[] = [];
    for (const name of result.tags) {
      const tag = await db.tag.upsert({
        where: { name_kind: { name, kind: 'free' } },
        update: {},
        create: { name, kind: 'free' },
      });
      freeTagIds.push(tag.id);
    }

    // 3. 替换 AI 打的标签（保留用户手动标记 source=user 的标签）
    await db.noteTag.deleteMany({ where: { noteId: id, source: 'ai' } });
    await db.noteTag.createMany({
      data: [
        { noteId: id, tagId: categoryTag.id, source: 'ai' },
        ...freeTagIds.map((tagId) => ({ noteId: id, tagId, source: 'ai' })),
      ],
    });

    // 4. 摘要 + 语义关键词（同步索引用）
    await db.note.update({
      where: { id },
      data: {
        summary: result.summary,
        semanticKeywords: result.semanticKeywords.length > 0 ? JSON.stringify(result.semanticKeywords) : null,
      },
    });
    await logSync('note', id, 'upsert');
    indexNoteAsync(id);

    const full = await db.note.findUnique({ where: { id }, include: noteInclude });
    return NextResponse.json({ note: serializeNote(full!) });
  } catch (err) {
    console.error('[POST /api/notes/:id/ai-organize]', err);
    return NextResponse.json({ error: 'AI 整理失败，请稍后再试' }, { status: 500 });
  }
}
