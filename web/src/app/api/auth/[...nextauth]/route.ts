// NextAuth 路由处理器（方案 A：单用户鉴权）
// 自动接管 /api/auth/*：csrf、signin/signout、callback、session

import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
