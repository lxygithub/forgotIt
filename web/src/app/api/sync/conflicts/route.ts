// 冲突快照：列表 + 处置（恢复我的版本 / 采用服务器版本）
// GET  /api/sync/conflicts
// POST /api/sync/conflicts  { id, action: 'restore-mine' | 'discard' }
// 对应文档 v2.0 第 6.5 节「落败方保留为版本快照，供用户在冲突记录中查看」

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { noteInclude, serializeNote } from '@/lib/note-repo';
import { indexNoteAsync } from '@/lib/embedding';
import { logSync } from '@/lib/sync-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.conflictSnapshot.findMany({
      where: { resolved: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const noteIds = [...new Set(rows.map((r) => r.noteId))];
    const notes = await db.note.findMany({
      where: { id: { in: noteIds } },
      include: noteInclude,
    });
    const byId = new Map(notes.map((n) => [n.id, n]));

    const conflicts = rows
      .map((r) => {
        let losing: Record<string, unknown> = {};
        try {
          losing = JSON.parse(r.losingPayload) as Record<string, unknown>;
        } catch {
          losing = {};
        }
        const winnerNote = byId.get(r.noteId);
        return {
          id: r.id,
          noteId: r.noteId,
          noteTitle: winnerNote?.title ?? (typeof losing.title === 'string' ? losing.title : '（笔记已删除）'),
          losingDevice: r.losingDevice,
          losingUpdatedAt: r.losingUpdatedAt.toISOString(),
          losingContent: typeof losing.content === 'string' ? losing.content : '',
          losingTitle: typeof losing.title === 'string' ? losing.title : '',
          winnerUpdatedAt: r.winnerUpdatedAt.toISOString(),
          winnerTitle: winnerNote?.title ?? '',
          winnerContent: winnerNote?.content ?? '',
          winner: winnerNote ? serializeNote(winnerNote) : null,
          createdAt: r.createdAt.toISOString(),
        };
      })
      .filter((c) => c.winner !== null); // 胜出方已被彻底删除的快照无法对比，暂不展示
    return NextResponse.json({ conflicts });
  } catch (err) {
    console.error('[GET /api/sync/conflicts]', err);
    return NextResponse.json({ error: '加载冲突记录失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; action?: 'restore-mine' | 'discard' };
    if (!body.id || !body.action) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }
    const snapshot = await db.conflictSnapshot.findUnique({ where: { id: body.id } });
    if (!snapshot || snapshot.resolved) {
      return NextResponse.json({ error: '冲突记录不存在或已处理' }, { status: 404 });
    }

    if (body.action === 'restore-mine') {
      // 用落败方内容覆盖当前版本（updatedAt=now → 下轮 LWW 必胜）
      let losing: Record<string, unknown> = {};
      try {
        losing = JSON.parse(snapshot.losingPayload) as Record<string, unknown>;
      } catch {
        losing = {};
      }
      const existing = await db.note.findUnique({ where: { id: snapshot.noteId } });
      if (!existing) {
        return NextResponse.json({ error: '原笔记已不存在' }, { status: 404 });
      }
      const now = new Date();
      const updated = await db.note.update({
        where: { id: snapshot.noteId },
        data: {
          title: typeof losing.title === 'string' ? losing.title : existing.title,
          content: typeof losing.content === 'string' ? losing.content : existing.content,
          summary: typeof losing.summary === 'string' ? losing.summary : existing.summary,
          pinned: typeof losing.pinned === 'boolean' ? losing.pinned : existing.pinned,
          version: existing.version + 1,
          updatedAt: now,
        },
      });
      await logSync('note', updated.id, 'upsert');
      indexNoteAsync(updated.id);
      const full = await db.note.findUnique({ where: { id: updated.id }, include: noteInclude });
      await db.conflictSnapshot.update({ where: { id: snapshot.id }, data: { resolved: true } });
      return NextResponse.json({ ok: true, note: serializeNote(full!) });
    }

    // discard：采用服务器版本（仅标记已处置）
    await db.conflictSnapshot.update({ where: { id: snapshot.id }, data: { resolved: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sync/conflicts]', err);
    return NextResponse.json({ error: '处理冲突失败' }, { status: 500 });
  }
}
