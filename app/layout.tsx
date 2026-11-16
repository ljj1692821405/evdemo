import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Noto_Sans_SC } from 'next/font/google'
import { AppShell } from '@/components/eval/app-shell'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const notoSansSC = Noto_Sans_SC({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-noto-sans-sc' })

export const metadata: Metadata = {
  title: '评测平台 · 插件化多模态评测体系',
  description: '快照式、配置驱动的批量评测平台：支持 Agent、文生图、图生视频通用评测能力注册、导入与人工标注对齐',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f8f9fb',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} bg-background`}>
      <body className="antialiased font-sans">
        <AppShell>{children}</AppShell>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
