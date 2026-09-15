// 「记不住」AI 能力层（服务端专用）— v1.3 起平台中立
// 对应开发文档 v2.0 第 16 节 Prompt 规范：
//   16.1 自动打标签 / 16.2 摘要 / 16.3 RAG 问答 / 16.4 图片理解
//
// 双部署说明（部署文档 §5 / §11）：
//   - 请求形态与 z-ai-web-dev-sdk 0.0.18 完全一致（/chat/completions 与
//     /chat/completions/vision 两个 OpenAI 兼容端点，Bearer 认证 + thinking 默认
//     disabled），仅改为内置 fetch 实现，Node 与 Cloudflare Workers 通跑。
//   - 凭证解析：环境变量 ZAI_BASE_URL / ZAI_API_KEY 优先（Workers 部署必用），
//     缺省回落 .z-ai-config 文件（cwd → ~ → /etc，查找顺序与 SDK 一致）。

import { DEFAULT_CATEGORIES } from '@/lib/note-repo';

interface ZaiConfig {
  baseUrl: string;
  apiKey: string;
  // 与 SDK 0.0.18 配置字段对齐：存在时随请求头透传（沙箱实测服务端校验 X-Token）
  token?: string;
  chatId?: string;
  userId?: string;
}

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

let cachedConfig: ZaiConfig | null | undefined;

/** 解析 Z.ai 凭证：环境变量优先，回落 .z-ai-config 文件（Node 侧） */
async function resolveZaiConfig(): Promise<ZaiConfig | null> {
  if (cachedConfig !== undefined) return cachedConfig;

  const envBase = process.env.ZAI_BASE_URL?.trim();
  const envKey = process.env.ZAI_API_KEY?.trim();
  if (envBase && envKey) {
    cachedConfig = {
      baseUrl: envBase.replace(/\/+$/, ''),
      apiKey: envKey,
      token: process.env.ZAI_TOKEN?.trim() || undefined,
    };
    return cachedConfig;
  }

  // 文件兜底：仅在 Node 侧生效（Workers 无文件系统，import 失败会被捕获）
  try {
    const [{ readFile }, os, path] = await Promise.all([
      import('fs/promises'),
      import('os'),
      import('path'),
    ]);
    const configPaths = [
      path.join(process.cwd(), '.z-ai-config'),
      path.join(os.homedir(), '.z-ai-config'),
      '/etc/.z-ai-config',
    ];
    for (const configPath of configPaths) {
      try {
        const parsed = JSON.parse(await readFile(configPath, 'utf-8')) as Partial<ZaiConfig>;
        if (parsed.baseUrl && parsed.apiKey) {
          cachedConfig = {
            baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
            apiKey: parsed.apiKey,
            token: typeof parsed.token === 'string' ? parsed.token : undefined,
            chatId: typeof parsed.chatId === 'string' ? parsed.chatId : undefined,
            userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
          };
          return cachedConfig;
        }
      } catch {
        // 尝试下一个位置
      }
    }
  } catch {
    // Workers：无 fs，忽略
  }

  cachedConfig = null;
  return cachedConfig;
}

