// 应用整理结果（端侧 AI 用）：自动打标签 + 摘要 + 语义关键词 + 可选标题
// POST /api/notes/:id/apply-organize   body = OrganizeOutput
//
// 与 ai-organize 的区别：**推理在用户设备上完成**（WebLLM），这里只负责
// 「收结果、再收敛、落库、重建索引」。服务端不做二次推理，因此：
//   - 输入必须再过一遍 sanitizeOrganizeOutput（客户端数据不可信）
//   - 类目/标签结构与 ai-organize 完全一致（kind=category/free，source=ai）
//   - 标题仅在本笔记当前无标题时写入（防越权覆盖，与服务端同规则）

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeNote, noteInclude } from '@/lib/note-repo';
import { sanitizeOrganizeOutput } from '@/lib/ai-prompts';
import { logSync } from '@/lib/sync-server';
import { indexNoteAsync } from '@/lib/embedding';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    // 服务端二次收敛：类目命中固定列表、标签限长限量、标题防越权
    const result = sanitizeOrganizeOutput(body, { allowTitle: true });
    if (!result) {
      return NextResponse.json({ error: '整理结果格式不正确' }, { status: 400 });
    }

    const note = await db.note.findUnique({ where: { id } });
    if (!note) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });
    if (note.deletedAt) {
      return NextResponse.json({ error: '笔记已在回收站' }, { status: 400 });
    }

    // 无标题时才允许写入端侧生成的标题（已有标题永不覆盖）
    const needTitle = !note.title?.trim();

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

    // 4. 摘要 + 语义关键词（同步索引用）；无标题笔记顺带写入端侧标题
    await db.note.update({
      where: { id },
      data: {
        summary: result.summary,
        semanticKeywords:
          result.semanticKeywords.length > 0 ? JSON.stringify(result.semanticKeywords) : null,
        ...(needTitle && result.title ? { title: result.title } : {}),
      },
    });
    await logSync('note', id, 'upsert');
    indexNoteAsync(id);

    const full = await db.note.findUnique({ where: { id }, include: noteInclude });
    return NextResponse.json({ note: serializeNote(full!), appliedTitle: needTitle && !!result.title });
  } catch (err) {
    console.error('[POST /api/notes/:id/apply-organize]', err);
    return NextResponse.json({ error: '整理结果写入失败，请稍后再试' }, { status: 500 });
  }
}
