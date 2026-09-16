'use client';

// 端侧「自动整理」任务（WebLLM）：标题/类目/标签/摘要/语义关键词
//
// 与服务端 aiOrganizeNote 产出同构的 OrganizeOutput——prompt 与输出收敛
// 全部复用 src/lib/ai-prompts.ts，保证三级链上任何一级算出来的结果
// 落库后行为一致（同样的 tag upsert、索引重建、标题防越权）。
//
// 小模型容错：JSON 输出失败自动带错误提示重试 1 次；两次都失败则抛错，
// 由编排层（organize-orchestrator）降级到服务端。

import {
  buildOrganizeSystemPrompt,
  buildOrganizeUserPrompt,
  extractJsonFromText,
  sanitizeOrganizeOutput,
  type OrganizeOutput,
} from '@/lib/ai-prompts';
import { generate } from './engine';

const MAX_TOKENS = 512;
const TEMPERATURE = 0.2;

/** 端侧整理：成功返回收敛后的 OrganizeOutput，模型不可用/输出不可解析时抛错 */
export async function organizeOnDevice(input: {
  title?: string | null;
  content?: string | null;
  imageHints?: string[];
}): Promise<OrganizeOutput> {
  const needTitle = !input.title?.trim();
  const user = buildOrganizeUserPrompt(input);
  if (!user.trim()) throw new Error('笔记没有可整理的内容');

  const system = buildOrganizeSystemPrompt(needTitle);

  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryHint =
      attempt === 0
        ? ''
        : `\n\n（注意：你上一次的输出无法被解析为 JSON。请只输出一个合法的 JSON 对象，不要有任何多余文字。）\n上次输出：${lastRaw.slice(0, 200)}`;
    const raw = await generate(system, user + retryHint, {
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: 120_000, // 0.5B-3B 本地推理，给足时间（设备慢也常见）
    });
    lastRaw = raw;
    const parsed = extractJsonFromText<Record<string, unknown>>(raw);
    const sanitized = parsed
      ? sanitizeOrganizeOutput(parsed, { allowTitle: needTitle })
      : null;
    if (sanitized) return sanitized;
  }
  throw new Error('端侧模型输出无法解析为整理结果');
}
