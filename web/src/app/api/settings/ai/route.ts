// AI 模型配置（v1.4 前端「设置」入口的服务端）
// GET    /api/settings/ai → 当前生效配置概览（apiKey 只回掩码，完整 key 永不出服务端）
// PUT    /api/settings/ai → 保存界面配置（写 Setting 表；apiKey 留空 = 沿用已保存的 Key）
// DELETE /api/settings/ai → 清除界面配置（下次 AI 调用回落到环境变量 / 配置文件）
//
// 鉴权：由 src/proxy.ts 统一把守（未登录 /api/* → 401），路由内无需重复校验。
// 保存成功后立即失效进程内配置缓存（多实例部署最多 30s 收敛，见 src/lib/ai.ts）。

import { NextRequest, NextResponse } from 'next/server';
import { getAiConfigInfo, invalidateAiConfigCache } from '@/lib/ai';
import { clearAiProviderConfig, getAiProviderConfig, saveAiProviderConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getAiConfigInfo());
  } catch (err) {
    console.error('[GET /api/settings/ai]', err);
    return NextResponse.json({ error: '读取 AI 配置失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      baseUrl?: unknown;
      apiKey?: unknown;
      token?: unknown;
      model?: unknown;
    };

    const baseUrl = String(body.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return NextResponse.json({ error: 'API 端点不能为空' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ error: 'API 端点需以 http:// 或 https:// 开头' }, { status: 400 });
    }

    // apiKey 留空 = 保留已保存的 Key（改端点/模型时不必重贴 Key）
    let apiKey = String(body.apiKey ?? '').trim();
    if (!apiKey) {
      const existing = await getAiProviderConfig();
      if (!existing?.apiKey) {
        return NextResponse.json({ error: 'API Key 不能为空（首次配置必须填写）' }, { status: 400 });
      }
      apiKey = existing.apiKey;
    }

    const token = String(body.token ?? '').trim();
    const model = String(body.model ?? '').trim();

    await saveAiProviderConfig({
      baseUrl,
      apiKey,
      token: token || undefined,
      model: model || undefined,
    });
    invalidateAiConfigCache();

    // 返回保存后的概览（含掩码），前端据此刷新状态卡
    return NextResponse.json(await getAiConfigInfo());
  } catch (err) {
    console.error('[PUT /api/settings/ai]', err);
    return NextResponse.json(
      { error: err instanceof Error ? `保存 AI 配置失败：${err.message}` : '保存 AI 配置失败' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearAiProviderConfig();
    invalidateAiConfigCache();
    return NextResponse.json(await getAiConfigInfo());
  } catch (err) {
    console.error('[DELETE /api/settings/ai]', err);
    return NextResponse.json({ error: '清除 AI 配置失败' }, { status: 500 });
  }
}
