import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Verdict } from '@/lib/mock-data'

export function PageHeader({
  index,
  title,
  meta,
  actions,
  back,
}: {
  index: number
  title: string
  meta?: React.ReactNode
  actions?: React.ReactNode
  back?: string
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b bg-card px-6 py-4">
      <div className="flex items-center gap-3">
        {back ? (
          <Link
            href={back}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回
          </Link>
        ) : null}
        <span className="flex size-7 items-center justify-center rounded-md bg-primary font-mono text-xs font-semibold text-primary-foreground">
          {index}
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight text-balance">{title}</h1>
          {meta ? <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

type Tone = 'neutral' | 'primary' | 'pass' | 'fail' | 'na' | 'warn'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-transparent',
  primary: 'bg-accent text-accent-foreground border-transparent',
  pass: 'bg-pass-soft text-pass border-transparent',
  fail: 'bg-fail-soft text-fail border-transparent',
  na: 'bg-na-soft text-na border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
}

export function Tag({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none', toneClass[tone], className)}>
      {children}
    </span>
  )
}

const verdictLabel: Record<Verdict, string> = { pass: 'pass', fail: 'fail', na: 'na', error: 'error' }
const verdictTone: Record<Verdict, Tone> = { pass: 'pass', fail: 'fail', na: 'na', error: 'warn' }

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Tag tone={verdictTone[verdict]} className={cn('font-mono uppercase', className)}>
      {verdictLabel[verdict]}
    </Tag>
  )
}

export function Mono({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('font-mono text-[12px]', className)}>{children}</span>
}

export function Progress({ value, tone = 'primary', className }: { value: number; tone?: 'primary' | 'pass' | 'fail' | 'warn'; className?: string }) {
  const bar = { primary: 'bg-primary', pass: 'bg-pass', fail: 'bg-fail', warn: 'bg-warn' }[tone]
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  )
}

export function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th className={cn('whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground', className)}>{children}</th>
}

export function Td({ className, children, colSpan, onClick }: { className?: string; children?: React.ReactNode; colSpan?: number; onClick?: React.MouseEventHandler<HTMLTableCellElement> }) {
  return (
    <td colSpan={colSpan} onClick={onClick} className={cn('px-3 py-2.5 align-middle', className)}>
      {children}
    </td>
  )
}

export function Btn({
  variant = 'outline',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary',
    outline: 'bg-card hover:bg-muted border-input',
    ghost: 'border-transparent hover:bg-muted',
    danger: 'bg-fail text-white border-fail hover:bg-fail/90',
  }[variant]
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'
  return (
    <button
      type="button"
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', v, s, className)}
      {...props}
    />
  )
}

export function Ratio({ n, d, className }: { n: number; d: number; className?: string }) {
  const pct = d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className="font-semibold tabular-nums">{pct}</span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {n}/{d}
      </span>
    </span>
  )
}
