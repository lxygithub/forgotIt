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

  // mode: 'insensitive' → PostgreSQL 下生成 ILIKE。
  // 迁移前是 SQLite，其 LIKE 对 ASCII 天然不区分大小写；PG 的 LIKE 区分大小写，
  // 不显式指定会让 "API"/"pdf" 这类英文关键词静默漏检。
  const where = (kw: string) => ({
    deletedAt: null,
    OR: [
      { title: { contains: kw, mode: 'insensitive' as const } },
      { content: { contains: kw, mode: 'insensitive' as const } },
      { summary: { contains: kw, mode: 'insensitive' as const } },
      { semanticKeywords: { contains: kw, mode: 'insensitive' as const } },
      {
        attachments: {
          some: {
            OR: [
              { ocrText: { contains: kw, mode: 'insensitive' as const } },
              { description: { contains: kw, mode: 'insensitive' as const } },
            ],
          },
        },
      },
      {
        tags: {
          some: { tag: { name: { contains: kw, mode: 'insensitive' as const } } },
        },
      },
    ],
  });

  // 并发发起所有候选词的查询。原先逐个 await 是 13 次串行往返 —— 数据库在本机时
  // 无感，但迁到自建 PG（经隧道）后每次往返都是几十毫秒，会累积成秒级首字节。
  const resultSets = await Promise.all(
    candidates.map((kw) =>
      db.note.findMany({
        where: where(kw),
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take,
      })
    )
  );

  // 按候选词顺序合并名次，语义与串行版完全一致：整句优先，先到者名次高
  const rank = new Map<string, number>();
  for (const found of resultSets) {
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
