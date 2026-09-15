// 「记不住」鉴权配置（方案 A：单用户 Credentials + JWT 会话）
// 对应部署文档 §4.7：
//   - AUTH_USERNAME + AUTH_PASSWORD_HASH（推荐）/ AUTH_PASSWORD（明文，仅开发）
//   - NEXTAUTH_SECRET 用于签发 JWT 会话 cookie（openssl rand -base64 32 生成）
//   - 未配置密码时拒绝一切登录（fail closed）

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { verifyPassword } from '@/lib/password';

export const AUTH_USER_ID = 'owner';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: '店主登录',
      credentials: {
        username: { label: '店主名', type: 'text' },
        password: { label: '钥匙（密码）', type: 'password' },
      },
      async authorize(credentials) {
        const username = process.env.AUTH_USERNAME?.trim();
        const stored =
          process.env.AUTH_PASSWORD_HASH?.trim() || process.env.AUTH_PASSWORD?.trim();
        if (!username || !stored) {
          console.warn(
            '[auth] 未配置 AUTH_USERNAME 或 AUTH_PASSWORD_HASH/AUTH_PASSWORD，拒绝登录（fail closed）'
          );
          return null;
        }
        const okUser = !!credentials?.username && credentials.username.trim() === username;
        const okPass = await verifyPassword(credentials?.password ?? '', stored);
        if (okUser && okPass) return { id: AUTH_USER_ID, name: username };
        return null;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 天免登录
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
