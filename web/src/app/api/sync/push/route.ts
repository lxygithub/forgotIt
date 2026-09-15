// 同步推送：本地变更批量上云（LWW 解决冲突）
// POST /api/sync/push  { deviceId, changes: [{ entity, op, data }] }
// 对应文档 v2.0 第 6.4/6.5 节

import { NextRequest, NextResponse } from 'next/server';
import { applyPushChange, type PushChange, type PushResult } from '@/lib/sync-server';

export const dynamic = 'force-dynamic';

/**
 * 批处理并发度。
 *
 * 不能无脑 Promise.all：同一条笔记的多条变更之间存在时序依赖（LWW 依次比较
 * updatedAt，后一条要看到前一条的结果），并发会让它们互相踩。
 * 因此按 noteId 分组，组内串行、组间并发 —— 不同笔记互不影响，可以安全并行。
 *
 * 数据库在本机时串行无感；迁移到自建 PG（经隧道）后，每条变更内部有 2~4 次
 * 往返，串行累积会明显拖慢同步，故需要这个并发。
 * 另外每条变更都要争抢 SyncCounter 的行锁，所以并发度控制在个位数即可。
 */
const MAX_CONCURRENT_NOTES = 6;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deviceId?: string; changes?: PushChange[] };
    const deviceId = (body.deviceId ?? 'unknown').slice(0, 64);
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 100) : [];
    if (changes.length === 0) {
      return NextResponse.json({ results: [], serverTime: new Date().toISOString() });
    }

    // 记录原始下标，结果按原顺序回填（客户端依赖位置对应）
    const indexOfChange = new Map<PushChange, number>();
    changes.forEach((c, i) => indexOfChange.set(c, i));

    // 按笔记分组；没有 id 的（离线新建但未带临时 id）各自独立成组
    const groups = new Map<string, PushChange[]>();
    changes.forEach((c, i) => {
      const key = c.data?.id ? `id:${c.data.id}` : `anon:${i}`;
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    });

    const results: PushResult[] = new Array(changes.length);

    const runGroup = async (group: PushChange[]) => {
      for (const change of group) {
        const i = indexOfChange.get(change)!;
        try {
          results[i] = await applyPushChange(change, deviceId);
        } catch (err) {
          console.error('[sync/push] change failed', err);
          results[i] = { id: change.data?.id ?? '', status: 'invalid' };
        }
      }
    };

    // 简单的分组批处理：每轮最多 MAX_CONCURRENT_NOTES 个笔记并行
    const allGroups = [...groups.values()];
    for (let i = 0; i < allGroups.length; i += MAX_CONCURRENT_NOTES) {
      await Promise.all(
        allGroups.slice(i, i + MAX_CONCURRENT_NOTES).map((g) => runGroup(g))
      );
    }

    return NextResponse.json({ results, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('[POST /api/sync/push]', err);
    return NextResponse.json({ error: '同步推送失败' }, { status: 500 });
  }
}
