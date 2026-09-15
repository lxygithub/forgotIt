// RAG 问答：检索（关键词 + 语义向量双路 → RRF 合并，文档第 8 节/D8）+ 生成（带来源引用）
// POST /api/ai/ask  { question }
// 对应文档 v2.0 第 8 节（混合检索 + 引用）与 16.3 节 Prompt

import { NextRequest, NextResponse } from 'next/server';
import { noteInclude, serializeNote } from '@/lib/note-repo';
import { aiRagAnswer, parseCitationIndexes, type RagChunk } from '@/lib/ai';
import { hybridSearch } from '@/lib/search';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MAX_CHUNKS = 12;
const SNIPPET_LEN = 400;

function buildSnippet(note: {
  title: string | null;
  summary: string | null;
  content: string | null;
  attachments: { description: string | null; ocrText: string | null }[];
}): string {
  const parts: string[] = [];
  if (note.summary) parts.push(note.summary);
  if (note.content) parts.push(note.content.slice(0, SNIPPET_LEN));
  for (const att of note.attachments.slice(0, 3)) {
    if (att.description) parts.push(`图片：${att.description}`);
    if (att.ocrText) parts.push(`图中文字：${att.ocrText.slice(0, 200)}`);
  }
  return parts.join('\n').slice(0, SNIPPET_LEN + 100) || '（无文本内容）';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { question?: string };
    const question = (body.question ?? '').trim();
    if (!question) {
      return NextResponse.json({ error: '问题不能为空' }, { status: 400 });
    }

    // ---- 检索：双路混合（关键词 + 语义向量）→ RRF(k=60) 合并（文档第 8 节） ----
    const { hits } = await hybridSearch(question, { take: MAX_CHUNKS, withExpansions: false });

    // 命中不足时兜底补充最近笔记，保证问答可用性
    type NoteDtoT = ReturnType<typeof serializeNote>;
    let candidates: NoteDtoT[] = hits.map((h) => h.note);
    if (candidates.length < 5) {
      const recent = await db.note.findMany({
        where: { deletedAt: null },
        include: { ...noteInclude, attachments: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_CHUNKS,
      });
      const seen = new Set(candidates.map((n) => n.id));
      for (const n of recent) {
        if (candidates.length >= MAX_CHUNKS) break;
        if (!seen.has(n.id)) candidates.push(serializeNote(n));
      }
    }

    const chunks: RagChunk[] = candidates.slice(0, MAX_CHUNKS).map((n, i) => ({
      index: i + 1,
      noteId: n.id,
      title: n.title || '无标题笔记',
      snippet: buildSnippet({
        title: n.title ?? null,
        summary: n.summary ?? null,
        content: n.content ?? null,
        attachments: n.attachments.map((a) => ({ description: a.description ?? null, ocrText: a.ocrText ?? null })),
      }),
    }));

    // ---- 生成：带来源编号的 RAG 回答 ----
    const answer = await aiRagAnswer(question, chunks);

    // ---- 引用：解析 [n] 并映射回笔记；未引用时给 top3 兜底 ----
    const referenced = parseCitationIndexes(answer);
    let citations = referenced
      .map((i) => chunks[i - 1])
      .filter((c): c is RagChunk => Boolean(c))
      .map((c) => ({ noteId: c.noteId, title: c.title, snippet: c.snippet.slice(0, 120) }));
    if (citations.length === 0) {
      citations = chunks.slice(0, 3).map((c) => ({
        noteId: c.noteId,
        title: c.title,
        snippet: c.snippet.slice(0, 120),
      }));
    }

    return NextResponse.json({ answer, citations });
  } catch (err) {
    console.error('[POST /api/ai/ask]', err);
    return NextResponse.json({ error: '问答失败，请稍后再试' }, { status: 500 });
  }
}
