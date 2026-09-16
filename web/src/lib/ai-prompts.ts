// 「记不住」AI Prompt 规范与输出收敛（前后端共享）
// 对应开发文档 v2.0 第 16.1/16.2 节。
//
// 设计动机（端侧 AI，v1.5）：
//   - 服务端 ai.ts 与浏览器端侧引擎（WebLLM）必须产出**同构**的整理结果
//     （类目/标签/摘要/语义关键词/可选标题），因此 prompt 与输出收敛
//     逻辑统一放在这里，两端各自调用，不共享任何运行时依赖。
//   - 本文件必须保持「零副作用、零 Node/Worker API」：只含常量与纯函数，
//     前端组件、Web Worker、服务端路由都可安全 import。

/** 固定类目树（与 note-repo.ts 保持一致；为避免前端引入 DB 依赖而在此独立声明） */
export const AI_CATEGORIES = [
  '生活',
  '工作',
  '学习',
  '财务票据',
  '健康',
  '旅行',
  '灵感速记',
  '人际',
  '代码技术',
] as const;

/** 整理任务输出契约（服务端 aiOrganizeNote 与端侧 organize 共用） */
export interface OrganizeOutput {
  title?: string;
  category: string;
  tags: string[];
  summary: string;
  semanticKeywords: string[];
}

/** 构建「自动整理」system prompt（needTitle = 笔记没有标题时让 AI 顺带提炼） */
export function buildOrganizeSystemPrompt(needTitle: boolean): string {
  return [
    '你是「记不住」记事本的整理助手，负责给笔记归类、打标签、写摘要。',
    `你必须从以下固定类目中选出最贴切的一个：${AI_CATEGORIES.join(' / ')}。`,
    '自由标签 3-6 个，每个不超过 8 个字，贴合笔记主题（人物、地点、事项、物品等具体词）。',
    '摘要不超过 50 字，陈述句，不加修饰。',
    'semanticKeywords：6-10 个语义检索关键词，包含同义词、口语说法、相关概念（例如体检报告可给：健康/医院/复查/身体指标/看病/诊断/化验），不要与正文完全重复的词。',
    needTitle
      ? '这篇笔记没有标题：请在 JSON 里加 "title" 字段，根据内容提炼一个不超过 20 字的具体标题（不要以「笔记」「记录」开头，不要泛泛而谈）。'
      : '笔记已有标题，不要输出 title 字段。',
    '只输出一个 JSON 对象，格式：{"category":"类目名","tags":["标签1"],"summary":"摘要","semanticKeywords":["词1","词2"]}，仅在上面要求生成标题时才额外包含 "title":"标题" 字段。',
  ].join('\n');
}

/** 组装「自动整理」user prompt（标题/正文/图片线索三段式） */
export function buildOrganizeUserPrompt(input: {
  title?: string | null;
  content?: string | null;
  imageHints?: string[];
}): string {
  const parts: string[] = [];
  if (input.title) parts.push(`【标题】${input.title}`);
  if (input.content) parts.push(`【正文】\n${input.content.slice(0, 1200)}`);
  if (input.imageHints && input.imageHints.length > 0) {
    parts.push(`【图片信息】\n${input.imageHints.map((h) => `- ${h}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** 从模型输出中提取第一个 JSON 对象并解析（容错：忽略围栏与前后杂文） */
export function extractJsonFromText<T>(raw: string): T | null {
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
      // fallthrough：尝试整体解析
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * 收敛模型输出为合法 OrganizeOutput：
 * 类目必须命中固定列表、标签去重限长限量、摘要截断、标题仅在允许时采纳。
 * （与小模型共处尤其重要：宁可收敛也不要把脏数据写进库。）
 */
export function sanitizeOrganizeOutput(
  raw: unknown,
  opts: { allowTitle: boolean; fallbackCategory?: string }
): OrganizeOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const category = typeof data.category === 'string' ? data.category.trim() : '';
  const safeCategory = (AI_CATEGORIES as readonly string[]).includes(category)
    ? category
    : (opts.fallbackCategory ?? AI_CATEGORIES[0]);

  const safeTags = Array.isArray(data.tags)
    ? [...new Set(
        data.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 12))
      )].slice(0, 6)
    : [];

  const safeSummary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary.trim().slice(0, 60)
      : '';

  const safeKeywords = Array.isArray(data.semanticKeywords)
    ? [...new Set(
        data.semanticKeywords
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 16))
      )].slice(0, 10)
    : [];

  // 标题：仅当调用方允许且模型给了非空标题时采纳，并做去引号/截断
  const rawTitle = typeof data.title === 'string' ? data.title.trim() : '';
  const safeTitle =
    opts.allowTitle && rawTitle
      ? rawTitle.replace(/^["'「『]+|["'」』]+$/g, '').slice(0, 30)
      : undefined;

  return {
    ...(safeTitle ? { title: safeTitle } : {}),
    category: safeCategory,
    tags: safeTags.length > 0 ? safeTags : ['待整理'],
    summary: safeSummary || '这篇笔记还没摘要。',
    semanticKeywords: safeKeywords,
  };
}

/** 语义关键词生成的轻量 prompt（重索引用，前后端都可能调） */
export const SEMANTIC_KEYWORDS_SYSTEM_PROMPT = [
  '给笔记生成 6-10 个语义检索关键词：同义词、口语说法、相关概念、上位词。',
  '只输出 JSON：{"keywords":["词1","词2"]}',
].join('\n');
