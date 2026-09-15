// 「记不住」语义向量引擎（服务端）
// 对应文档 v2.0 第 8 节：分块（512 tokens/overlap 64 思路）→ 向量化 → 余弦检索；
// EmbeddingProvider 抽象对应 5.2 节 LlmProvider 思路：
//   - 原型实现：hash-ngram-zh-v1（FNV-1a 哈希 n-gram，fastText 风格，256 维，中文友好）
//     并由 AI 整理产出 semanticKeywords（同义词/相关概念）注入索引，弥补词面语义缺口
//   - 生产实现：替换为 Gemma Embedding 768 维（flutter_gemma EmbeddingModel / pgvector），
//     只需更换 EMBEDDING_MODEL_* 常量与 embedWeighted 内核，检索层无需改动
// 向量版本化（文档 6.3）：每条向量记录 modelName + modelVersion，换模型后重索引不删旧数据

import { db } from '@/lib/db';

export const EMBEDDING_MODEL_NAME = 'hash-ngram-zh-v1';
export const EMBEDDING_MODEL_VERSION = 1;
export const EMBEDDING_DIM = 256;

// 分块参数（文档 8 节：~512 tokens / overlap 64；中文 ≈1 token/字，按字符近似）
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 60;
const MAX_CHUNKS_PER_NOTE = 4;

