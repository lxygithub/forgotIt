// 笔记详情 / 更新 / 删除（软删或彻底删）
// GET    /api/notes/:id
// PUT    /api/notes/:id
// DELETE /api/notes/:id           → 软删除（进回收站）
// DELETE /api/notes/:id?permanent=1 → 彻底删除

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeNote, noteInclude, attachToNote } from '@/lib/note-repo';
import { logSync } from '@/lib/sync-server';
import { indexNoteAsync } from '@/lib/embedding';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const note = await db.note.findUnique({ where: { id }, include: noteInclude });
    if (!note) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });
    return NextResponse.json({ note: serializeNote(note) });
  } catch (err) {
    console.error('[GET /api/notes/:id]', err);
    return NextResponse.json({ error: '加载笔记失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      title?: string;
      content?: string;
      pinned?: boolean;
      localOnly?: boolean;
      type?: string;
      attachmentIds?: string[];
    };

    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 200) || null;
    if (typeof body.content === 'string') data.content = body.content.slice(0, 50000) || null;
    if (typeof body.pinned === 'boolean') data.pinned = body.pinned;
    if (typeof body.localOnly === 'boolean') data.localOnly = body.localOnly;
    if (body.type && ['text', 'image', 'mixed'].includes(body.type)) data.type = body.type;

    await db.note.update({ where: { id }, data });
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length > 0) {
      await attachToNote(id, body.attachmentIds);
    }
    await logSync('note', id, 'upsert');
    indexNoteAsync(id);

    const full = await db.note.findUnique({ where: { id }, include: noteInclude });
    return NextResponse.json({ note: serializeNote(full!) });
  } catch (err) {
    console.error('[PUT /api/notes/:id]', err);
    return NextResponse.json({ error: '更新笔记失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const permanent = req.nextUrl.searchParams.get('permanent') === '1';

    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });

    if (permanent) {
      // 记录墓碑（文档 6.5：软删除 + 墓碑，确保多端一致）+ 同步流水
      await db.tombstone
        .create({ data: { entityType: 'note', entityId: id } })
        .catch(() => undefined);
      await logSync('note', id, 'delete');
      // 附件与标签关联由 onDelete: Cascade 一并清理
      await db.note.delete({ where: { id } });
    } else {
      await db.note.update({ where: { id }, data: { deletedAt: new Date(), pinned: false } });
      await logSync('note', id, 'delete');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/notes/:id]', err);
    return NextResponse.json({ error: '删除笔记失败' }, { status: 500 });
  }
}
