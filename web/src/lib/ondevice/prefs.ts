'use client';

// 端侧 AI 偏好（v1.5）——纯设备本地属性，存 localStorage，不入库不同步：
//   - enabled：用户是否启用端侧推理（三级链的第一级）
//   - modelId：模型档位（0.5B 快 / 1.5B 默认）
// 模型权重本体由 WebLLM 存到浏览器 Cache API（首次下载后离线可用）。

export type OnDeviceModelId =
  | 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
  | 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export interface OnDeviceModelOption {
  id: OnDeviceModelId;
  label: string;
  /** 大致下载体积（供 UI 展示，实际以 WebLLM 进度为准） */
  sizeHint: string;
  description: string;
}

export const ONDEVICE_MODEL_OPTIONS: OnDeviceModelOption[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B（快）',
    sizeHint: '约 500MB',
    description: '最低配，老设备友好，整理质量有限',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B（推荐）',
    sizeHint: '约 1GB',
    description: '速度与质量的平衡，默认档位',
  },
];

export const DEFAULT_ONDEVICE_MODEL: OnDeviceModelId = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

const ENABLED_KEY = 'forgotit.ondevice.enabled';
const MODEL_KEY = 'forgotit.ondevice.model';

export function getOnDevicePrefs(): { enabled: boolean; modelId: OnDeviceModelId } {
  if (typeof window === 'undefined') return { enabled: false, modelId: DEFAULT_ONDEVICE_MODEL };
  let enabled = false;
  try {
    enabled = localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    // localStorage 不可用（隐私模式等）：按未启用处理
  }
  return { enabled, modelId: getOnDeviceModelId() };
}

export function getOnDeviceModelId(): OnDeviceModelId {
  if (typeof window === 'undefined') return DEFAULT_ONDEVICE_MODEL;
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw && ONDEVICE_MODEL_OPTIONS.some((o) => o.id === raw)) return raw as OnDeviceModelId;
  } catch {
    // fallthrough
  }
  return DEFAULT_ONDEVICE_MODEL;
}

export function setOnDeviceEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    // 忽略存储失败
  }
}

export function setOnDeviceModelId(modelId: OnDeviceModelId): void {
  try {
    localStorage.setItem(MODEL_KEY, modelId);
  } catch {
    // 忽略存储失败
  }
}
