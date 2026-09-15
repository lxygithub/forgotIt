// 同步推送：本地变更批量上云（LWW 解决冲突）
// POST /api/sync/push  { deviceId, changes: [{ entity, op, data }] }
// 对应文档 v2.0 第 6.4/6.5 节

import { NextRequest, NextResponse } from 'next/server';
import { applyPushChange, type PushChange, type PushResult } from '@/lib/sync-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deviceId?: string; changes?: PushChange[] };
    const deviceId = (body.deviceId ?? 'unknown').slice(0, 64);
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 100) : [];
    if (changes.length === 0) {
      return NextResponse.json({ results: [], serverTime: new Date().toISOString() });
    }

    const results: PushResult[] = [];
    for (const change of changes) {
      try {
        results.push(await applyPushChange(change, deviceId));
      } catch (err) {
        console.error('[sync/push] change failed', err);
        results.push({ id: change.data?.id ?? '', status: 'invalid' });
      }
    }

    return NextResponse.json({ results, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('[POST /api/sync/push]', err);
    return NextResponse.json({ error: '同步推送失败' }, { status: 500 });
  }
}
