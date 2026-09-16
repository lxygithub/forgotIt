// 「记不住」请求拦截（Next 16 proxy 约定，等价旧 middleware）
// 单用户鉴权门禁：
//   - 已登录（JWT 会话 cookie 有效）→ 放行
//   - 未登录访问 /api/* → 401 JSON（前端统一错误处理可读）
//   - 未登录访问页面（含 /uploads/* 用户图片）→ 302 到 /login
// 放行：/login、/api/auth/*、/api/ai-assets/*（端侧 AI 公共模型资产，无用户数据）、
// 静态资源（_next、品牌 images/logo、robots.txt）

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const config = {
  matcher: [
    '/((?!login|api/auth|api/ai-assets|_next/static|_next/image|images/|logo.svg|robots.txt|favicon.ico|icon-192.png|icon-512.png|apple-touch-icon.png).*)',
  ],
};

export async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未登录或会话已过期' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export default proxy;
