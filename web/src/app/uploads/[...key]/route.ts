// /uploads/* 兜底读取路由（双部署支持，v1.3）
//  - Node 部署：文件在 public/uploads 中，由静态层直接命中（本路由仅在文件缺失时兜底 404）
//  - Workers 部署：public 中没有运行时上传文件，本路由是 R2 的唯一读取出口
//  两种部署下都先经过 proxy.ts 鉴权门禁（/uploads/* 不在放行清单）。
import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key?: string[] }> }
) {
  const { key } = await ctx.params;
  const publicPath = `/uploads/${(key ?? []).join('/')}`;
  try {
    const file = await getStorage().get(publicPath);
    if (!file) return new NextResponse('Not Found', { status: 404 });
    return new NextResponse(file.data as unknown as BodyInit, {
      headers: {
        'Content-Type': file.mime,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    // 存储不可用（如 Workers 上 R2 binding 缺失）
    return new NextResponse('Storage Unavailable', { status: 503 });
  }
}
