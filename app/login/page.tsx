'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-store'

function LoginCard() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, feishuConfigured, backendOnline, loading, login, isLoggedIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const returnTo = params.get('redirect') || '/'

  // 已登录直接放行，避免回退时又看到登录页
  useEffect(() => {
    if (!loading && isLoggedIn) router.replace(returnTo)
  }, [loading, isLoggedIn, returnTo, router])

  const onLogin = async () => {
    setBusy(true)
    setError('')
    try {
      await login(returnTo)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '无法发起飞书登录')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-primary font-mono text-base font-bold text-primary-foreground">
            EV
          </div>
          <h1 className="text-lg font-semibold tracking-tight">评测平台</h1>
          <p className="mt-1 text-xs text-muted-foreground">快照式 · 配置驱动的批量评测</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          {loading ? (
            <p className="text-center text-xs text-muted-foreground">正在检查登录状态…</p>
          ) : (
            <>
              <button
                type="button"
                onClick={onLogin}
                disabled={busy || !feishuConfigured || !backendOnline}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '正在跳转飞书…' : !backendOnline ? '等待后端就绪…' : '使用飞书扫码登录'}
              </button>

              {!backendOnline && (
                <div className="mt-4 rounded-md border border-sky-300/60 bg-sky-50 p-3 text-[11px] leading-relaxed text-sky-800">
                  <div className="mb-1 font-semibold flex items-center gap-1.5">
                    <span className="inline-block size-2 animate-ping rounded-full bg-sky-500" />
                    后端服务连接中…
                  </div>
                  正在探测后端服务 (http://127.0.0.1:8000)，启动完成后将自动就绪，无需手动刷新。
                </div>
              )}

              {backendOnline && !feishuConfigured && (
                <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                  <div className="mb-1 font-semibold">飞书登录尚未配置</div>
                  在 <code className="font-mono">backend/.env</code> 里填{' '}
                  <code className="font-mono">FEISHU_APP_ID</code> /{' '}
                  <code className="font-mono">FEISHU_APP_SECRET</code>，并把回调地址加入飞书开放平台的白名单。
                </div>
              )}

              {error && (
                <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>
              )}

              <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
                登录后系统会记录你的飞书身份（昵称、邮箱、头像），
                <br />
                用于区分操作记录。
              </p>
            </>
          )}
        </div>

        {user && (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            当前身份：{user.name}
          </p>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-xs text-muted-foreground">加载中…</div>}>
      <LoginCard />
    </Suspense>
  )
}
