'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Play, Plus, Snowflake, Lock, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { experiments as initialExps, runs as initialRuns, scorers, snapshots, dimensions, fieldDictVersion, type Experiment, type Run, type RunStatus } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td, Btn, Progress } from './primitives'

const runTone: Record<RunStatus, 'neutral' | 'primary' | 'pass' | 'warn' | 'fail'> = {
  queued: 'neutral',
  running: 'primary',
  completed: 'pass',
  partial: 'warn',
  failed: 'fail',
}

export function ExperimentsView({ initialId, newFromSnapshot }: { initialId?: string; newFromSnapshot?: string }) {
  const [exps, setExps] = useState<Experiment[]>(initialExps)
  const [runList, setRunList] = useState<Run[]>(initialRuns)
  const [sel, setSel] = useState(initialId && initialExps.some((e) => e.id === initialId) ? initialId : initialExps[0].id)
  const [creating, setCreating] = useState(Boolean(newFromSnapshot))
  const [draft, setDraft] = useState({ name: '', snapshotId: newFromSnapshot ?? snapshots[0].id, scorerIds: ['sc_intent'] as string[] })

  const exp = exps.find((e) => e.id === sel)!
  const expRuns = runList.filter((r) => r.experimentId === exp.id)
  const busy = runList.some((r) => r.status === 'running' || r.status === 'queued')

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => {
      setRunList((l) =>
        l.map((r) => {
          if (r.status === 'queued') return { ...r, status: 'running' }
          if (r.status !== 'running') return r
          const doneUnits = Math.min(r.units, r.doneUnits + Math.max(4, Math.ceil(r.units / 8)))
          return doneUnits < r.units ? { ...r, doneUnits } : { ...r, doneUnits, status: 'completed', cost: `¥${(r.units * 0.037).toFixed(2)}` }
        }),
      )
    }, 700)
    return () => clearInterval(timer)
  }, [busy])

  const execute = () => {
    const snap = snapshots.find((s) => s.id === exp.snapshotId)!
    const dimCount = exp.scorerIds.flatMap((id) => scorers.find((s) => s.id === id)!.outputs).length
    const id = `run_0${413 + runList.length - initialRuns.length}`
    setRunList((l) => [{ id, experimentId: exp.id, status: 'queued', units: snap.turns * dimCount, doneUnits: 0, errors: 0, startedAt: '刚刚', cost: '—' }, ...l])
  }

  const create = () => {
    const id = `exp_0${32 + exps.length - initialExps.length}`
    const outputs = draft.scorerIds.flatMap((sid) => scorers.find((s) => s.id === sid)!.outputs)
    const weights = Object.fromEntries(outputs.map((o) => [o, Number((1 / outputs.length).toFixed(2))]))
    setExps((e) => [{ id, name: draft.name || '未命名实验', snapshotId: draft.snapshotId, scorerIds: draft.scorerIds, weights, createdBy: '我', createdAt: '刚刚', fieldDictVersion }, ...e])
    setSel(id)
    setCreating(false)
    setDraft((d) => ({ ...d, name: '' }))
  }

  const published = scorers.filter((s) => s.status === 'published')

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Btn variant={creating ? 'outline' : 'primary'} onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />{creating ? '取消新建' : '新建实验'}
        </Btn>
        <Panel bodyClassName="p-1">
          <ul>
            {exps.map((e) => {
              const n = runList.filter((r) => r.experimentId === e.id).length
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => { setSel(e.id); setCreating(false) }}
                    aria-current={e.id === sel && !creating ? 'true' : undefined}
                    className={cn('w-full rounded-md px-3 py-2 text-left', e.id === sel && !creating ? 'bg-accent' : 'hover:bg-muted')}
                  >
                    <div className="truncate text-sm font-medium">{e.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Mono>{e.id}</Mono>
                      <span className="flex items-center gap-1"><Snowflake className="size-3" aria-hidden="true" /><Mono>{e.snapshotId}</Mono></span>
                      <span className="ml-auto">{n} run</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>

      {creating ? (
        <Panel title="新建实验">
          <div className="flex max-w-xl flex-col gap-4">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              名称
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：黄金集 · reply prompt v3"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              />
            </label>
            <fieldset>
              <legend className="mb-1.5 text-xs text-muted-foreground">快照（只读来源）</legend>
              <div className="flex flex-wrap gap-2">
                {snapshots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={draft.snapshotId === s.id}
                    onClick={() => setDraft({ ...draft, snapshotId: s.id })}
                    className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs', draft.snapshotId === s.id ? 'border-primary bg-accent' : 'bg-card hover:bg-muted')}
                  >
                    <Snowflake className="size-3 text-primary" aria-hidden="true" /><Mono>{s.id}</Mono>
                    <span className="text-muted-foreground">{s.turns} turn</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs text-muted-foreground">评分器（仅 published 可选）</legend>
              <div className="flex flex-col gap-1">
                {scorers.map((s) => {
                  const ok = s.status === 'published'
                  const on = draft.scorerIds.includes(s.id)
                  return (
                    <label key={s.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', ok ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-50')}>
                      <input
                        type="checkbox"
                        disabled={!ok}
                        checked={on}
                        onChange={() => setDraft({ ...draft, scorerIds: on ? draft.scorerIds.filter((x) => x !== s.id) : [...draft.scorerIds, s.id] })}
                        className="accent-primary"
                      />
                      {s.name}
                      <Mono className="text-muted-foreground">v{s.version}</Mono>
                      <span className="ml-auto flex gap-1">{s.outputs.map((o) => <Tag key={o}><Mono>{o}</Mono></Tag>)}</span>
                      {!ok ? <Tag>draft</Tag> : null}
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex items-center gap-3 border-t pt-4">
              <span className="font-mono text-[11px] text-muted-foreground">字段字典快照 {fieldDictVersion} · 已选 {draft.scorerIds.filter((id) => published.some((p) => p.id === id)).length} 个评分器</span>
              <Btn variant="primary" className="ml-auto" disabled={!draft.scorerIds.length} onClick={create}>创建</Btn>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={<span className="flex items-center gap-2">{exp.name}<Mono className="text-muted-foreground">{exp.id}</Mono></span>}
            actions={
              <Btn variant="primary" size="sm" onClick={execute}>
                <Play className="size-3.5" aria-hidden="true" />执行
              </Btn>
            }
          >
            <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">快照</dt>
                <dd className="mt-1 flex items-center gap-1.5"><Snowflake className="size-3.5 text-primary" aria-hidden="true" /><Mono>{exp.snapshotId}</Mono></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">字段字典</dt>
                <dd className="mt-1 flex items-center gap-1.5">
                  <Mono>{exp.fieldDictVersion}</Mono>
                  {exp.fieldDictVersion !== fieldDictVersion ? <Tag tone="warn">非最新</Tag> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">创建</dt>
                <dd className="mt-1">{exp.createdBy} · <Mono className="text-muted-foreground">{exp.createdAt}</Mono></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">配置</dt>
                <dd className="mt-1 flex items-center gap-1 text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />创建后不可改</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-col gap-2">
              {exp.scorerIds.map((id) => {
                const s = scorers.find((x) => x.id === id)!
                return (
                  <div key={id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Mono className="text-muted-foreground">{s.id}@v{s.version}</Mono>
                    <div className="ml-auto flex items-center gap-3">
                      {s.outputs.map((o) => (
                        <div key={o} className="flex items-center gap-2">
                          <Mono>{o}</Mono>
                          <span className="text-xs text-muted-foreground">{dimensions.find((d) => d.key === o)?.name}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${(exp.weights[o] ?? 0) * 100}%` }} /></div>
                          <Mono className="w-8 text-right text-muted-foreground">{exp.weights[o] ?? 0}</Mono>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel title="EvalRun" bodyClassName="p-0">
            {expRuns.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">尚未执行</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr><Th>run</Th><Th>状态</Th><Th>单元进度</Th><Th>error</Th><Th>费用</Th><Th>开始</Th><Th /></tr>
                </thead>
                <tbody className="divide-y">
                  {expRuns.map((r) => (
                    <tr key={r.id}>
                      <Td><Mono className="font-semibold">{r.id}</Mono></Td>
                      <Td><Tag tone={runTone[r.status]}>{r.status}</Tag></Td>
                      <Td>
                        <div className="flex w-48 items-center gap-2">
                          <Progress value={r.doneUnits / r.units} tone={r.status === 'partial' ? 'warn' : r.status === 'completed' ? 'pass' : 'primary'} />
                          <Mono className="shrink-0 text-muted-foreground">{r.doneUnits}/{r.units}</Mono>
                        </div>
                      </Td>
                      <Td><Mono className={r.errors ? 'text-warn' : 'text-muted-foreground'}>{r.errors}</Mono></Td>
                      <Td><Mono>{r.cost}</Mono></Td>
                      <Td><Mono className="text-muted-foreground">{r.startedAt}</Mono></Td>
                      <Td className="text-right">
                        {r.status === 'completed' || r.status === 'partial' ? (
                          <Link href={`/dashboard?run=${r.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <BarChart3 className="size-3.5" aria-hidden="true" />看板
                          </Link>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
