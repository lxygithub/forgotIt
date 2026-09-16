'use client';

// AI 整理三级降级编排（v1.5「端侧优先」）
//
//   ① 设备内推理（WebLLM，隐私最优：内容不出浏览器）
//   ② 服务端推理（设置界面配置的 OpenAI 兼容端点：家里 Ollama / 云端 API）
//   ③ 静默失败（调用方走 fallbackTitle 等兜底）
//
// 判定规则：
//   - 端侧参与条件：用户已启用（localStorage）且引擎 ready
//   - 端侧推理成功但 apply-organize 落库失败 → 视为该级失败，继续降级
//   - 服务端不可用（未配置 AI / 网络失败）→ 返回 level:'none'，不抛错
//     （快记场景「记下」永远优先于「整理」，失败只是少了标签摘要）

import { aiOrganize, applyOrganize } from '@/lib/api';
import { getEngineState } from '@/lib/ondevice/engine';
import { getOnDevicePrefs } from '@/lib/ondevice/prefs';
import { organizeOnDevice } from '@/lib/ondevice/organize';

export type OrganizeLevel = 'device' | 'server' | 'none';
export type DeviceSkipReason = 'disabled' | 'not-ready' | 'failed' | undefined;

export interface OrganizeAttempt {
  level: OrganizeLevel;
  /** 端侧为何没出力（诊断信息，供 toast 文案决策） */
  deviceSkipReason: DeviceSkipReason;
}

/** 端侧当前是否可参与整理（编排判定 + UI 提示共用） */
export function isDeviceOrganizeAvailable(): boolean {
  const { enabled } = getOnDevicePrefs();
  const { status } = getEngineState();
  return enabled && status === 'ready';
}

/**
 * 对一篇已入库的笔记执行整理（端侧优先，逐级降级）。
 * 永不抛错：整理是增强能力，失败不影响笔记本体。
 */
export async function organizeWithInputBestEffort(
  noteId: string,
  input: { title?: string | null; content?: string | null; imageHints?: string[] }
): Promise<OrganizeAttempt> {
  const { enabled } = getOnDevicePrefs();
  const { status } = getEngineState();

  // —— ① 端侧（WebLLM）——
  if (enabled && status === 'ready') {
    try {
      const result = await organizeOnDevice(input);
      await applyOrganize(noteId, result);
      return { level: 'device', deviceSkipReason: undefined };
    } catch {
      // 端侧推理或落库任一步失败 → 降到服务端
    }
  }

  // —— ② 服务端（ai-organize 内部自己拉库取内容并组装图片线索）——
  try {
    await aiOrganize(noteId);
    return {
      level: 'server',
      deviceSkipReason: !enabled ? 'disabled' : 'not-ready',
    };
  } catch {
    // —— ③ 静默失败 ——
    return { level: 'none', deviceSkipReason: 'failed' };
  }
}
