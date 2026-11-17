'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeft, Play, Loader2, Search, Check, X, Equal, CircleSlash, Upload, Pencil, Gavel, Clock, Coins, ArrowDownUp, History, Camera, UserRound, Braces,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { dimensions, experiments, snapshots, type Scorer } from '@/lib/mock-data'
import { resolveEntry, useFieldDict } from '@/lib/field-dict-store'
import { fieldValues, runTrial, trialUnits, type TrialResult } from '@/lib/trial-data'
import { judgeSections, type JudgeTool } from '@/lib/judge-prompt'
import { Mono, Tag, VerdictBadge, Btn } from './primitives'
import { judgeModels, referencedVars } from './prompt-editor'

type Props = {
  scorer: Scorer
  template: string
  background: string
  agentBackground: string
  tools: JudgeTool[]
  onClose: () => void
  onChange: (patch: Partial<Scorer>) => void
  onPublish: () => void
  onPassed: () => void
}

export function TrialLab({ scorer, template, background, agentBackground, tools, onClose, onChange, onPublish, onPassed }: Props) {
  const [snapId, setSnapId] = useState(() => experiments.find((e) => e.scorerIds.includes(scorer.id))?.snapshotId ?? snapshots[0].id)
  const units = useMemo(() => trialUnits(snapId), [snapId])
  const [sel, setSel] = useState(units[0]?.key)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'prompt' | 'fields'>('prompt')
  const [editing, setEditing] = useState(false)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<TrialResult[]>([])
  const [shown, setShown] = useState<string | null>(null)

  const unit = units.find((u) => u.key === sel) ?? units[0]
  const dict = useFieldDict()
  const baseValues: Record<string, string | null> = unit ? fieldValues(unit) : {}
  const values: Record<string, string | null> = {}
  for (const f of scorer.inputFields) {
    const entry = dict.find(f)
    values[f] = !entry ? null : f in baseValues ? baseValues[f] : resolveEntry(entry)
  }
  const usesPrompt = scorer.implType !== 'script'
  const refs = usesPrompt ? referencedVars(template) : []
  const sections = judgeSections({
    agentBackground,
    extraBackground: background,
    template,
    fields: refs.filter((r) => scorer.inputFields.includes(r)).flatMap((r) => dict.find(r) ?? []),
    tools,
  })
  const model = scorer.judgeModel ?? judgeModels[0]
  const locked = scorer.status === 'published'
  const filtered = units.filter((u) => !q || u.key.includes(q) || u.query.includes(q))
  const latestFor = (key: string) => history.find((h) => h.unitKey === key)
  const result = history.find((h) => h.id === shown) ?? (unit ? latestFor(unit.key) : undefined)
  const schemaPassed = history.some((h) => h.checks.every((c) => c.ok))

  const run = () => {
    if (!unit) return
    setRunning(true)
    const seq = history.length + 1
    setTimeout(() => {
      const r = runTrial(scorer, unit, template, refs, model, seq)
      setHistory((h) => [r, ...h])
      setShown(r.id)
      if (r.checks.every((c) => c.ok)) onPassed()
      setRunning(false)
    }, 900)
  }

  const pick = (key: string) => {
    setSel(key)
    setShown(null)
  }

  return (
    <div className="flex h-[calc(100dvh-73px)] min-h-[600px] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-6 py-2.5">
        <Btn size="sm" onClick={onClose}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />返回
        </Btn>
        <span className="flex items-center gap-2 text-sm font-medium">
          试跑
          <Mono className="text-muted-foreground">{scorer.id}@v{scorer.version}</Mono>
        </span>
        <div className="flex gap-1">
          {scorer.outputs.map((o) => (
            <Tag key={o} tone="primary"><Mono>{o}</Mono>{dimensions.find((d) => d.key === o)?.name || o}</Tag>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {usesPrompt ? (
            <select
              aria-label="裁判模型"
              value={model}
              disabled={locked}
              onChange={(e) => onChange({ judgeModel: e.target.value })}
              className="h-7 rounded-md border bg-card px-2 font-mono text-xs"
            >
              {judgeModels.map((m) => <option key={m}>{m}</option>)}
            </select>
          ) : null}
          <Btn size="sm" variant="primary" onClick={run} disabled={running || !unit}>
            {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            运行
          </Btn>
          {!locked ? (
            <Btn size="sm" disabled={!schemaPassed} onClick={() => { onPublish(); onClose() }}>
              <Upload className="size-3.5" aria-hidden="true" />发布
            </Btn>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="flex min-h-0 flex-col border-r bg-card">
          <div className="flex flex-col gap-2 border-b p-3">
            <label className="flex items-center gap-2">
              <Camera className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">快照</span>
              <select
                value={snapId}
                onChange={(e) => { setSnapId(e.target.value); setSel(trialUnits(e.target.value)[0]?.key); setShown(null) }}
                className="h-7 min-w-0 flex-1 rounded-md border bg-card px-2 font-mono text-xs"
              >
                {snapshots.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.cases} case</option>)}
              </select>
            </label>
            <label className="relative">
              <span className="sr-only">搜索 case</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="intent_0001"
                className="h-7 w-full rounded-md border bg-card pl-7 pr-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="case">
            {filtered.map((u) => {
              const last = latestFor(u.key)
              const active = u.key === unit?.key
              return (
                <li key={u.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(u.key)}
                    className={cn('flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left', active ? 'bg-accent' : 'hover:bg-muted')}
                  >
                    <span className="flex items-center gap-1.5">
                      <Mono className={cn(active && 'text-accent-foreground')}>{u.caseId}</Mono>
                      {u.turns > 1 ? <Mono className="text-[11px] text-muted-foreground">#{u.turn}/{u.turns}</Mono> : null}
                      <span className="ml-auto flex items-center gap-1">
                        {u.gtKeys.length ? <span className="size-1.5 rounded-full bg-primary/60" role="img" aria-label="有 GT" /> : null}
                        {last ? <ResultDot r={last} /> : null}
                      </span>
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{u.query}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <section className="flex min-h-0 flex-col bg-background">
          <div className="flex items-center gap-1 border-b bg-card px-4 py-2">
            {(['prompt', 'fields'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                disabled={k === 'prompt' && !usesPrompt}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium disabled:hidden', tab === k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {k === 'prompt' ? '最终提示词' : `输入字段 · ${scorer.inputFields.length}`}
              </button>
            ))}
            {tab === 'prompt' && usesPrompt && !locked ? (
              <Btn size="sm" variant={editing ? 'primary' : 'ghost'} className="ml-auto" onClick={() => setEditing((v) => !v)}>
                {editing ? <Check className="size-3.5" aria-hidden="true" /> : <Pencil className="size-3.5" aria-hidden="true" />}
                {editing ? '完成' : '编辑'}
              </Btn>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'prompt' && usesPrompt ? (
              editing ? (
                <div className="flex h-full flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><UserRound className="size-3.5" aria-hidden="true" />追加背景</span>
                    <textarea
                      value={background}
                      onChange={(e) => onChange({ background: e.target.value })}
                      rows={3}
                      className="w-full resize-y rounded-lg border bg-card p-3 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    />
                  </label>
                  <label className="flex min-h-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Braces className="size-3.5" aria-hidden="true" />提示词</span>
                    <textarea
                      value={template}
                      onChange={(e) => onChange({ promptTemplate: e.target.value })}
                      className="min-h-72 w-full flex-1 resize-none rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    />
                  </label>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {sections.map((sec) => (
                    <section key={sec.key} className="flex flex-col gap-1">
                      <h3 className="text-xs font-medium text-muted-foreground">{sec.title}</h3>
                      {sec.key === 'rules' ? (
                        <RenderedPrompt template={template} values={values} bound={scorer.inputFields} />
                      ) : (
                        <p className="whitespace-pre-wrap rounded-lg border bg-card p-4 text-[13px] leading-relaxed">{sec.body}</p>
                      )}
                    </section>
                  ))}
                </div>
              )
            ) : (
              <FieldList fields={scorer.inputFields} values={values} />
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {running ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-label="运行中" />
              </div>
            ) : result ? (
              <ResultPanel r={result} />
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
                <Gavel className="size-8 opacity-40" aria-hidden="true" />
                <Btn size="sm" onClick={run} disabled={!unit}>
                  <Play className="size-3.5" aria-hidden="true" />运行 {unit?.key}
                </Btn>
              </div>
            )}
          </div>
          <div className="max-h-56 shrink-0 overflow-y-auto border-t">
            <div className="sticky top-0 flex items-center gap-1.5 bg-card px-4 py-2 text-xs font-medium">
              <History className="size-3.5 text-muted-foreground" aria-hidden="true" />记录
              <Mono className="ml-auto text-muted-foreground">{history.length}</Mono>
            </div>
            <ul className="pb-1.5">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => { setSel(h.unitKey); setShown(h.id) }}
                    aria-current={result?.id === h.id ? 'true' : undefined}
                    className={cn('flex w-full items-center gap-2 px-4 py-1.5 text-left', result?.id === h.id ? 'bg-accent/60' : 'hover:bg-muted')}
                  >
                    <ResultDot r={h} />
                    <Mono className="truncate">{h.unitKey}</Mono>
                    <Mono className="ml-auto truncate text-[11px] text-muted-foreground">{h.model.split('/')[1]}</Mono>
                    <Mono className="text-[11px] text-muted-foreground">{h.at}</Mono>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ResultDot({ r }: { r: TrialResult }) {
  const bad = r.dims.some((d) => d.verdict === 'error')
  const mismatch = r.dims.some((d) => d.gt && d.gt !== d.verdict)
  const tone = bad ? 'bg-warn' : mismatch ? 'bg-fail' : 'bg-pass'
  return <span className={cn('size-2 shrink-0 rounded-full', tone)} role="img" aria-label={bad ? 'error' : mismatch ? '与 GT 不一致' : '与 GT 一致'} />
}

function RenderedPrompt({ template, values, bound }: { template: string; values: Record<string, string | null>; bound: string[] }) {
  const parts = template.split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g)
  return (
    <div className="whitespace-pre-wrap rounded-lg border bg-card p-4 text-[13px] leading-relaxed">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/)
        if (!m) return <span key={i}>{p}</span>
        const name = m[1]
        const ok = bound.includes(name)
        const v = values[name]
        return (
          <span
            key={i}
            className={cn(
              'my-1 block rounded-md border-l-2 px-3 py-2 font-mono text-[12px]',
              !ok ? 'border-warn bg-warn-soft text-warn' : v == null ? 'border-na bg-na-soft text-na' : 'border-primary bg-accent/40',
            )}
          >
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold opacity-70">
              {`{{${name}}}`}
              {!ok ? <Tag tone="warn">未绑定</Tag> : v == null ? <Tag tone="na">null</Tag> : null}
            </span>
            {ok && v != null ? v : null}
          </span>
        )
      })}
    </div>
  )
}

function FieldList({ fields, values }: { fields: string[]; values: Record<string, string | null> }) {
  const dict = useFieldDict()
  return (
    <ul className="flex flex-col gap-3">
      {fields.map((f) => {
        const entry = dict.find(f)
        const v = values[f]
        return (
          <li key={f} className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Mono className="font-semibold">{f}</Mono>
              <Mono className="truncate text-[11px] text-muted-foreground">{v == null ? entry?.paths.join(' | ') : entry?.paths[0]}</Mono>
              <span className="ml-auto">
                {v == null ? <Tag tone="na">null</Tag> : <Mono className="text-[11px] text-muted-foreground">{Math.round(v.length * 1.4)} tok</Mono>}
              </span>
            </div>
            {v != null ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed">{v}</pre> : null}
          </li>
        )
      })}
    </ul>
  )
}

function ResultPanel({ r }: { r: TrialResult }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {r.checks.map((c) => (
          <Tag key={c.label} tone={c.ok ? 'pass' : 'fail'}>
            {c.ok ? <Check className="size-3" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
            {c.label}
          </Tag>
        ))}
      </div>

      {r.dims.map((d) => {
        const dim = dimensions.find((x) => x.key === d.key)
        const match = d.gt ? d.gt === d.verdict : null
        return (
          <div key={d.key} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <Mono className="text-muted-foreground">{d.key}</Mono>
              <span className="text-sm font-medium">{dim?.name}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <VerdictBadge verdict={d.verdict} />
                {match === null ? (
                  <CircleSlash className="size-3.5 text-muted-foreground" aria-label="无 GT" />
                ) : match ? (
                  <Equal className="size-3.5 text-pass" aria-label="与 GT 一致" />
                ) : (
                  <X className="size-3.5 text-fail" aria-label="与 GT 不一致" />
                )}
                {d.gt ? (
                  <span className="flex items-center gap-1">
                    <Mono className="text-[11px] text-muted-foreground">GT</Mono>
                    <VerdictBadge verdict={d.gt} />
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3 text-sm">
              <p>{d.reason}</p>
              {d.evidence.length ? (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <Gavel className="size-3" aria-hidden="true" />裁判证据
                  </span>
                  {d.evidence.map((e, i) => (
                    <blockquote key={i} className="rounded-md border-l-2 border-primary/50 bg-muted/50 px-2.5 py-1.5">
                      <Mono className="block text-[10px] text-muted-foreground">{e.field}</Mono>
                      <span className="text-[13px]">{e.quote}</span>
                    </blockquote>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}

      <dl className="grid grid-cols-3 gap-2">
        <Meta icon={Clock} label="耗时" value={`${(r.latencyMs / 1000).toFixed(2)}s`} />
        <Meta icon={ArrowDownUp} label="tok" value={`${r.tokensIn}/${r.tokensOut}`} />
        <Meta icon={Coins} label="费用" value={`¥${r.cost.toFixed(4)}`} />
      </dl>

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 font-mono text-xs text-muted-foreground">raw</summary>
        <pre className="overflow-auto border-t bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(r.raw, null, 2)}</pre>
      </details>
    </div>
  )
}

function Meta({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground"><Icon className="size-3" />{label}</dt>
      <dd className="mt-0.5 font-mono text-xs font-semibold">{value}</dd>
    </div>
  )
}
