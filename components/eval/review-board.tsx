'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Bot, Wrench, Gavel, FileDiff, Zap, Check, X, ScrollText, GitCompareArrows, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dimensions, reviewSchema, reviewTurns as allTurns, type Verdict } from '@/lib/mock-data'
import { agreementStats, pct } from '@/lib/stats'
import { Tag, VerdictBadge, Mono, Progress, Btn } from './primitives'
import { EvidenceView } from './evidence-view'
import { WorkspaceDiff } from './workspace-diff'

const key = (c: string, t: number, d: string) => `${c}#${t}#${d}`

export function ReviewBoard({ dimKeys }: { dimKeys: string[] }) {
  const reviewTurns = useMemo(
    () => allTurns.map((t) => ({ ...t, judgments: t.judgments.filter((j) => dimKeys.includes(j.dim)) })).filter((t) => t.judgments.length > 0),
    [dimKeys],
  )
  const [idx, setIdx] = useState(0)
  const [focusDim, setFocusDim] = useState(0)
  const [human, setHuman] = useState<Record<string, Verdict>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const turn = reviewTurns[idx]
  const turnKey = `${turn.caseId}#${turn.turnNo}`

  const go = useCallback((delta: number) => {
    setIdx((i) => Math.min(reviewTurns.length - 1, Math.max(0, i + delta)))
    setFocusDim(0)
    setExpanded(false)
  }, [reviewTurns.length])

  const apply = useCallback(
    (value: Verdict) => {
      const j = turn.judgments[focusDim]
      setHuman((h) => ({ ...h, [key(turn.caseId, turn.turnNo, j.dim)]: value }))
      setFocusDim((f) => Math.min(turn.judgments.length - 1, f + 1))
    },
    [turn, focusDim],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
        if (e.key === 'Escape') t.blur()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const opt = reviewSchema.options.find((o) => o.key === e.key)
      if (opt) { e.preventDefault(); apply(opt.value); return }
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusDim((f) => Math.min(turn.judgments.length - 1, f + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusDim((f) => Math.max(0, f - 1)) }
      else if (e.key === 'n') { e.preventDefault(); noteRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, go, turn.judgments.length])

  const stats = useMemo(() => {
    const all = reviewTurns.flatMap((t) => t.judgments.map((j) => ({ t, j })))
    const pairs = all
      .filter(({ t, j }) => human[key(t.caseId, t.turnNo, j.dim)])
      .map(({ t, j }) => ({ judge: j.verdict, human: human[key(t.caseId, t.turnNo, j.dim)] }))
    const reviewedTurns = reviewTurns.filter((t) => t.judgments.every((j) => human[key(t.caseId, t.turnNo, j.dim)])).length
    return {
      ...agreementStats(pairs, all.length),
      reviewedTurns,
      judgePass: pairs.filter((p) => p.judge === 'pass').length,
      humanPass: pairs.filter((p) => p.human === 'pass').length,
    }
  }, [human, reviewTurns])

  const long = turn.agent.length > 240

  return (
    <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
      {/* queue */}
      <nav aria-label="复核队列" className="rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">队列 · {reviewTurns.length} 轮</div>
        <ul className="p-1">
          {reviewTurns.map((t, i) => {
            const done = t.judgments.every((j) => human[key(t.caseId, t.turnNo, j.dim)])
            const disagree = t.judgments.some((j) => {
              const h = human[key(t.caseId, t.turnNo, j.dim)]
              return h && h !== j.verdict
            })
            return (
              <li key={`${t.caseId}#${t.turnNo}`}>
                <button
                  type="button"
                  onClick={() => { setIdx(i); setFocusDim(0); setExpanded(false) }}
                  aria-current={i === idx ? 'true' : undefined}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs', i === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', done ? (disagree ? 'bg-warn' : 'bg-pass') : 'bg-border')} aria-hidden="true" />
                  <Mono>{t.caseId}</Mono>
                  <span className="text-muted-foreground">#{t.turnNo}/{t.totalTurns}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* card */}
      <article className="min-w-0 rounded-lg border bg-card" aria-label={`${turn.caseId} 第 ${turn.turnNo} 轮`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-base font-semibold">{turn.caseId}</Mono>
            {turn.totalTurns > 1 ? (
              <label className="relative inline-flex items-center">
                <span className="sr-only">选择轮次</span>
                <select
                  aria-label="选择轮次"
                  value={turn.turnNo}
                  onChange={(e) => {
                    const targetTurnNo = Number(e.target.value)
                    const targetIdx = reviewTurns.findIndex((t) => t.caseId === turn.caseId && t.turnNo === targetTurnNo)
                    if (targetIdx !== -1) {
                      setIdx(targetIdx)
                      setFocusDim(0)
                      setExpanded(false)
                    }
                  }}
                  className="h-7 cursor-pointer appearance-none rounded-md border border-input bg-card pl-2.5 pr-7 font-mono text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {Array.from({ length: turn.totalTurns }, (_, i) => i + 1).map((tNo) => (
                    <option key={tNo} value={tNo}>
                      turn {tNo} / {turn.totalTurns}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" aria-hidden="true" />
              </label>
            ) : (
              <Tag>turn 1/1</Tag>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={idx === 0}
              onClick={() => go(-1)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />上一条
            </button>
            <Mono className="px-2 text-sm text-muted-foreground">{idx + 1} / {reviewTurns.length}</Mono>
            <button
              type="button"
              disabled={idx === reviewTurns.length - 1}
              onClick={() => go(1)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              下一条<ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="divide-y">
          <Section icon={MessageSquare} n={1} label="用户">
            <p className="text-pretty text-[15px] leading-relaxed">{turn.user}</p>
          </Section>

          <Section icon={Bot} n={2} label="Agent">
            <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', long && !expanded && 'line-clamp-3')}>{turn.agent}</p>
            {long ? (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs text-primary hover:underline">
                {expanded ? '收起' : `展开（${turn.agent.length} 字）`}
              </button>
            ) : null}
          </Section>

          <Section icon={Wrench} n={3} label="工具">
            <ol className="flex flex-wrap items-center gap-1.5">
              {turn.tools.map((tool, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {i > 0 ? <span className="text-muted-foreground" aria-hidden="true">→</span> : null}
                  <span className="inline-flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-1 font-mono text-[11px]">
                    {tool.ok ? <Check className="size-3 text-pass" aria-label="成功" /> : <X className="size-3 text-fail" aria-label="失败" />}
                    <span className="font-medium">{tool.name}</span>
                    <span className="text-muted-foreground">{tool.args}</span>
                  </span>
                </li>
              ))}
            </ol>
            {turn.cards?.length ? (
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {turn.cards.map((card) => (
                  <li key={card.title} className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                    <span className="mr-1 font-medium">{card.title}</span>
                    {card.options.map((o) => (
                      <Tag key={o.label} tone={card.selected.includes(o.label) ? 'primary' : 'neutral'} className="px-2 py-1 text-xs">
                        {card.selected.includes(o.label) ? <Check className="size-3" aria-label="已选" /> : null}
                        {o.label}
                      </Tag>
                    ))}
                  </li>
                ))}
              </ul>
            ) : null}
            {turn.writeConfirm ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span>{turn.writeConfirm.title}</span>
                <Tag tone={turn.writeConfirm.confirmed ? 'pass' : 'neutral'} className="px-2 py-1 text-xs">{turn.writeConfirm.confirmed ? '已确认写入' : '未确认'}</Tag>
              </div>
            ) : null}
          </Section>

          {turn.gt?.length ? (
            <Section icon={ListChecks} n={4} label="准绳">
              <div className="flex flex-col gap-3">
                {turn.gt.map((g) => (
                  <div key={g.key} className="flex flex-col gap-1">
                    <Mono className="font-semibold text-primary">{g.key}</Mono>
                    <ol className="flex flex-col gap-1">
                      {g.points.map((p, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed">
                          <Mono className="mt-0.5 shrink-0 text-muted-foreground">{i + 1}</Mono>
                          <span className="min-w-0 text-pretty">{p}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section icon={Gavel} n={5} label="裁判">
            <ul className="flex flex-col gap-2">
              {turn.judgments.map((j, i) => {
                const dim = dimensions.find((d) => d.key === j.dim)!
                const h = human[key(turn.caseId, turn.turnNo, j.dim)]
                const focused = i === focusDim
                return (
                  <li
                    key={j.dim}
                    onClick={() => setFocusDim(i)}
                    className={cn('rounded-md border p-3 transition-colors', focused ? 'border-primary ring-2 ring-primary/15' : 'hover:border-input')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono className="text-muted-foreground">{j.dim}</Mono>
                      <span className="text-sm font-medium">{dim.name}</span>
                      <VerdictBadge verdict={j.verdict} />
                      {j.shortCircuit ? <Tag tone="primary" className="gap-1"><Zap className="size-3" aria-hidden="true" />short_circuit</Tag> : null}
                      {h && h !== j.verdict ? <Tag tone="warn" className="gap-1"><GitCompareArrows className="size-3" aria-hidden="true" />分歧</Tag> : null}
                      <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label={`${dim.name} 人工判定`}>
                        {reviewSchema.options.map((o) => {
                          const active = h === o.value
                          return (
                            <button
                              key={o.value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={(e) => { e.stopPropagation(); setFocusDim(i); setHuman((s) => ({ ...s, [key(turn.caseId, turn.turnNo, j.dim)]: o.value })) }}
                              className={cn(
                                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                                active && o.tone === 'pass' && 'border-pass bg-pass text-white',
                                active && o.tone === 'fail' && 'border-fail bg-fail text-white',
                                active && o.tone === 'na' && 'border-na bg-na text-white',
                                !active && 'bg-card hover:bg-muted',
                              )}
                            >
                              <kbd className={cn('font-mono text-[10px]', active ? 'opacity-80' : 'text-muted-foreground')}>{o.key}</kbd>
                              {o.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="mt-2.5 flex gap-2.5 rounded-md border-l-2 border-primary/50 bg-muted/40 py-2 pl-3 pr-2">
                      <span className="flex shrink-0 items-start gap-1 pt-0.5 text-[11px] font-medium text-primary">
                        <ScrollText className="size-3.5" aria-hidden="true" />
                        裁判证据
                      </span>
                      <p className="min-w-0 whitespace-pre-line text-pretty text-[13px] leading-relaxed text-foreground">{j.reason}</p>
                    </div>
                    {j.evidence ? <div className="mt-2"><EvidenceView evidence={j.evidence} /></div> : null}
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section icon={FileDiff} n={6} label="工作区">
            <WorkspaceDiff key={turnKey} meta={turn.workspace.meta} before={turn.workspace.before} after={turn.workspace.after} />
          </Section>

          <div className="px-4 py-3">
            <label htmlFor="review-note" className="mb-1 block text-xs text-muted-foreground">备注</label>
            <textarea
              id="review-note"
              ref={noteRef}
              rows={2}
              value={notes[turnKey] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [turnKey]: e.target.value }))}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
        </div>
      </article>

      {/* stats */}
      <aside className="flex flex-col gap-4">
        <nav aria-label="全部 case 进度" className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>卡片进度</span>
            <Mono>{idx + 1} / {reviewTurns.length}</Mono>
          </div>
          <ul className="grid grid-cols-5 gap-1.5">
            {reviewTurns.map((t, i) => {
              const active = i === idx
              const done = t.judgments.every((j) => human[key(t.caseId, t.turnNo, j.dim)])
              const disagree = t.judgments.some((j) => {
                const h = human[key(t.caseId, t.turnNo, j.dim)]
                return h && h !== j.verdict
              })
              const hasJudgeFail = t.judgments.some((j) => j.verdict === 'fail')
              return (
                <li key={`${t.caseId}#${t.turnNo}`}>
                  <button
                    type="button"
                    onClick={() => { setIdx(i); setFocusDim(0); setExpanded(false) }}
                    aria-label={`${t.caseId} 第 ${t.turnNo} 轮`}
                    aria-current={active ? 'true' : undefined}
                    title={`${t.caseId} #${t.turnNo}/${t.totalTurns}`}
                    className={cn(
                      'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border font-mono text-xs transition-colors',
                      active ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50',
                      done
                        ? (disagree ? 'bg-warn-soft text-warn font-semibold' : 'bg-pass-soft text-pass font-semibold')
                        : hasJudgeFail
                          ? (active ? 'bg-accent text-accent-foreground' : 'bg-fail-soft text-fail')
                          : (active ? 'bg-accent text-accent-foreground' : 'bg-muted/40 text-muted-foreground'),
                    )}
                  >
                    {i + 1}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">一致率</div>
          <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">{pct(stats.rate)}</div>
          <Mono className="text-muted-foreground">n = {stats.denominator}</Mono>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <dt className="text-muted-foreground">na 占比</dt><dd className="text-right font-mono">{pct(stats.naRatio)}</dd>
            <dt className="text-muted-foreground">覆盖度</dt><dd className="text-right font-mono">{pct(stats.coverage)}</dd>
            <dt className="text-muted-foreground">已复核轮次</dt><dd className="text-right font-mono">{stats.reviewedTurns}/{reviewTurns.length}</dd>
            <dt className="text-muted-foreground">裁判 pass</dt><dd className="text-right font-mono">{stats.judgePass}</dd>
            <dt className="text-muted-foreground">人工 pass</dt><dd className="text-right font-mono">{stats.humanPass}</dd>
          </dl>
          <Progress className="mt-4" value={stats.reviewedTurns / reviewTurns.length} tone="pass" />
        </div>
      </aside>
    </div>
  )
}

function Section({ icon: Icon, n, label, children }: { icon: React.ElementType; n: number; label: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[88px_1fr] gap-3 px-4 py-3">
      <h3 className="flex items-start gap-1.5 pt-0.5 text-xs text-muted-foreground">
        <span className="font-mono text-[10px]">{n}</span>
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </h3>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
