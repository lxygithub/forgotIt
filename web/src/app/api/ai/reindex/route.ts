// 全量重建语义索引（文档：换 embedding 模型/版本后，后台增量重索引）
// POST /api/ai/reindex
// 存量笔记缺 semanticKeywords 时会自动补跑 LLM（逐条，不清空旧索引直到完成）

import { NextResponse } from 'next/server';
import { reindexAllNotes } from '@/lib/embedding';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await reindexAllNotes();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[POST /api/ai/reindex]', err);
    return NextResponse.json({ error: '重建索引失败' }, { status: 500 });
  }
}
