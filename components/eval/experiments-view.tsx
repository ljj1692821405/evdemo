'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Play, Plus, Snowflake, Lock, BarChart3, Boxes, Activity, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useScope } from '@/lib/tenant-store'
import { useCapabilities } from '@/lib/capability-store'
import { resolveConfig, snapshotForExp, toFrozen, type FrozenSnapshot } from '@/lib/capability-data'
import { FrozenSnapshotCard } from './capability-snapshot'
import { cn } from '@/lib/utils'
import { useFieldDict } from '@/lib/field-dict-store'
import { useDatasets } from '@/lib/dataset-store'
import { experiments as initialExps, runs as initialRuns, scorers, snapshots, dimensions, type Experiment, type Run, type RunStatus } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td, Btn, Progress } from './primitives'

const runTone: Record<RunStatus, 'neutral' | 'primary' | 'pass' | 'warn' | 'fail'> = {
  queued: 'neutral',
  running: 'primary',
  completed: 'pass',
  partial: 'warn',
  failed: 'fail',
}

type RunnerStep = {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

const uniqueName = (base: string, existing: string[]) => {
  const name = base.trim() || '未命名实验'
  if (!existing.includes(name)) return name
  let n = 2
  while (existing.includes(`${name} #${n}`)) n += 1
  return `${name} #${n}`
}

export function ExperimentsView({ initialId, newFromSnapshot }: { initialId?: string; newFromSnapshot?: string }) {
  const { version: fieldDictVersion } = useFieldDict()
  const { agent } = useScope()
  const caps = useCapabilities()
  const { datasets } = useDatasets()
  const [createdSnaps, setCreatedSnaps] = useState<Record<string, FrozenSnapshot>>({})
  const [exps, setExps] = useState<Experiment[]>(initialExps)
  const [runList, setRunList] = useState<Run[]>(initialRuns)
  const [sel, setSel] = useState(initialId && initialExps.some((e) => e.id === initialId) ? initialId : initialExps[0].id)
  const [creating, setCreating] = useState(Boolean(newFromSnapshot))
  const [draft, setDraft] = useState({ name: '', snapshotId: newFromSnapshot ?? snapshots[0].id, scorerIds: [scorers[0].id] as string[] })

  // Runner 实时调度抽屉状态
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runnerSteps, setRunnerSteps] = useState<RunnerStep[]>([])

  const exp = exps.find((e) => e.id === sel)!
  const expRuns = runList.filter((r) => r.experimentId === exp.id)
  const busy = runList.some((r) => r.status === 'running' || r.status === 'queued')

  const snapshotLabel = (snapshotId: string) => {
    const snap = snapshots.find((s) => s.id === snapshotId)
    const ds = snap ? datasets.find((d) => d.id === snap.datasetId) : undefined
    return ds?.name ?? snapshotId
  }

  const draftName = draft.name.trim()
  const nameTaken = draftName !== '' && exps.some((e) => e.name === draftName)
  const nextName = nameTaken ? uniqueName(draftName, exps.map((e) => e.name)) : draftName

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => {
      setRunList((l) =>
        l.map((r) => {
          if (r.status === 'queued') return { ...r, status: 'running' }
          if (r.status !== 'running') return r
          const doneUnits = Math.min(r.units, r.doneUnits + Math.max(1, Math.ceil(r.units / 6)))
          const isDone = doneUnits >= r.units
          return isDone
            ? { ...r, doneUnits: r.units, status: 'completed', cost: `¥${(r.units * 0.035).toFixed(2)}` }
            : { ...r, doneUnits }
        }),
      )
    }, 700)
    return () => clearInterval(timer)
  }, [busy])

  const execute = () => {
    const snap = snapshots.find((s) => s.id === exp.snapshotId)!
    const dimCount = exp.scorerIds.flatMap((id) => scorers.find((s) => s.id === id)!.outputs).length
    const id = `run_0${413 + runList.length - initialRuns.length}`
    const newRun: Run = {
      id,
      experimentId: exp.id,
      status: 'queued',
      units: Math.max(1, snap.turns * dimCount),
      doneUnits: 0,
      errors: 0,
      startedAt: '刚刚',
      cost: '—',
    }

    setRunList((l) => [newRun, ...l])
    setActiveRunId(id)

    // 模拟 Runner 调度状态机
    setRunnerSteps([
      { id: '1', title: '解析字段映射 (Data Pipe Resolver)', status: 'running', detail: '从快照提取 user_query、agent_reply、workspace_diff 等入参...' },
      { id: '2', title: '加载底层评测能力 (Adapter / API Protocol)', status: 'pending', detail: `加载 ${exp.scorerIds.length} 个评分器绑定的评测引擎...` },
      { id: '3', title: '并发批量打分与证据链回传', status: 'pending', detail: '调用裁判模型 / Python 算法适配器提取结构化得分...' },
      { id: '4', title: '聚合指标与生成评测快照', status: 'pending', detail: '计算 case 级别通过率并落盘...' },
    ])

    setTimeout(() => {
      setRunnerSteps((prev) => [
        { ...prev[0], status: 'done', detail: '已成功绑定全部所需输入字段，格式校验通过。' },
        { ...prev[1], status: 'running', detail: '初始化模型裁判客户端与执行沙箱...' },
        prev[2],
        prev[3],
      ])
    }, 800)

    setTimeout(() => {
      setRunnerSteps((prev) => [
        prev[0],
        { ...prev[1], status: 'done', detail: '执行协议连接就绪，并发数: 3，超时: 60s。' },
        { ...prev[2], status: 'running', detail: '正在批量执行评测单元...' },
        prev[3],
      ])
    }, 1800)

    setTimeout(() => {
      setRunnerSteps((prev) => [
        prev[0],
        prev[1],
        { ...prev[2], status: 'done', detail: '所有样本打分执行完成，生成结构化裁判证据链。' },
        { ...prev[3], status: 'done', detail: '评测任务已成功收敛归档，可查看看板与核对。' },
      ])
    }, 3200)
  }

  const create = () => {
    const id = `exp_0${32 + exps.length - initialExps.length}`
    const outputs = draft.scorerIds.flatMap((sid) => scorers.find((s) => s.id === sid)!.outputs)
    const weights = Object.fromEntries(outputs.map((o) => [o, Number((1 / outputs.length).toFixed(2))]))
    const finalName = uniqueName(draft.name, exps.map((e) => e.name))
    setExps((e) => [{ id, name: finalName, snapshotId: draft.snapshotId, scorerIds: draft.scorerIds, weights, createdBy: '我', createdAt: '刚刚', fieldDictVersion }, ...e])
    const cfg = agent ? caps.currentOf(agent.id) : undefined
    if (agent && cfg) {
      const snap = Object.freeze({ expId: id, agentId: agent.id, agentCode: agent.code, configVersion: cfg.version, backgroundVersion: `v${agent.backgroundVersion ?? 0}`, frozenAt: '刚刚', items: toFrozen(resolveConfig(cfg, caps.assets)) })
      setCreatedSnaps((m) => ({ ...m, [id]: snap }))
    }
    setSel(id)
    setCreating(false)
    setDraft((d) => ({ ...d, name: '' }))
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[320px_1fr]">
      {/* 左侧实验列表 */}
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
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{e.name}</span>
                      <Tag className="ml-auto shrink-0">{n} run</Tag>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Snowflake className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{snapshotLabel(e.snapshotId)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{e.createdAt}</span>
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
          <div className="flex max-w-3xl flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="实验名称，例如：黄金集 · 提示词优化"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              />
              {nameTaken ? (
                <div className="flex items-center gap-1.5 text-xs text-warn">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  已存在同名实验，将创建为 <Mono className="font-semibold">{nextName}</Mono>
                </div>
              ) : null}
            </div>
            <fieldset>
              <legend className="mb-1.5 text-xs text-muted-foreground">快照</legend>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <Th className="w-10"><span className="sr-only">选择</span></Th>
                      <Th>快照 ID</Th>
                      <Th>数据集</Th>
                      <Th className="text-right">case 数</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {snapshots.map((s) => {
                      const on = draft.snapshotId === s.id
                      return (
                        <tr key={s.id} className={cn('cursor-pointer', on ? 'bg-accent/60' : 'hover:bg-muted/40')} onClick={() => setDraft({ ...draft, snapshotId: s.id })}>
                          <Td>
                            <input
                              type="radio"
                              name="snapshot"
                              aria-label={`选择 ${s.id}`}
                              checked={on}
                              onChange={() => setDraft({ ...draft, snapshotId: s.id })}
                              className="accent-primary"
                            />
                          </Td>
                          <Td><Mono className="whitespace-nowrap font-semibold">{s.id}</Mono></Td>
                          <Td>{datasets.find((d) => d.id === s.datasetId)?.name ?? <span className="text-muted-foreground">已删除</span>}</Td>
                          <Td className="text-right"><Mono>{s.cases}</Mono></Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs text-muted-foreground">评分器</legend>
              <div className="flex flex-col gap-1.5">
                {scorers.map((s) => {
                  const ok = s.status === 'published'
                  const on = draft.scorerIds.includes(s.id)
                  return (
                    <label key={s.id} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', ok ? 'cursor-pointer hover:bg-muted bg-card' : 'cursor-not-allowed opacity-50')}>
                      <input
                        type="checkbox"
                        disabled={!ok}
                        checked={on}
                        onChange={() => setDraft({ ...draft, scorerIds: on ? draft.scorerIds.filter((x) => x !== s.id) : [...draft.scorerIds, s.id] })}
                        className="accent-primary rounded"
                      />
                      <span className="font-semibold text-xs">{s.name}</span>
                      <span className="ml-auto flex flex-wrap gap-1">
                        {s.outputs.map((o) => (
                          <Tag key={o} tone="primary">{dimensions.find((d) => d.key === o)?.name ?? o}</Tag>
                        ))}
                      </span>
                      {!ok ? <Tag>draft</Tag> : null}
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex items-center justify-end border-t pt-4">
              <Btn variant="primary" disabled={!draft.scorerIds.length} onClick={create}>创建</Btn>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                {exp.name}
                <Tag tone="primary" className="gap-1">
                  <Snowflake className="size-3" aria-hidden="true" />
                  {snapshotLabel(exp.snapshotId)}
                </Tag>
              </span>
            }
            actions={
              <Btn variant="primary" size="sm" onClick={execute}>
                <Play className="size-3.5" aria-hidden="true" />执行
              </Btn>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Tag><Mono>{exp.fieldDictVersion}</Mono></Tag>
              {exp.fieldDictVersion !== fieldDictVersion ? <Tag tone="warn">非最新</Tag> : null}
              <Tag>{exp.createdBy} · {exp.createdAt}</Tag>
              <span className="flex items-center text-muted-foreground" title="创建后不可修改">
                <Lock className="size-3.5" aria-hidden="true" />
                <span className="sr-only">创建后不可修改</span>
              </span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {exp.scorerIds.map((id) => {
                const s = scorers.find((x) => x.id === id)!
                return (
                  <div key={id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 bg-card">
                    <span className="text-sm font-medium">{s.name}</span>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {s.outputs.map((o) => (
                        <div key={o} className="flex items-center gap-1.5">
                          <Tag tone="primary">{dimensions.find((d) => d.key === o)?.name ?? o}</Tag>
                          <Mono className="text-[11px] text-muted-foreground">×{exp.weights[o] ?? 0}</Mono>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><Boxes className="size-4 text-muted-foreground" aria-hidden="true" />能力配置快照</span>}>
            <FrozenSnapshotCard snap={createdSnaps[exp.id] ?? snapshotForExp(exp.id)} />
          </Panel>

          {/* 实时调度抽屉日志 */}
          {activeRunId && runnerSteps.length > 0 && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Activity className="size-4 text-primary animate-pulse" />
                  Runner 评测引擎调度执行中 · <Mono>{activeRunId}</Mono>
                </span>
              }
              actions={
                <button
                  type="button"
                  onClick={() => setActiveRunId(null)}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  收起日志
                </button>
              }
            >
              <div className="space-y-3 font-mono text-xs">
                {runnerSteps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2.5">
                    {step.status === 'done' ? (
                      <CheckCircle2 className="size-4 text-pass shrink-0 mt-0.5" />
                    ) : step.status === 'running' ? (
                      <Activity className="size-4 text-primary shrink-0 animate-spin mt-0.5" />
                    ) : (
                      <span className="size-4 rounded-full border border-muted-foreground/30 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className={cn('font-semibold', step.status === 'running' ? 'text-primary' : step.status === 'done' ? 'text-foreground' : 'text-muted-foreground')}>
                        {step.title}
                      </div>
                      {step.detail && <div className="text-[11px] text-muted-foreground mt-0.5">{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="EvalRun 评测执行记录" bodyClassName="p-0">
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
                          <Mono className="shrink-0 text-muted-foreground text-xs">{r.doneUnits}/{r.units}</Mono>
                        </div>
                      </Td>
                      <Td><Mono className={r.errors ? 'text-warn' : 'text-muted-foreground'}>{r.errors}</Mono></Td>
                      <Td><Mono>{r.cost}</Mono></Td>
                      <Td><Mono className="text-muted-foreground">{r.startedAt}</Mono></Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          {r.status === 'completed' || r.status === 'partial' ? (
                            <>
                              <Link href={`/dashboard?run=${r.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                <BarChart3 className="size-3.5" aria-hidden="true" />数据看板
                              </Link>
                              <Link href={`/review?run=${r.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                                核对看板
                              </Link>
                            </>
                          ) : null}
                        </div>
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
