// 「记不住」混合检索（服务端）
// 对应文档 v2.0 第 8 节：双路检索（向量语义 + 关键词）→ RRF(k=60) 合并 → top-k
// 检索结果同时服务于搜索页与 RAG 问答（决策日志 D8）

import { db } from '@/lib/db';
import { noteInclude, serializeNote } from '@/lib/note-repo';
import { embedText, semanticSearchByVector } from '@/lib/embedding';
import { aiExpandQuery, extractKeywords } from '@/lib/ai';
import type { Note, NoteTag, Tag, Attachment } from '@prisma/client';

type NoteWithAll = Note & { tags: (NoteTag & { tag: Tag })[]; attachments: Attachment[] };

export interface SearchHit {
  note: ReturnType<typeof serializeNote>;
  keywordRank: number | null; // 关键词路名次（1 起，未命中为 null）
  semanticRank: number | null; // 语义路名次
  semanticScore?: number;
  rrfScore: number;
}

const RRF_K = 60; // 文档 8 节：RRF k=60

/** 关键词路：LIKE 多路匹配（生产替换为 pg_trgm 相似度排序） */
export async function keywordSearchNotes(query: string, take = 20): Promise<string[]> {
  const keywords = extractKeywords(query);
  if (!query.trim() && keywords.length === 0) return [];
  const candidates = [query, ...keywords].filter((kw) => kw.length >= 2).slice(0, 13);
  if (candidates.length === 0) return [];

  const where = (kw: string) => ({
    deletedAt: null,
    OR: [
      { title: { contains: kw } },
      { content: { contains: kw } },
      { summary: { contains: kw } },
      { semanticKeywords: { contains: kw } },
      { attachments: { some: { OR: [{ ocrText: { contains: kw } }, { description: { contains: kw } }] } } },
      { tags: { some: { tag: { name: { contains: kw } } } } },
    ],
  });

  const rank = new Map<string, number>();
  // 整句优先，其后按关键词逐个补检；先到者名次高
  for (const kw of candidates) {
    const found = await db.note.findMany({
      where: where(kw),
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    for (const n of found) {
      if (!rank.has(n.id)) rank.set(n.id, rank.size + 1);
      if (rank.size >= take) break;
    }
    if (rank.size >= take) break;
  }
  return [...rank.keys()];
}

/** 语义路：查询扩展 → 向量化 → 余弦 top-k */
export async function semanticSearchNotes(
  query: string,
  take = 20
): Promise<{ ids: string[]; expansions: string[] }> {
  let expansions: string[] = [query];
  try {
    expansions = await aiExpandQuery(query);
  } catch (err) {
    console.error('[semanticSearch] expand failed, fallback to raw query', err);
  }
  // 扩展词整体拼接成一条"伪文档"再向量化，天然带上各词的 n-gram 特征
  const vector = embedText(expansions.join(' '), 1);
  const hits = await semanticSearchByVector(vector, take);
  return { ids: hits.map((h) => h.noteId), expansions };
}

/** RRF 合并双路结果（文档 8 节） */
export function rrfFuse(keywordIds: string[], semanticIds: string[], take = 12): Map<string, number> {
  const scores = new Map<string, number>();
  keywordIds.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  semanticIds.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  return new Map(
    [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, take)
  );
}

/** 双路检索 + RRF 合并 + 组装命中详情（供搜索页与 RAG 共用） */
export async function hybridSearch(
  query: string,
  opts: { take?: number; withExpansions?: boolean } = {}
): Promise<{ hits: SearchHit[]; expansions: string[] }> {
  const take = opts.take ?? 12;
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], expansions: [] };

  const [keywordIds, semanticRes] = await Promise.all([
    keywordSearchNotes(trimmed, take).catch(() => [] as string[]),
    semanticSearchNotes(trimmed, take).catch(() => ({ ids: [] as string[], expansions: [trimmed] })),
  ]);

  const fused = rrfFuse(keywordIds, semanticRes.ids, take);
  if (fused.size === 0) return { hits: [], expansions: semanticRes.expansions };

  const notes = await db.note.findMany({
    where: { id: { in: [...fused.keys()] }, deletedAt: null },
    include: { ...noteInclude, attachments: true },
  });
  const byId = new Map(notes.map((n) => [n.id, n]));

  const hits: SearchHit[] = [];
  for (const [noteId, rrfScore] of fused) {
    const note = byId.get(noteId);
    if (!note) continue;
    const kRank = keywordIds.indexOf(noteId);
    const sRank = semanticRes.ids.indexOf(noteId);
    hits.push({
      note: serializeNote(note),
      keywordRank: kRank >= 0 ? kRank + 1 : null,
      semanticRank: sRank >= 0 ? sRank + 1 : null,
      rrfScore,
    });
  }
  // RRF 分数相同（如单路命中）时保持融合序即可
  return { hits, expansions: opts.withExpansions === false ? [] : semanticRes.expansions };
}
