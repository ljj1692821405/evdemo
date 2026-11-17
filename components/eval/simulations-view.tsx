'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { datasets, experiments, runs, simJobs as initialJobs, snapshots as initialSnaps, type SimJob, type SimJobStatus, type Snapshot } from '@/lib/mock-data'
import { Panel, Mono, Th, Td, Btn, Progress } from './primitives'

const statusLabel: Record<SimJobStatus, string> = {
  pending: '排队中',
  running: '运行中',
  completed: '已完成',
  partial_failed: '部分失败',
  failed: '失败',
}

const statusDot: Record<SimJobStatus, string> = {
  pending: 'bg-na',
  running: 'bg-primary',
  completed: 'bg-pass',
  partial_failed: 'bg-warn',
  failed: 'bg-fail',
}

const progressTone: Record<SimJobStatus, 'primary' | 'pass' | 'warn' | 'fail'> = {
  pending: 'primary',
  running: 'primary',
  completed: 'pass',
  partial_failed: 'warn',
  failed: 'fail',
}

const scripts = ['simulate.master_sse:run', 'simulate.clarify_v2:run']

const runParams = [
  { label: '并发', value: '3' },
  { label: '超时', value: '180s' },
  { label: '重试', value: '1 次' },
  { label: '失败率阈值', value: '20%' },
]

const selectCls = 'h-9 rounded-md border border-input bg-card px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'

