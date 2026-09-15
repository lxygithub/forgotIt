// RAG 问答：检索（关键词多路匹配）+ 生成（带来源引用）
// POST /api/ai/ask  { question }
// 对应文档 v2.0 第 8 节（混合检索 + 引用）与 16.3 节 Prompt
// 原型环境：以 SQL 关键词多路匹配模拟向量检索，接口形态与 RAG 编排一致

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { noteInclude } from '@/lib/note-repo';
import { aiRagAnswer, parseCitationIndexes, extractKeywords, type RagChunk } from '@/lib/ai';
import type { Note, NoteTag, Tag, Attachment } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type NoteWithAll = Note & { tags: (NoteTag & { tag: Tag })[]; attachments: Attachment[] };

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

    // ---- 检索：关键词多路匹配（标题/正文/摘要/图片描述/OCR/标签名）----
    const keywords = extractKeywords(question);
    const matched = new Map<string, NoteWithAll>();

    const searchWhere = (kw: string) => ({
      deletedAt: null,
      OR: [
        { title: { contains: kw } },
        { content: { contains: kw } },
        { summary: { contains: kw } },
        { attachments: { some: { OR: [{ ocrText: { contains: kw } }, { description: { contains: kw } }] } } },
        { tags: { some: { tag: { name: { contains: kw } } } } },
      ],
    });

    if (keywords.length > 0) {
      const found = await db.note.findMany({
        where: searchWhere(question),
        include: { ...noteInclude, attachments: true },
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        take: MAX_CHUNKS,
      });
      for (const n of found) matched.set(n.id, n);
      // 长句滑窗补检
      for (const kw of keywords) {
        if (matched.size >= MAX_CHUNKS) break;
        const more = await db.note.findMany({
          where: searchWhere(kw),
          include: { ...noteInclude, attachments: true },
          orderBy: { updatedAt: 'desc' },
          take: MAX_CHUNKS,
        });
        for (const n of more) {
          if (matched.size >= MAX_CHUNKS) break;
          matched.set(n.id, n);
        }
      }
    }

    // 兜底：命中不足时补充最近的笔记作为候选（对应文档 8 节双路检索思路的简化实现）
    if (matched.size < 5) {
      const recent = await db.note.findMany({
        where: { deletedAt: null },
        include: { ...noteInclude, attachments: true },
        orderBy: { updatedAt: 'desc' },
        take: MAX_CHUNKS,
      });
      for (const n of recent) {
        if (matched.size >= MAX_CHUNKS) break;
        matched.set(n.id, n);
      }
    }

    const candidates = [...matched.values()].slice(0, MAX_CHUNKS);
    const chunks: RagChunk[] = candidates.map((n, i) => ({
      index: i + 1,
      noteId: n.id,
      title: n.title || '无标题笔记',
      snippet: buildSnippet(n),
    }));

    // ---- 生成：带来源编号的 RAG 回答 ----
    console.error(`[ask] chunks=${chunks.length}`);
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
