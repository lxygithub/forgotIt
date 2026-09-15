// 统计数据（header 下的小字统计）
// GET /api/stats

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [notes, images, trash] = await Promise.all([
      db.note.count({ where: { deletedAt: null } }),
      db.note.count({ where: { deletedAt: null, type: { in: ['image', 'mixed'] } } }),
      db.note.count({ where: { deletedAt: { not: null } } }),
    ]);
    const freeTags = await db.tag.count({
      where: { kind: 'free', notes: { some: { note: { deletedAt: null } } } },
    });
    return NextResponse.json({ notes, images, tags: freeTags, trash });
  } catch (err) {
    console.error('[GET /api/stats]', err);
    return NextResponse.json({ error: '统计加载失败' }, { status: 500 });
  }
}
