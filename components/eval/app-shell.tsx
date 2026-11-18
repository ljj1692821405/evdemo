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
  Building2,
  Cpu,
  PenTool,
  Server,
  FileCheck2,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLines, useScope } from '@/lib/tenant-store'

const selectCls =
  'h-7 w-full rounded border border-sidebar-border bg-sidebar-accent/40 px-1.5 text-xs text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-primary'

function ScopeSwitcher() {
  const { lines } = useLines()
  const scope = useScope()
  return (
    <div className="flex flex-col gap-1.5 border-b border-sidebar-border px-3 py-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">产线</span>
        <select className={selectCls} value={scope.line?.id ?? ''} onChange={(e) => scope.setLine(e.target.value)}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">Agent</span>
        <select className={selectCls} value={scope.agent?.id ?? ''} onChange={(e) => scope.setAgent(e.target.value)} disabled={!scope.line?.agents.length}>
          {scope.line?.agents.length ? (
            scope.line.agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))
          ) : (
            <option value="">未接入 Agent</option>
          )}
        </select>
      </label>
    </div>
  )
}

const nav = [
  { group: 'L0 平台', items: [
    {
      href: '/lines',
      label: '产线管理',
      icon: Building2,
      children: [
        { href: '/lines', label: '产线与 Agent 配置', icon: Building2 },
        { href: '/lines/contract', label: '仿真契约注册台', icon: FileCheck2 },
      ],
    },
    { href: '/capabilities', label: '评测能力注册', icon: Cpu },
  ] },
  { group: 'L1 资产', items: [
    { href: '/datasets', label: '数据集 / Case', icon: Database },
    { href: '/field-dict', label: '字段字典', icon: BookA },
    { href: '/scorers', label: '维度与评分器', icon: Scale },
  ] },
  { group: 'L3 执行', items: [
    { href: '/simulations', label: '仿真与快照', icon: Snowflake },
    { href: '/experiments', label: '实验与评测', icon: FlaskConical },
  ] },
  { group: 'L5 消费与对齐', items: [
    { href: '/dashboard', label: '数据看板', icon: Gauge },
    { href: '/review', label: '核对看板', icon: Microscope },
    { href: '/annotation', label: '标注工作台', icon: PenTool },
    { href: '/export', label: '报告 / 导出', icon: FileDown },
  ] },
  { group: 'L6 模型', items: [
    { href: '/models', label: '模型服务', icon: Server },
  ] },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  let i = -1
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary font-mono text-xs font-bold text-sidebar-primary-foreground">
            EV
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-sidebar-accent-foreground">评测平台</div>
          </div>
        </div>
        <ScopeSwitcher />
        <nav aria-label="主导航" className="flex-1 overflow-y-auto px-2 py-3">
          {nav.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">{g.group}</div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((item) => {
                  i += 1
                  const isParentActive = pathname.startsWith(item.href)
                  const Icon = item.icon
                  const hasChildren = Boolean(item.children?.length)

                  return (
                    <li key={item.href} className="flex flex-col gap-0.5">
                      <Link
                        href={item.href}
                        aria-current={pathname === item.href ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                          pathname === item.href || (isParentActive && !hasChildren)
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                            : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <span className={cn('w-3 font-mono text-[10px]', isParentActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/40')}>{i}</span>
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate flex-1">{item.label}</span>
                        {hasChildren && (
                          <ChevronDown className={cn('size-3.5 text-sidebar-foreground/40 transition-transform duration-200', isParentActive && 'rotate-180')} />
                        )}
                      </Link>

                      {/* 子导航展开 */}
                      {hasChildren && isParentActive && (
                        <ul className="ml-5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2 my-0.5">
                          {item.children!.map((child) => {
                            const isChildActive = pathname === child.href
                            const ChildIcon = child.icon
                            return (
                              <li key={child.href}>
                                <Link
                                  href={child.href}
                                  className={cn(
                                    'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
                                    isChildActive
                                      ? 'bg-sidebar-primary/10 text-sidebar-primary font-bold'
                                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                                  )}
                                >
                                  <ChildIcon className="size-3 shrink-0" />
                                  <span className="truncate">{child.label}</span>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