// ---------- 文本规整与分词 ----------

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // 去掉 Markdown 语法字符，保留中英文与数字
    .replace(/[#*_`~>\-|!\[\]()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 分词：CJK 单字(权重1) + CJK 二元组(权重2) + 拉丁/数字词(权重2) */
function tokenize(text: string): { token: string; weight: number }[] {
  const out: { token: string; weight: number }[] = [];
  const normalized = normalizeText(text);
  const cjkRuns = normalized.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    for (const ch of run) out.push({ token: ch, weight: 1 });
    for (let i = 0; i + 2 <= run.length; i++) {
      out.push({ token: run.slice(i, i + 2), weight: 2 });
    }
  }
  const latinWords = normalized.match(/[a-z0-9][a-z0-9+#.]{1,}/g) ?? [];
  for (const w of latinWords) out.push({ token: w, weight: 2 });
  return out;
}

// ---------- 向量化内核 ----------

/** FNV-1a 32 位哈希 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface EmbedPart {
  text: string;
  weight: number;
}

/** 加权哈希向量 + L2 归一化 */
export function embedWeighted(parts: EmbedPart[]): number[] {
  const vec = new Float64Array(EMBEDDING_DIM);
  for (const part of parts) {
    for (const { token, weight } of tokenize(part.text)) {
      const h = fnv1a(token);
      const idx = h % EMBEDDING_DIM;
      const sign = (h >>> 31) & 1 ? -1 : 1;
      vec[idx] += sign * weight * part.weight;
    }
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return new Array(EMBEDDING_DIM).fill(0);
  return Array.from(vec, (v) => Number((v / norm).toFixed(5)));
}

export function embedText(text: string, weight = 1): number[] {
  return embedWeighted([{ text, weight }]);
}

/** 余弦相似度（向量已归一化时等价于点积，仍按通用公式兜底） */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- 分块（文档 8 节分块策略的字符近似版） ----------

export function chunkContent(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, ' ').trim();
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) return [text];
  // 按段落/换行聚块，超长段落硬切，相邻块带 overlap
  const paras = text.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (p.length > CHUNK_SIZE) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < p.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(p.slice(i, i + CHUNK_SIZE));
        if (chunks.length >= MAX_CHUNKS_PER_NOTE) break;
      }
    } else if ((buf + '\n' + p).length > CHUNK_SIZE) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n${p}` : p;
    }
    if (chunks.length >= MAX_CHUNKS_PER_NOTE) break;
  }
  if (buf && chunks.length < MAX_CHUNKS_PER_NOTE) chunks.push(buf);
  return chunks.slice(0, MAX_CHUNKS_PER_NOTE);
}

// ---------- 索引编排 ----------

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface NoteForIndex {
  id: string;
  title: string | null;
  content: string | null;
  summary: string | null;
  semanticKeywords: string | null;
  attachments: { description: string | null; ocrText: string | null }[];
  tags?: { tag: { name: string } }[];
}

/** 单条笔记 → 加权向量部件（标题×3、摘要×2、语义关键词×4、标签×2、附件文本×2、正文块×1） */
export function noteToEmbedParts(note: NoteForIndex, chunk: string): EmbedPart[] {
  const parts: EmbedPart[] = [];
  if (note.title) parts.push({ text: note.title, weight: 3 });
  if (note.summary) parts.push({ text: note.summary, weight: 2 });
  for (const kw of parseJsonArray(note.semanticKeywords)) {
    parts.push({ text: kw, weight: 4 });
  }
  for (const nt of note.tags ?? []) parts.push({ text: nt.tag.name, weight: 2 });
  for (const att of note.attachments) {
    if (att.description) parts.push({ text: att.description, weight: 2 });
    if (att.ocrText) parts.push({ text: att.ocrText.slice(0, 300), weight: 2 });
  }
  parts.push({ text: chunk, weight: 1 });
  return parts;
}

/** 生成/刷新单条笔记的向量索引（幂等；正文或关键词变化后调用） */
export async function indexNote(noteId: string): Promise<void> {
  const note = await db.note.findUnique({
    where: { id: noteId },
    include: {
      attachments: { select: { description: true, ocrText: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  });
  if (!note) return;

  const chunks = chunkContent(note.content ?? '');
  const effectiveChunks = chunks.length > 0 ? chunks : [''];
  const vectors = effectiveChunks.map((chunk) =>
    embedWeighted(noteToEmbedParts(note, chunk))
  );

  await db.$transaction([
    db.embedding.deleteMany({
      where: { noteId, modelName: EMBEDDING_MODEL_NAME, chunkIndex: { gte: vectors.length } },
    }),
    ...vectors.map((vector, chunkIndex) =>
      db.embedding.upsert({
        where: {
          noteId_chunkIndex_modelName: { noteId, chunkIndex, modelName: EMBEDDING_MODEL_NAME },
        },
        update: { vector: JSON.stringify(vector), modelVersion: EMBEDDING_MODEL_VERSION, dim: EMBEDDING_DIM },
        create: {
          noteId,
          chunkIndex,
          modelName: EMBEDDING_MODEL_NAME,
          modelVersion: EMBEDDING_MODEL_VERSION,
          dim: EMBEDDING_DIM,
          vector: JSON.stringify(vector),
        },
      })
    ),
  ]);
}

/** 后台触发（不阻塞请求） */
export function indexNoteAsync(noteId: string): void {
  void indexNote(noteId).catch((err) => console.error('[indexNote]', noteId, err));
}

/** 全量重索引（文档：换 embedding 模型后后台增量重索引；含缺失 semanticKeywords 的笔记补跑 LLM） */
export async function reindexAllNotes(): Promise<{
  indexed: number;
  keywordsGenerated: number;
  keywordsFailed: number;
}> {
  const { aiSemanticKeywords } = await import('@/lib/ai');
  const notes = await db.note.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, content: true, summary: true, semanticKeywords: true },
  });
  let keywordsGenerated = 0;
  let keywordsFailed = 0;

  // 分批并发。原先逐条 await：每条至少要发一次 AI HTTP（外部服务）+ 一次向量写入，
  // 数据库搬到自建 PG 后每次往返都是隧道外的网络延迟，串行会把整轮重索引拖到超时。
  // AI 端点是外部服务，并发度取小值即可显著改善，同时不给对方压力。
  const CONCURRENCY = 4;
  for (let i = 0; i < notes.length; i += CONCURRENCY) {
    await Promise.all(
      notes.slice(i, i + CONCURRENCY).map(async (note) => {
        if (!parseJsonArray(note.semanticKeywords).length) {
          try {
            const kws = await aiSemanticKeywords(note.title, note.summary, note.content);
            if (kws.length > 0) {
              await db.note.update({
                where: { id: note.id },
                data: { semanticKeywords: JSON.stringify(kws) },
              });
              keywordsGenerated++;
            }
          } catch (err) {
            // AI 不可用时降级（如 Workers 部署无公网可达的 AI 端点）：
            // 跳过该条关键词，不阻塞本地 hash-ngram 向量索引（后者不依赖 AI）
            console.error('[reindexAllNotes] AI keywords failed, skip note', note.id, err);
            keywordsFailed++;
          }
        }
        await indexNote(note.id);
      })
    );
  }

  return { indexed: notes.length, keywordsGenerated, keywordsFailed };
}

/** 查询向量 vs 全库向量的余弦相似检索（生产替换为 pgvector HNSW top-k） */
export async function semanticSearchByVector(
  queryVector: number[],
  take = 10
): Promise<{ noteId: string; score: number }[]> {
  const rows = await db.embedding.findMany({
    where: { modelName: EMBEDDING_MODEL_NAME, modelVersion: EMBEDDING_MODEL_VERSION },
    select: { noteId: true, vector: true },
  });
  const best = new Map<string, number>();
  for (const row of rows) {
    try {
      const vec = JSON.parse(row.vector) as number[];
      const score = cosine(queryVector, vec);
      const prev = best.get(row.noteId);
      if (!prev || score > prev) best.set(row.noteId, score);
    } catch {
      // 跳过损坏向量
    }
  }
  return [...best.entries()]
    .map(([noteId, score]) => ({ noteId, score }))
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}
