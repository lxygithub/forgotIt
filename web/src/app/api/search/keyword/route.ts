// 关键词检索
// POST /api/search/keyword  { query, take? }
// 对应文档 v2.0 第 8 节 /search/keyword（生产：pg_trgm）

import { NextRequest, NextResponse } from 'next/server';
import { keywordSearchNotes } from '@/lib/search';
import { db } from '@/lib/db';
import { noteInclude, serializeNote } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { query?: string; take?: number };
    const query = (body.query ?? '').trim();
    if (!query) return NextResponse.json({ notes: [] });

    const ids = await keywordSearchNotes(query, body.take ?? 20);
    if (ids.length === 0) return NextResponse.json({ notes: [] });

    const notes = await db.note.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { ...noteInclude, attachments: true },
    });
    const byId = new Map(notes.map((n) => [n.id, n]));
    const ordered = ids.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => Boolean(n));

    return NextResponse.json({ notes: ordered.map(serializeNote) });
  } catch (err) {
    console.error('[POST /api/search/keyword]', err);
    return NextResponse.json({ error: '关键词检索失败' }, { status: 500 });
  }
}
