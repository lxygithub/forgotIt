// 语义检索（向量路 + LLM 查询扩展）
// POST /api/search/semantic  { query, take? }
// 对应文档 v2.0 第 8 节 /search/semantic

import { NextRequest, NextResponse } from 'next/server';
import { semanticSearchNotes } from '@/lib/search';
import { db } from '@/lib/db';
import { noteInclude, serializeNote } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { query?: string; take?: number };
    const query = (body.query ?? '').trim();
    if (!query) return NextResponse.json({ notes: [], expansions: [] });

    const { ids, expansions } = await semanticSearchNotes(query, body.take ?? 12);
    if (ids.length === 0) return NextResponse.json({ notes: [], expansions });

    const notes = await db.note.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { ...noteInclude, attachments: true },
    });
    const byId = new Map(notes.map((n) => [n.id, n]));
    const ordered = ids.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => Boolean(n));

    return NextResponse.json({ notes: ordered.map(serializeNote), expansions });
  } catch (err) {
    console.error('[POST /api/search/semantic]', err);
    return NextResponse.json({ error: '语义检索失败' }, { status: 500 });
  }
}
