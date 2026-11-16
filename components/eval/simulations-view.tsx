'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Play, Snowflake, ChevronDown, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { datasets, experiments, runs, simJobs as initialJobs, snapshots as initialSnaps, type SimJob, type SimJobStatus, type Snapshot } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td, Btn, Progress } from './primitives'

const statusTone: Record<SimJobStatus, 'neutral' | 'primary' | 'pass' | 'warn' | 'fail'> = {
  pending: 'neutral',
  running: 'primary',
  completed: 'pass',
  partial_failed: 'warn',
  failed: 'fail',
}

const scripts = ['simulate.master_sse:run', 'simulate.clarify_v2:run']

export function SimulationsView() {
  const [jobs, setJobs] = useState<SimJob[]>(initialJobs)
  const [snaps, setSnaps] = useState<Snapshot[]>(initialSnaps)
  const [dsId, setDsId] = useState(datasets[0].id)
  const [script, setScript] = useState(scripts[0])
  const [openJob, setOpenJob] = useState<string | null>('job_1102')
  const [openSnap, setOpenSnap] = useState<string | null>(null)

  const active = jobs.some((j) => j.status === 'running' || j.status === 'pending')

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setJobs((list) =>
        list.map((j) => {
          if (j.status === 'pending') return { ...j, status: 'running' }
          if (j.status !== 'running') return j
          const done = Math.min(j.total, j.done + 3)
          if (done < j.total) return { ...j, done }
          const rate = j.failed / j.total
          const status: SimJobStatus = rate >= 0.2 ? 'failed' : rate > 0 ? 'partial_failed' : 'completed'
          return { ...j, done, status, snapshotId: status === 'failed' ? undefined : `snap_${j.id.slice(4)}` }
        }),
      )
    }, 900)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    jobs.forEach((j) => {
      if (j.snapshotId && !snaps.some((s) => s.id === j.snapshotId)) {
        setSnaps((s) => [
          { id: j.snapshotId!, jobId: j.id, datasetId: j.datasetId, cases: j.total - j.failed, turns: Math.round((j.total - j.failed) * 1.8), frozenAt: '刚刚', status: j.failed ? 'partial_failed' : 'completed', missingCases: j.failed },
          ...s,
        ])
      }
    })
  }, [jobs, snaps])

  const start = () => {
    const ds = datasets.find((d) => d.id === dsId)!
    const id = `job_${1108 + jobs.length - initialJobs.length}`
    setJobs((j) => [{ id, datasetId: ds.id, script, status: 'pending', done: 0, total: ds.caseCount, failed: 0, startedAt: '刚刚', errors: [] }, ...j])
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            数据集
            <select value={dsId} onChange={(e) => setDsId(e.target.value)} className="h-8 min-w-48 rounded-md border border-input bg-card px-2 text-sm text-foreground">
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.caseCount} case</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            simulate 脚本
            <select value={script} onChange={(e) => setScript(e.target.value)} className="h-8 min-w-56 rounded-md border border-input bg-card px-2 font-mono text-xs text-foreground">
              {scripts.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span>并发 3</span><span>超时 180s</span><span>重试 1 次 / 5s</span><span>失败率阈值 20%</span>
          </div>
          <Btn variant="primary" className="ml-auto" onClick={start}>
            <Play className="size-4" aria-hidden="true" />开始仿真
          </Btn>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="SimulationJob" bodyClassName="p-0">
          <ul className="divide-y">
            {jobs.map((j) => {
              const ds = datasets.find((d) => d.id === j.datasetId)!
              const rate = j.total ? j.failed / j.total : 0
              const open = openJob === j.id
              return (
                <li key={j.id}>
                  <button type="button" onClick={() => setOpenJob(open ? null : j.id)} aria-expanded={open} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Mono className="font-semibold">{j.id}</Mono>
                      <Tag tone={statusTone[j.status]}>{j.status}</Tag>
                      <span className="truncate text-xs text-muted-foreground">{ds.name}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{j.startedAt}</span>
                      <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={j.done / j.total} tone={j.status === 'failed' ? 'fail' : j.status === 'partial_failed' ? 'warn' : j.status === 'completed' ? 'pass' : 'primary'} />
                      <Mono className="w-16 shrink-0 text-right">{j.done}/{j.total}</Mono>
                      <Mono className={cn('w-20 shrink-0 text-right', rate >= 0.2 ? 'text-fail' : rate > 0 ? 'text-warn' : 'text-muted-foreground')}>
                        失败 {(rate * 100).toFixed(1)}%
                      </Mono>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t bg-muted/20 px-4 py-3 text-xs">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground">
                        <Mono>{j.script}</Mono>
                        <span aria-hidden="true">→</span>
                        {j.snapshotId ? <Tag tone="primary" className="gap-1"><Snowflake className="size-3" aria-hidden="true" />{j.snapshotId}</Tag> : j.status === 'failed' ? <Tag tone="fail">不生成快照</Tag> : <Tag>待冻结</Tag>}
                      </div>
                      {j.errors.length ? (
                        <table className="w-full">
                          <thead><tr><Th className="px-0">case</Th><Th>error_type</Th><Th>详情</Th></tr></thead>
                          <tbody>
                            {j.errors.map((e) => (
                              <tr key={e.caseId} className="border-t">
                                <Td className="px-0"><Mono>{e.caseId}</Mono></Td>
                                <Td><Tag tone={e.type === 'invalid_schema' ? 'fail' : 'warn'} className="font-mono">{e.type}</Tag></Td>
                                <Td className="text-muted-foreground">{e.detail}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <p className="text-muted-foreground">无错误记录</p>}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title={<span className="flex items-center gap-2">Snapshot <Lock className="size-3.5 text-muted-foreground" aria-label="只读" /></span>} bodyClassName="p-0">
          <ul className="divide-y">
            {snaps.map((s) => {
              const ds = datasets.find((d) => d.id === s.datasetId)!
              const refs = experiments.filter((e) => e.snapshotId === s.id)
              const runCount = runs.filter((r) => refs.some((e) => e.id === r.experimentId)).length
              const open = openSnap === s.id
              return (
                <li key={s.id}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-40">
                      <div className="flex items-center gap-2">
                        <Snowflake className="size-3.5 text-primary" aria-hidden="true" />
                        <Mono className="font-semibold">{s.id}</Mono>
                        {s.status === 'partial_failed' ? <Tag tone="warn">缺 {s.missingCases} case</Tag> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{ds.name} · <Mono>{s.jobId}</Mono> · {s.frozenAt}</div>
                    </div>
                    <Mono className="text-muted-foreground">{s.cases} case · {s.turns} turn</Mono>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenSnap(open ? null : s.id)}
                        aria-expanded={open}
                        disabled={!refs.length}
                        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        明细 <span className="font-semibold">{refs.length}</span>
                        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                      </button>
                      <Tag className="py-1">执行 {runCount} 次</Tag>
                      <Link href={`/experiments?snapshot=${s.id}`} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">建实验</Link>
                    </div>
                  </div>
                  {open && refs.length ? (
                    <table className="w-full border-t bg-muted/20 text-xs">
                      <tbody className="divide-y">
                        {refs.map((e) => {
                          const last = runs.filter((r) => r.experimentId === e.id)[0]
                          return (
                            <tr key={e.id}>
                              <Td className="pl-10"><Link href={`/experiments?id=${e.id}`} className="text-primary hover:underline">{e.name}</Link></Td>
                              <Td className="text-muted-foreground">{e.createdBy}</Td>
                              <Td className="text-right font-mono text-muted-foreground">{last?.startedAt ?? '未执行'}</Td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
