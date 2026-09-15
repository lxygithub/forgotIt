// 标签面板数据：固定类目 + 自由标签（含在册笔记计数）
// GET /api/tags

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDefaultCategories } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureDefaultCategories();

    const tags = await db.tag.findMany({
      include: { notes: { include: { note: { select: { deletedAt: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const withCount = tags.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind as 'category' | 'free',
      color: t.color,
      count: t.notes.filter((nt) => nt.note.deletedAt === null).length,
    }));

    const categories = withCount
      .filter((t) => t.kind === 'category')
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    const free = withCount
      .filter((t) => t.kind === 'free' && t.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));

    return NextResponse.json({ categories, free });
  } catch (err) {
    console.error('[GET /api/tags]', err);
    return NextResponse.json({ error: '标签加载失败' }, { status: 500 });
  }
}
