// AI 连通性测试（设置对话框「测试连接」按钮）
// POST /api/settings/ai/test
// body: { baseUrl, apiKey?, token?, model? }
//   - apiKey 留空时沿用已保存的 Key（对应「改端点但不动 Key」场景）；
//     若也没有已保存 Key → 400，提示先填写。
//   - 测试请求不落库，只在服务端内存中发一次最小 chat 请求（15s 超时）。

import { NextRequest, NextResponse } from 'next/server';
import { testAiConnection } from '@/lib/ai';
import { getAiProviderConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      baseUrl?: unknown;
      apiKey?: unknown;
      token?: unknown;
      model?: unknown;
    };

    const baseUrl = String(body.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return NextResponse.json({ error: '请先填写 API 端点' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ error: 'API 端点需以 http:// 或 https:// 开头' }, { status: 400 });
    }

    let apiKey = String(body.apiKey ?? '').trim();
    let token = String(body.token ?? '').trim();
    let model = String(body.model ?? '').trim();

    if (!apiKey || !token || !model) {
      // 缺省字段尝试用已保存配置补齐（仅补空缺项，表单里显式填写的值优先）
      const existing = await getAiProviderConfig();
      if (existing) {
        if (!apiKey) apiKey = existing.apiKey;
        if (!token) token = existing.token ?? '';
        if (!model) model = existing.model ?? '';
      }
    }

    if (!apiKey) {
      return NextResponse.json({ error: '请先填写 API Key（或先保存过配置）' }, { status: 400 });
    }

    const result = await testAiConnection({
      baseUrl,
      apiKey,
      token: token || undefined,
      model: model || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/settings/ai/test]', err);
    return NextResponse.json({ ok: false, latencyMs: 0, error: '测试请求执行失败' }, { status: 500 });
  }
}