/** 与 SDK 同形态的 OpenAI 兼容调用（thinking 默认 disabled，与 0.0.18 行为一致） */
async function zaiChat(
  body: Record<string, unknown>,
  vision = false
): Promise<ChatCompletionResponse> {
  const config = await resolveZaiConfig();
  if (!config) {
    throw new Error(
      'AI 凭证未配置：设置环境变量 ZAI_BASE_URL / ZAI_API_KEY，或按部署文档 §5 放置 .z-ai-config'
    );
  }
  const url = `${config.baseUrl}${vision ? '/chat/completions/vision' : '/chat/completions'}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (config.chatId) headers['X-Chat-Id'] = config.chatId;
  if (config.userId) headers['X-User-Id'] = config.userId;
  if (config.token) headers['X-Token'] = config.token;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      thinking: body.thinking ?? { type: 'disabled' },
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI API request failed with status ${response.status}: ${errorBody.slice(0, 300)}`);
  }
  return (await response.json()) as ChatCompletionResponse;
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
  const completion = await zaiChat({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ] satisfies ChatMessage[],
  });
  return completion.choices?.[0]?.message?.content ?? '';
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
  semanticKeywords: string[];
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
    'semanticKeywords：6-10 个语义检索关键词，包含同义词、口语说法、相关概念（例如体检报告可给：健康/医院/复查/身体指标/看病/诊断/化验），不要与正文完全重复的词。',
    '只输出一个 JSON 对象，格式：{"category":"类目名","tags":["标签1"],"summary":"摘要","semanticKeywords":["词1","词2"]}',
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
  const rawKeywords = (result.data as { semanticKeywords?: unknown }).semanticKeywords;

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

  const safeKeywords = Array.isArray(rawKeywords)
    ? [...new Set(rawKeywords.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 16)))]
        .filter((t) => t.length > 0)
        .slice(0, 10)
    : [];

  return {
    category: safeCategory,
    tags: safeTags.length > 0 ? safeTags : ['待整理'],
    summary: safeSummary || '这篇笔记还没摘要。',
    semanticKeywords: safeKeywords,
  };
}

// ---------- 语义检索辅助（文档 8 节：查询扩展 + 索引增强） ----------

/** 为存量笔记补生成语义关键词（重索引用，轻量 prompt） */
export async function aiSemanticKeywords(
  title?: string | null,
  summary?: string | null,
  content?: string | null
): Promise<string[]> {
  const parts: string[] = [];
  if (title) parts.push(`【标题】${title}`);
  if (summary) parts.push(`【摘要】${summary}`);
  if (content) parts.push(`【正文】\n${content.slice(0, 800)}`);
  if (parts.length === 0) return [];
  const system = [
    '给笔记生成 6-10 个语义检索关键词：同义词、口语说法、相关概念、上位词。',
    '只输出 JSON：{"keywords":["词1","词2"]}',
  ].join('\n');
  const result = await llmJson<{ keywords?: unknown }>(system, parts.join('\n\n'));
  if (!result || !Array.isArray(result.data.keywords)) return [];
  return [...new Set(result.data.keywords.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 16)))]
    .filter(Boolean)
    .slice(0, 10);
}

/** 语义检索查询扩展：把用户问题扩成相关词集合（文档 8 节双路检索的语义路） */
export async function aiExpandQuery(query: string): Promise<string[]> {
  const system = [
    '把用户的搜索意图扩写成 4-10 个相关检索词：同义词、口语说法、相关概念。',
    '保持原意，不要过度发挥。只输出 JSON：{"keywords":["词1","词2"]}',
  ].join('\n');
  const result = await llmJson<{ keywords?: unknown }>(system, query);
  if (!result || !Array.isArray(result.data.keywords)) return [];
  const expanded = result.data.keywords
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim().slice(0, 20))
    .filter(Boolean);
  return [query, ...expanded].slice(0, 11);
}

// ---------- 16.4 图片理解（VLM 描述 + OCR） ----------

export interface VisionResult {
  description: string;
  ocrText: string;
}

export async function aiAnalyzeImage(dataUrl: string): Promise<VisionResult> {
  const system =
    '你是「记不住」的图片理解助手。对用户给出的图片完成两件事，只输出一个 JSON 对象：' +
    '{"description":"一句话描述图片内容（60字以内）","ocrText":"逐字提取图中全部可见文字，保留原始换行；图中没有文字时输出空字符串"}。' +
    '注意：精确文字提取是你的任务，描述里不要逐字罗列文字。';
  const response = await zaiChat(
    {
      messages: [
        { role: 'assistant', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请分析这张图片。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ] satisfies ChatMessage[],
    },
    true
  );
  const raw = response.choices?.[0]?.message?.content ?? '';
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