export function SimulationsView() {
  const [jobs, setJobs] = useState<SimJob[]>(initialJobs)
  const [snaps, setSnaps] = useState<Snapshot[]>(initialSnaps)
  const [dsId, setDsId] = useState(datasets[0].id)
  const [script, setScript] = useState(scripts[0])
  const [openJob, setOpenJob] = useState<string | null>(null)
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
    <div className="flex flex-col gap-6 p-6">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
      >
        <label className="flex min-w-52 flex-col gap-1.5 text-sm font-medium">
          数据集
          <select value={dsId} onChange={(e) => setDsId(e.target.value)} className={cn(selectCls, 'font-normal')}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}（{d.caseCount} case）</option>)}
          </select>
        </label>
        <label className="flex min-w-60 flex-col gap-1.5 text-sm font-medium">
          仿真脚本
          <select value={script} onChange={(e) => setScript(e.target.value)} className={cn(selectCls, 'font-mono font-normal')}>
            {scripts.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <Btn variant="primary" type="submit" className="ml-auto h-9 px-4">
          <Play className="size-4" aria-hidden="true" />开始仿真
        </Btn>
      </form>

      <Panel title="仿真任务" bodyClassName="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <Th className="text-xs">任务</Th>
              <Th className="text-xs">数据集</Th>
              <Th className="text-xs">状态</Th>
              <Th className="text-xs">进度</Th>
              <Th className="text-right text-xs">失败率</Th>
              <Th className="text-xs">快照</Th>
              <Th className="text-xs">开始时间</Th>
              <Th className="w-10"><span className="sr-only">展开</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {jobs.map((j) => {
              const ds = datasets.find((d) => d.id === j.datasetId)!
              const rate = j.total ? j.failed / j.total : 0
              const open = openJob === j.id
              return (
                <Fragment key={j.id}>
                  <tr onClick={() => setOpenJob(open ? null : j.id)} className={cn('cursor-pointer', open ? 'bg-accent/40' : 'hover:bg-muted/40')}>
                    <Td><Mono className="text-sm font-semibold">{j.id}</Mono></Td>
                    <Td>{ds.name}</Td>
                    <Td>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className={cn('size-2 rounded-full', statusDot[j.status], j.status === 'running' && 'animate-pulse')} aria-hidden="true" />
                        {statusLabel[j.status]}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Progress value={j.done / j.total} tone={progressTone[j.status]} className="w-28" />
                        <Mono className="whitespace-nowrap text-sm">{j.done}/{j.total}</Mono>
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Mono className={cn('text-sm', rate >= 0.2 ? 'font-semibold text-fail' : rate > 0 ? 'text-warn' : 'text-muted-foreground')}>{(rate * 100).toFixed(1)}%</Mono>
                    </Td>
                    <Td>
                      {j.snapshotId ? <Mono className="text-sm">{j.snapshotId}</Mono> : <span className="text-muted-foreground">{j.status === 'failed' ? '未生成' : '—'}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{j.startedAt}</Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${j.id} 详情`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenJob(open ? null : j.id)
                        }}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                      </button>
                    </Td>
                  </tr>
                  {open ? (
                    <tr className="bg-muted/20">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                          <dl className="flex flex-col gap-2 text-sm">
                            <div className="flex flex-col gap-0.5">
                              <dt className="text-xs text-muted-foreground">脚本</dt>
                              <dd><Mono className="break-all text-sm">{j.script}</Mono></dd>
                            </div>
                            {runParams.map((p) => (
                              <div key={p.label} className="flex items-center justify-between gap-2">
                                <dt className="text-muted-foreground">{p.label}</dt>
                                <dd><Mono className="text-sm">{p.value}</Mono></dd>
                              </div>
                            ))}
                          </dl>
                          {j.errors.length ? (
                            <table className="w-full self-start rounded-md border bg-card text-sm">
                              <thead className="border-b">
                                <tr><Th className="text-xs">Case</Th><Th className="text-xs">错误类型</Th><Th className="text-xs">详情</Th></tr>
                              </thead>
                              <tbody className="divide-y">
                                {j.errors.map((e) => (
                                  <tr key={e.caseId}>
                                    <Td><Mono className="text-sm">{e.caseId}</Mono></Td>
                                    <Td><Mono className={cn('text-sm', e.type === 'invalid_schema' ? 'text-fail' : 'text-warn')}>{e.type}</Mono></Td>
                                    <Td>{e.detail}</Td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="self-center text-sm text-muted-foreground">无错误</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="快照" bodyClassName="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <Th className="text-xs">快照</Th>
              <Th className="text-xs">数据集</Th>
              <Th className="text-right text-xs">Case</Th>
              <Th className="text-right text-xs">Turn</Th>
              <Th className="text-xs">冻结时间</Th>
              <Th className="text-right text-xs">实验</Th>
              <Th className="text-right text-xs">执行</Th>
              <Th className="w-28"><span className="sr-only">操作</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {snaps.map((s) => {
              const ds = datasets.find((d) => d.id === s.datasetId)!
              const refs = experiments.filter((e) => e.snapshotId === s.id)
              const runCount = runs.filter((r) => refs.some((e) => e.id === r.experimentId)).length
              const open = openSnap === s.id
              return (
                <Fragment key={s.id}>
                  <tr className={cn(open && 'bg-accent/40')}>
                    <Td><Mono className="text-sm font-semibold">{s.id}</Mono></Td>
                    <Td>{ds.name}</Td>
                    <Td className="text-right">
                      <Mono className="text-sm">{s.cases}</Mono>
                      {s.missingCases ? <span className="ml-2 whitespace-nowrap text-warn">缺 <span className="font-mono">{s.missingCases}</span></span> : null}
                    </Td>
                    <Td className="text-right"><Mono className="text-sm">{s.turns}</Mono></Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{s.frozenAt}</Td>
                    <Td className="text-right">
                      {refs.length ? (
                        <button
                          type="button"
                          onClick={() => setOpenSnap(open ? null : s.id)}
                          aria-expanded={open}
                          aria-label={`${s.id} 的 ${refs.length} 个实验`}
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-mono text-sm text-primary hover:bg-accent"
                        >
                          {refs.length}
                          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                        </button>
                      ) : (
                        <Mono className="pr-2 text-sm text-muted-foreground">0</Mono>
                      )}
                    </Td>
                    <Td className="text-right"><Mono className="text-sm">{runCount}</Mono></Td>
                    <Td className="text-right">
                      <Link
                        href={`/experiments?snapshot=${s.id}`}
                        className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-muted"
                      >
                        建实验
                      </Link>
                    </Td>
                  </tr>
                  {open && refs.length ? (
                    <tr className="bg-muted/20">
                      <td colSpan={8} className="px-4 py-3">
                        <ul className="flex flex-col divide-y rounded-md border bg-card text-sm">
                          {refs.map((e) => {
                            const last = runs.filter((r) => r.experimentId === e.id)[0]
                            return (
                              <li key={e.id} className="flex items-center gap-4 px-3 py-2">
                                <Link href={`/experiments?id=${e.id}`} className="min-w-0 flex-1 truncate text-primary hover:underline">{e.name}</Link>
                                <span className="text-muted-foreground">{e.createdBy}</span>
                                <span className="w-28 whitespace-nowrap text-right text-muted-foreground">{last?.startedAt ?? '未执行'}</span>
                              </li>
                            )
                          })}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
