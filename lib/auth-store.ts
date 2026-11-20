'use client'

import { useCallback, useEffect } from 'react'
import useSWR from 'swr'
import {
  fetchAuthStatus,
  fetchLoginUrl,
  exchangeFeishuCode,
  fetchMe,
  logout as apiLogout,
  type AuthUser,
} from './api-client'

const TOKEN_KEY = 'eval_session_token'
const SESSION_COOKIE = 'eval_session'
const STATE_KEY = 'eval_login_state'
const RETURN_KEY = 'eval_login_return'

export type LoginState = {
  /** 已登录用户；null 表示未登录 */
  user: AuthUser | null
  /** 飞书是否已配置好，未配置时给出提示而不是让用户点进死路 */
  feishuConfigured: boolean
  /** 正在校验会话 */
  loading: boolean
}

/** 读取本地会话 token。SSR 阶段返回空串，避免 window 未定义。 */
export function getSessionToken(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(TOKEN_KEY) || ''
}

export function setSessionToken(token: string): void {
  if (typeof window === 'undefined') return
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
    // 中间件只认 cookie（读不到 localStorage），写一份标记供路由守卫识别。
    // 不放真实 token，降低 XSS 窃取面；鉴权始终由后端 /api/auth/me 完成。
    document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
    document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`
  }
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

/**
 * 发起飞书登录：生成 state 存本地，然后整页跳到飞书授权页。
 * 用整页跳转而非 popup，因为飞书扫码页在弹窗里容易被拦截。
 */
export async function startFeishuLogin(returnTo?: string): Promise<void> {
  const state = uid()
  window.localStorage.setItem(STATE_KEY, state)
  window.localStorage.setItem(RETURN_KEY, returnTo || window.location.pathname + window.location.search)

  const { url } = await fetchLoginUrl(state, returnTo)
  window.location.href = url
}

/** 飞书回调页读取并清除本地 state，用于防 CSRF。 */
export function consumeLoginState(): { state: string; returnTo: string } {
  if (typeof window === 'undefined') return { state: '', returnTo: '/' }
  const state = window.localStorage.getItem(STATE_KEY) || ''
  const returnTo = window.localStorage.getItem(RETURN_KEY) || '/'
  window.localStorage.removeItem(STATE_KEY)
  window.localStorage.removeItem(RETURN_KEY)
  return { state, returnTo }
}

export type AuthState = {
  user: AuthUser | null
  feishuConfigured: boolean
  backendOnline: boolean
}

export function useAuth() {
  const token = typeof window === 'undefined' ? '' : getSessionToken()

  const { data, mutate, isLoading } = useSWR<AuthState>(
    'auth:me',
    async () => {
      let status: { feishuConfigured: boolean; redirectUri: string }
      let backendOnline = true
      try {
        status = await fetchAuthStatus()
      } catch {
        backendOnline = false
        status = { feishuConfigured: false, redirectUri: '' }
      }

      if (!backendOnline) {
        return { user: null, feishuConfigured: false, backendOnline: false }
      }

      if (!getSessionToken()) {
        return { user: null, feishuConfigured: status.feishuConfigured, backendOnline: true }
      }

      try {
        const { user } = await fetchMe()
        return { user, feishuConfigured: status.feishuConfigured, backendOnline: true }
      } catch {
        // token 失效：清掉本地残留，回到未登录态
        setSessionToken('')
        return { user: null, feishuConfigured: status.feishuConfigured, backendOnline: true }
      }
    },
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // 当后端不在线时，每隔 2 秒自动重试一次直到后端上线
      refreshInterval: (latestData) => (latestData && !latestData.backendOnline ? 2000 : 0),
    },
  )

  const login = useCallback(async (returnTo?: string) => {
    await startFeishuLogin(returnTo)
  }, [])

  const logout = useCallback(async () => {
    try {
      if (getSessionToken()) await apiLogout()
    } finally {
      setSessionToken('')
      await mutate(
        { user: null, feishuConfigured: data?.feishuConfigured ?? false, backendOnline: data?.backendOnline ?? true },
        { revalidate: false },
      )
    }
  }, [mutate, data?.feishuConfigured, data?.backendOnline])

  return {
    user: data?.user ?? null,
    feishuConfigured: data?.feishuConfigured ?? false,
    backendOnline: data?.backendOnline ?? true,
    loading: isLoading,
    isLoggedIn: Boolean(data?.user),
    login,
    logout,
    refresh: mutate,
  }
}
