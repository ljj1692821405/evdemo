import { NextResponse, type NextRequest } from 'next/server'

/**
 * 登录守卫。
 *
 * 只做「有没有凭证」的轻量判断，不在这里校验 token 有效性：
 * 会话真伪由后端 /api/auth/me 决定，避免中间件里查库。
 *
 * 注意：token 存在 localStorage 时中间件读不到，因此登录成功后
 * 同时写一份非 httpOnly 的标记 cookie 供中间件识别；
 * 权限判断始终以服务端返回为准。
 */
const SESSION_COOKIE = 'eval_session'
const PUBLIC_PATHS = ['/login', '/auth/feishu/callback']

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)
  if (hasSession) return NextResponse.next()

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  loginUrl.searchParams.set('redirect', pathname + search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // 跳过静态资源与后端代理路径，避免无谓重定向
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
