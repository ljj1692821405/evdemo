'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Database,
  BookA,
  Scale,
  Snowflake,
  FlaskConical,
  Gauge,
  Microscope,
  FileDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { group: 'L1 资产', items: [
    { href: '/datasets', label: '数据集 / Case', icon: Database },
    { href: '/field-dict', label: '字段字典', icon: BookA },
    { href: '/scorers', label: '维度与评分器', icon: Scale },
  ] },
  { group: 'L3 执行', items: [
    { href: '/simulations', label: '仿真与快照', icon: Snowflake },
    { href: '/experiments', label: '实验与评测', icon: FlaskConical },
  ] },
  { group: 'L5 消费', items: [
    { href: '/dashboard', label: '数据看板', icon: Gauge },
    { href: '/review', label: '核对看板', icon: Microscope },
    { href: '/export', label: '报告 / 导出', icon: FileDown },
  ] },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  let i = 0
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-mono text-xs font-bold text-sidebar-primary-foreground">
            EV
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-sidebar-accent-foreground">评测平台</div>
            <div className="font-mono text-[10px] text-sidebar-foreground/60">v0.4-slim</div>
          </div>
        </div>
        <nav aria-label="主导航" className="flex-1 overflow-y-auto px-2 py-3">
          {nav.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50">{g.group}</div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((item) => {
                  i += 1
                  const active = pathname.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <span className={cn('w-3 font-mono text-[10px]', active ? 'text-sidebar-primary' : 'text-sidebar-foreground/40')}>{i}</span>
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 font-mono text-[10px] leading-relaxed text-sidebar-foreground/50">
          raw 只落盘 · sim 才评分
          <br />
          快照只读 · 分数只增
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
