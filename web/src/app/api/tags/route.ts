// 标签面板数据：固定类目 + 自由标签（含在册笔记计数）
// GET /api/tags

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDefaultCategories } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureDefaultCategories();

    // 计数交给数据库：原先用 include 把「所有标签 × 所有关联 × 每条笔记的 deletedAt」
    // 全量拉进 JS 再过滤统计。数据库在本机时无感，迁到经隧道的自建 PG 后，
    // 这份全表数据要走网络，标签一多就成瓶颈。
    const [tags, countRows] = await Promise.all([
      db.tag.findMany({ orderBy: { createdAt: 'asc' } }),
      db.noteTag.groupBy({
        by: ['tagId'],
        where: { note: { deletedAt: null } }, // 回收站中的笔记不计入
        _count: { _all: true },
      }),
    ]);

    const countByTag = new Map(countRows.map((r) => [r.tagId, r._count._all]));

    const withCount = tags.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind as 'category' | 'free',
      color: t.color,
      count: countByTag.get(t.id) ?? 0,
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
