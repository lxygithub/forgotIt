// 笔记列表 + 创建
// GET  /api/notes?q=&type=text|image&pinned=1&tagId=&view=all|trash
// POST /api/notes

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeNote, noteInclude, attachToNote, computeType } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const type = sp.get('type') ?? 'all';
    const pinned = sp.get('pinned') === '1';
    const tagId = sp.get('tagId') ?? '';
    const view = sp.get('view') ?? 'all';

    const where: Record<string, unknown> = {};
    if (view === 'trash') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    if (pinned) where.pinned = true;

    if (type === 'image') {
      where.OR = [{ type: 'image' }, { type: 'mixed' }];
    } else if (type === 'text') {
      where.OR = [{ type: 'text' }, { type: 'mixed' }];
    }

    if (tagId) {
      where.tags = { some: { tagId } };
    }

    if (q) {
      const kwFilter = {
        OR: [
          { title: { contains: q } },
          { content: { contains: q } },
          { summary: { contains: q } },
          { attachments: { some: { OR: [{ ocrText: { contains: q } }, { description: { contains: q } }] } } },
          { tags: { some: { tag: { name: { contains: q } } } } },
        ],
      };
      // 与类型筛选共存时取交集
      if (where.OR) {
        where.AND = [{ OR: where.OR }, kwFilter];
        delete where.OR;
      } else {
        Object.assign(where, kwFilter);
      }
    }

    const notes = await db.note.findMany({
      where,
      include: noteInclude,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    return NextResponse.json({ notes: notes.map(serializeNote) });
  } catch (err) {
    console.error('[GET /api/notes]', err);
    return NextResponse.json({ error: '笔记列表加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      content?: string;
      type?: string;
      localOnly?: boolean;
      attachmentIds?: string[];
    };

    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const content = typeof body.content === 'string' ? body.content.slice(0, 50000) : '';
    const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.slice(0, 20) : [];
    if (!title && !content && attachmentIds.length === 0) {
      return NextResponse.json({ error: '笔记内容不能全为空' }, { status: 400 });
    }

    const note = await db.note.create({
      data: {
        title: title || null,
        content: content || null,
        localOnly: Boolean(body.localOnly),
        type: computeType(attachmentIds.length, Boolean(content)),
      },
    });

    await attachToNote(note.id, attachmentIds);

    const full = await db.note.findUnique({ where: { id: note.id }, include: noteInclude });
    return NextResponse.json({ note: serializeNote(full!) }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/notes]', err);
    return NextResponse.json({ error: '创建笔记失败' }, { status: 500 });
  }
}
