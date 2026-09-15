// 同步拉取：按 seq 游标增量获取服务端变更
// GET /api/sync/pull?since=123
// 对应文档 v2.0 第 6.4/6.5 节（sync_log 流水 + 最新实体快照；local_only 不下发）

import { NextRequest, NextResponse } from 'next/server';
import { pullChanges } from '@/lib/sync-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const since = Number(req.nextUrl.searchParams.get('since') ?? '0');
    const cursorStart = Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
    const { cursor, changes } = await pullChanges(cursorStart);
    return NextResponse.json({ cursor, changes, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('[GET /api/sync/pull]', err);
    return NextResponse.json({ error: '同步拉取失败' }, { status: 500 });
  }
}
