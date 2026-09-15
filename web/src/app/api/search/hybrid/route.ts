// 混合检索：双路（关键词 + 语义向量）→ RRF(k=60) 合并
// POST /api/search/hybrid  { query, take? }
// 对应文档 v2.0 第 8 节「混合检索与排序」

import { NextRequest, NextResponse } from 'next/server';
import { hybridSearch } from '@/lib/search';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { query?: string; take?: number };
    const query = (body.query ?? '').trim();
    if (!query) return NextResponse.json({ hits: [], expansions: [] });

    const { hits, expansions } = await hybridSearch(query, { take: body.take ?? 12 });
    return NextResponse.json({
      hits: hits.map((h) => ({
        note: h.note,
        keywordRank: h.keywordRank,
        semanticRank: h.semanticRank,
        rrfScore: h.rrfScore,
      })),
      expansions,
    });
  } catch (err) {
    console.error('[POST /api/search/hybrid]', err);
    return NextResponse.json({ error: '混合检索失败' }, { status: 500 });
  }
}
