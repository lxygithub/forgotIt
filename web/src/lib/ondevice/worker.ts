/// <reference lib="webworker" />

// WebLLM 推理 Worker（端侧 AI，v1.5）
// 官方集成模式：WebWorkerMLCEngineHandler 在 worker 内自建 MLCEngine，
// 模型加载进度会经 kind:"initProgressCallback" 消息自动回传主线程；
// 推理请求由主线程 CreateWebWorkerMLCEngine 的 RPC 通道分发到这里。
// 本文件刻意保持极简——所有业务逻辑（prompt/JSON 收敛）都在主线程完成。

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
