'use client';

// 「记不住」登录页（方案 A：单用户密码鉴权）
// 品牌基调延续「脑子寄存处」：本店仅服务店主一人，请出示钥匙。

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Brain, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BRAND } from '@/lib/brand';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await signIn('credentials', { redirect: false, username, password });
      if (res?.error) {
        setError(BRAND.loginError);
        setLoading(false);
        return;
      }
      router.replace('/');
      // replace 后组件可能仍短暂挂载，loading 保持即可
    } catch {
      setError('网络开小差了，稍后再试。');
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* 品牌区 */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span
            className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"
            aria-hidden="true"
          >
            <Brain className="size-7" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{BRAND.appName}</h1>
          <p className="mt-1 text-sm font-medium text-primary">{BRAND.slogan}</p>
          <p className="mt-3 text-sm text-muted-foreground">{BRAND.loginWelcome}</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-username">{BRAND.loginUserLabel}</Label>
            <Input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={BRAND.loginUserPlaceholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-password">{BRAND.loginPassLabel}</Label>
            <div className="relative">
              <Input
                id="login-password"
                name="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pr-12"
              />
              <button
                type="button"
                aria-label={showPass ? BRAND.loginHidePass : BRAND.loginShowPass}
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-1 top-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {showPass ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading || !username || !password} className="h-11 w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                {BRAND.loginLoading}
              </>
            ) : (
              <>
                <KeyRound className="mr-2 size-4" aria-hidden="true" />
                {BRAND.loginSubmit}
              </>
            )}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">{BRAND.loginFoot}</p>
      </motion.div>
    </main>
  );
}
