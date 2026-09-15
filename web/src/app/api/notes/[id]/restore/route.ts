// 从回收站恢复笔记
// POST /api/notes/:id/restore

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeNote, noteInclude } from '@/lib/note-repo';
import { logSync } from '@/lib/sync-server';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const existing = await db.note.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });
    if (!existing.deletedAt) {
      const full = await db.note.findUnique({ where: { id }, include: noteInclude });
      return NextResponse.json({ note: serializeNote(full!) });
    }
    await db.note.update({ where: { id }, data: { deletedAt: null } });
    await logSync('note', id, 'upsert');
    const full = await db.note.findUnique({ where: { id }, include: noteInclude });
    return NextResponse.json({ note: serializeNote(full!) });
  } catch (err) {
    console.error('[POST /api/notes/:id/restore]', err);
    return NextResponse.json({ error: '恢复笔记失败' }, { status: 500 });
  }
}
