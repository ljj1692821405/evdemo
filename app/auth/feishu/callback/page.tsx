'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { exchangeFeishuCode } from '@/lib/api-client'
import { consumeLoginState, setSessionToken } from '@/lib/auth-store'

type ExchangeResult = Awaited<ReturnType<typeof exchangeFeishuCode>>

/**
 * 按 code 缓存换取请求。
 *
 * 飞书授权码是一次性的，用一次就失效。而 React 开发模式（StrictMode）下
 * useEffect 会执行两次，若各发一次请求，第二次必然因「code 已使用」而报错，
 * 表现为「报错闪一下又进去」。这里让同一个 code 只真正请求一次，
 * 两次 effect 共享同一个 Promise。
 */
const exchangeCache = new Map<string, Promise<ExchangeResult>>()

function exchangeOnce(code: string, state: string): Promise<ExchangeResult> {
  let p = exchangeCache.get(code)
  if (!p) {
    p = exchangeFeishuCode(code, state)
    exchangeCache.set(code, p)
  }
  return p
}

/**
 * 飞书登录回调页。
 *
 * 飞书把浏览器重定向到这里并带上 ?code=xxx。这里把 code 交给后端换取会话：
 * app_secret 只在服务端，浏览器全程不接触。
 */
export default function FeishuCallbackPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = params.get('code') || ''
    const stateFromUrl = params.get('state') || ''
    const errFromUrl = params.get('error') || params.get('error_description') || ''

    if (errFromUrl) {
      setError(`飞书返回错误：${errFromUrl}`)
      return
    }
    if (!code) {
      setError('回调缺少授权码 code，请重新发起登录')
      return
    }

    const { state, returnTo } = consumeLoginState()
    // state 不一致说明回调不是本次发起的，可能是 CSRF。
    // 注意第二次 effect 执行时本地 state 已被消费为空，此时跳过校验由缓存兜底。
    if (state && stateFromUrl && !stateFromUrl.startsWith(state)) {
      setError('登录状态校验失败（state 不匹配），请重新登录')
      return
    }

    let active = true
    exchangeOnce(code, stateFromUrl || state)
      .then((data) => {
        setSessionToken(data.sessionToken)
        router.replace(data.redirect || returnTo || '/')
      })
      .catch((e: unknown) => {
        // 请求失败允许重试：移除缓存，否则刷新也拿不到新结果
        exchangeCache.delete(code)
        if (active) setError(e instanceof Error ? e.message : '登录失败')
      })

    return () => {
      active = false
    }
  }, [params, router])

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <div className="mb-2 text-sm font-semibold text-destructive">登录失败</div>
            <p className="mb-5 text-xs leading-relaxed text-muted-foreground">{error}</p>
            <a
              href="/login"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              返回登录页
            </a>
          </>
        ) : (
          <>
            <div className="mb-3 text-sm font-medium">正在完成登录…</div>
            <p className="text-xs text-muted-foreground">正在校验飞书身份，请稍候</p>
          </>
        )}
      </div>
    </div>
  )
}

