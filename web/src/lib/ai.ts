// 「记不住」AI 能力层（服务端专用，z-ai-web-dev-sdk）
// 对应开发文档 v2.0 第 16 节 Prompt 规范：
//   16.1 自动打标签 / 16.2 摘要 / 16.3 RAG 问答 / 16.4 图片理解
// 原型环境说明：以 z-ai LLM/VLM 模拟「端侧推理」，接口形态与
// 文档 LlmProvider 抽象（5.2 节）保持一致，便于后续替换真实端侧实现。

import ZAI from 'z-ai-web-dev-sdk';
import { DEFAULT_CATEGORIES } from '@/lib/note-repo';

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>;

let zaiInstance: ZaiClient | null = null;

export async function getZai(): Promise<ZaiClient> {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

/** 从模型输出中提取第一个 JSON 对象并解析（容错：忽略围栏与前后杂文） */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  // 去掉 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      return JSON.parse(brace[0]) as T;
    } catch {
      // fallthrough
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 标准 LLM 调用（系统提示用 assistant 角色，符合 SDK 约定） */
export async function llmChat(system: string, user: string): Promise<string> {
  const zai = await getZai();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  });
  return completion.choices[0]?.message?.content ?? '';
}

/** JSON 版 LLM 调用：失败自动附带格式错误重试 1 次（文档 16.1 容错策略） */
export async function llmJson<T>(system: string, user: string): Promise<{ data: T; raw: string } | null> {
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryHint =
      attempt === 0
        ? ''
        : `\n\n（注意：你上一次的输出无法被解析为 JSON。请只输出一个合法的 JSON 对象，不要有任何多余文字。）\n上次输出：${lastRaw.slice(0, 300)}`;
    const raw = await llmChat(system, user + retryHint);
    lastRaw = raw;
    const data = extractJson<T>(raw);
    if (data) return { data, raw };
  }
  return null;
}

// ---------- 16.1 自动打标签 + 16.2 摘要 ----------

export interface OrganizeResult {
  category: string;
  tags: string[];
  summary: string;
}

export async function aiOrganizeNote(input: {
  title?: string | null;
  content?: string | null;
  imageHints?: string[];
}): Promise<OrganizeResult | null> {
  const system = [
    '你是「记不住」记事本的整理助手，负责给笔记归类、打标签、写摘要。',
    `你必须从以下固定类目中选出最贴切的一个：${DEFAULT_CATEGORIES.join(' / ')}。`,
    '自由标签 3-6 个，每个不超过 8 个字，贴合笔记主题（人物、地点、事项、物品等具体词）。',
    '摘要不超过 50 字，陈述句，不加修饰。',
    '只输出一个 JSON 对象，格式：{"category":"类目名","tags":["标签1","标签2"],"summary":"一句话摘要"}',
  ].join('\n');

  const parts: string[] = [];
  if (input.title) parts.push(`【标题】${input.title}`);
  if (input.content) parts.push(`【正文】\n${input.content.slice(0, 1200)}`);
  if (input.imageHints && input.imageHints.length > 0) {
    parts.push(`【图片信息】\n${input.imageHints.map((h) => `- ${h}`).join('\n')}`);
  }
  if (parts.length === 0) return null;

  const result = await llmJson<OrganizeResult>(system, parts.join('\n\n'));
  if (!result) return null;
  const { category, tags, summary } = result.data;

  // 校验与收敛：类目必须命中固定列表，标签数量与长度受限
  const safeCategory = DEFAULT_CATEGORIES.includes(category as (typeof DEFAULT_CATEGORIES)[number])
    ? category
    : DEFAULT_CATEGORIES[0];
  const safeTags = Array.isArray(tags)
    ? [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 12)))]
        .filter((t) => t.length > 0)
        .slice(0, 6)
    : [];
  const safeSummary = typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 60) : '';

  return {
    category: safeCategory,
    tags: safeTags.length > 0 ? safeTags : ['待整理'],
    summary: safeSummary || '这篇笔记还没摘要。',
  };
}

// ---------- 16.4 图片理解（VLM 描述 + OCR） ----------

export interface VisionResult {
  description: string;
  ocrText: string;
}

export async function aiAnalyzeImage(dataUrl: string): Promise<VisionResult> {
  const zai = await getZai();
  const system =
    '你是「记不住」的图片理解助手。对用户给出的图片完成两件事，只输出一个 JSON 对象：' +
    '{"description":"一句话描述图片内容（60字以内）","ocrText":"逐字提取图中全部可见文字，保留原始换行；图中没有文字时输出空字符串"}。' +
    '注意：精确文字提取是你的任务，描述里不要逐字罗列文字。';
  const response = await zai.chat.completions.createVision({
    messages: [
      { role: 'assistant', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请分析这张图片。' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = extractJson<VisionResult>(raw);
  if (parsed && typeof parsed.description === 'string') {
    return {
      description: parsed.description.slice(0, 120) || '一张图片',
      ocrText: typeof parsed.ocrText === 'string' ? parsed.ocrText.slice(0, 2000) : '',
    };
  }
  // 兜底：解析失败就把原文当描述
  return { description: raw.slice(0, 120) || '一张图片', ocrText: '' };
}

// ---------- 16.3 RAG 问答 ----------

export interface RagChunk {
  index: number;
  noteId: string;
  title: string;
  snippet: string;
}

export async function aiRagAnswer(question: string, chunks: RagChunk[]): Promise<string> {
  const system = [
    '你是「记不住」的检索助手。仅依据下方资料回答用户问题。',
    '规则：',
    '1. 每个论断后标注来源编号，如 [1]。',
    '2. 资料不足时，回答「没找到相关记录」，不得编造。',
    '3. 用中文回答，简洁分点。',
    '4. 直接回答问题本身，禁止原样复述或摘抄资料全文。',
  ].join('\n');

  const material =
    chunks.map((c) => `[${c.index}] （${c.title}）${c.snippet}`).join('\n\n') || '（无资料）';
  const user = `[资料]\n${material}\n\n[问题]\n${question}`;
  return llmChat(system, user);
}

/** 从回答文本中解析被引用的来源编号（去重、升序） */
export function parseCitationIndexes(answer: string): number[] {
  const found = new Set<number>();
  const re = /\[(\d{1,2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    found.add(parseInt(m[1], 10));
  }
  return [...found].sort((a, b) => a - b);
}

/** 问答检索：把自然语言问题拆成关键词（本地快速版，不额外调 LLM） */
export function extractKeywords(question: string): string[] {
  const cleaned = question
    .replace(/[，。？！、：；""''（）\[\]{}…\s]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ').filter((w) => w.length >= 2);
  // 中文长句切成 2 字滑窗词组，辅助 LIKE 匹配
  const extra: string[] = [];
  for (const w of words) {
    if (/[\u4e00-\u9fa5]/.test(w) && w.length > 2) {
      for (let i = 0; i + 2 <= w.length; i++) {
        extra.push(w.slice(i, i + 2));
      }
    }
  }
  return [...new Set([...words, ...extra])].slice(0, 12);
}
