// 载入示例数据（幂等：已有笔记时不再重复注入）
// POST /api/seed

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDefaultCategories, computeType } from '@/lib/note-repo';

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60 * 1000;

async function upsertTag(name: string, kind: 'category' | 'free') {
  return db.tag.upsert({
    where: { name_kind: { name, kind } },
    update: {},
    create: { name, kind },
  });
}

async function createDemoNote(input: {
  title: string;
  content: string;
  category: string;
  free: string[];
  summary: string;
  localOnly?: boolean;
  pinned?: boolean;
  daysAgo: number;
  attachment?: {
    filePath: string;
    mimeType: string;
    description: string;
    ocrText: string;
    width?: number;
    height?: number;
  };
}) {
  const createdAt = new Date(Date.now() - input.daysAgo * DAY);
  const note = await db.note.create({
    data: {
      title: input.title,
      content: input.content,
      summary: input.summary,
      localOnly: Boolean(input.localOnly),
      pinned: Boolean(input.pinned),
      type: computeType(input.attachment ? 1 : 0, true),
      createdAt,
      updatedAt: createdAt,
    },
  });

  const tagIds: { id: string; source: 'ai' }[] = [];
  const categoryTag = await upsertTag(input.category, 'category');
  tagIds.push({ id: categoryTag.id, source: 'ai' as const });
  for (const name of input.free) {
    const t = await upsertTag(name, 'free');
    tagIds.push({ id: t.id, source: 'ai' as const });
  }
  await db.noteTag.createMany({
    data: tagIds.map((t) => ({ noteId: note.id, tagId: t.id, source: t.source })),
  });

  if (input.attachment) {
    await db.attachment.create({
      data: {
        noteId: note.id,
        filePath: input.attachment.filePath,
        mimeType: input.attachment.mimeType,
        size: 0,
        width: input.attachment.width ?? 864,
        height: input.attachment.height ?? 1152,
        description: input.attachment.description,
        ocrText: input.attachment.ocrText,
        createdAt,
      },
    });
  }
  return note;
}

export async function POST() {
  try {
    await ensureDefaultCategories();

    const existing = await db.note.count();
    if (existing > 0) {
      return NextResponse.json({ ok: true, seeded: false });
    }

    await createDemoNote({
      title: '周三例会要点',
      daysAgo: 1,
      pinned: true,
      category: '工作',
      free: ['例会', '项目A'],
      summary: '项目A 周三例会：排期、接口联调与上线风险三点。',
      content: [
        '## 周三例会要点',
        '',
        '- **项目A 排期**：确认 9 月底上线，剩余两个迭代',
        '- 接口联调：前端已就绪，等后端网关联调（负责人：老周）',
        '- 风险：测试环境数据库要提前扩容',
        '- 下次例会前各自更新任务看板',
      ].join('\n'),
    });

    await createDemoNote({
      title: '姥姥的红烧肉做法',
      daysAgo: 3,
      category: '生活',
      free: ['菜谱', '红烧肉'],
      summary: '姥姥红烧肉诀窍：煸炒出油、热水炖、最后收汁。',
      content: [
        '## 姥姥的红烧肉',
        '',
        '1. 五花肉切块，**冷水下锅**焯去血沫',
        '2. 小火煸炒出油，加冰糖炒糖色',
        '3. 加热水没过肉，放葱姜、八角、两勺生抽一勺老抽',
        '4. 小火炖 40 分钟，大火收汁',
        '',
        '> 关键：糖色宁浅勿深，收汁前尝咸淡。',
      ].join('\n'),
    });

    await createDemoNote({
      title: '新家 WiFi 密码提醒',
      daysAgo: 5,
      localOnly: true,
      category: '生活',
      free: ['密码提示'],
      summary: '仅本地保存的密码提示，不上传不同步。',
      content: [
        '**仅本地**：这条笔记开了隐私开关，不会同步，也不会走任何云端请求。',
        '',
        '新家 WiFi：门牌号后四位 + 感叹号',
        '路由器管理页：192.168.1.1（管理员密码在路由器底部贴纸）',
      ].join('\n'),
    });

    await createDemoNote({
      title: '午餐发票',
      daysAgo: 3,
      category: '财务票据',
      free: ['发票', '报销'],
      summary: '与客户午餐小票，总金额待报销。',
      content: '和客户中午吃饭的凭证，记得月底随报销单一并提交。',
      attachment: {
        filePath: '/uploads/sample-receipt.jpg',
        mimeType: 'image/jpeg',
        description: '一张木质桌面上的票据，列有商品价格与总金额。',
        ocrText: '本价格 价格\n清水果 6.0 3.30\n稍茶 5.2 3.00\n总金额: 8.35',
      },
    });

    await createDemoNote({
      title: '京都五日行程备忘',
      daysAgo: 8,
      category: '旅行',
      free: ['京都', '行程'],
      summary: '京都五日：伏见稻荷、岚山、清水寺与抹茶街。',
      content: [
        '## 京都五日行程',
        '',
        '| 天 | 安排 |',
        '|---|---|',
        '| D1 | 抵达 · 鸭川散步 |',
        '| D2 | 伏见稻荷大社（早去避人流）· 千本鸟居 |',
        '| D3 | 岚山竹林 · 渡月桥 · 天龙寺 |',
        '| D4 | 清水寺 · 二年坂三年坂 · 宇治抹茶 |',
        '| D5 | 锦市场买手信 · 返程 |',
        '',
        '住宿：四条河原町附近，交通买一日券划算。',
      ].join('\n'),
    });

    return NextResponse.json({ ok: true, seeded: true });
  } catch (err) {
    console.error('[POST /api/seed]', err);
    return NextResponse.json({ error: '示例数据载入失败' }, { status: 500 });
  }
}
