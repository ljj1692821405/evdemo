import Link from 'next/link'
import { Lock, AlertTriangle, GitCompareArrows, Coins, Clock } from 'lucide-react'
import { PageHeader, Panel, Tag, Ratio, Th, Td, Mono, VerdictBadge, Progress } from '@/components/eval/primitives'
import { dimensions, experiments, runStats } from '@/lib/mock-data'
import { runContext, viewableRuns } from '@/lib/runs'
import { AgentDataGate } from '@/components/eval/agent-data-gate'
import { judgeDimension, pct } from '@/lib/stats'
import { snapshotForExp } from '@/lib/capability-data'
import { FrozenSnapshotCard } from '@/components/eval/capability-snapshot'

export const metadata = { title: '数据看板 · 评测平台' }

export default function DashboardPage(props: { searchParams: Promise<{ run?: string }> }) {
  return (
    <AgentDataGate index={7} title="数据看板">
      <DashboardContent {...props} />
    </AgentDataGate>
  )
}

async function DashboardContent({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams
  const ctx = runContext(runId)
  if (!ctx) {
    return (
      <div>
        <PageHeader index={7} title="数据看板" />
        <DashboardOverview />
      </div>
    )
  }
  const { stats: s, run, exp } = ctx
  const capSnap = snapshotForExp(exp.id)
  const valid = s.pass + s.fail
  const reviewHref = `/review?run=${run.id}`

  return (
    <div>
      <PageHeader
        index={7}
        title="数据看板"
        back="/dashboard"
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{s.runId}</Mono>
            <span aria-hidden="true">·</span>
            <Link href={`/experiments?id=${exp.id}`} className="hover:text-foreground hover:underline">{exp.name}</Link>
            <span aria-hidden="true">·</span>
            <Mono>{exp.snapshotId}</Mono>
            <span aria-hidden="true">·</span>
            <Mono>{exp.fieldDictVersion}</Mono>
            {capSnap ? (
              <>
                <span aria-hidden="true">·</span>
                <Mono>{capSnap.agentCode}@{capSnap.configVersion}</Mono>
              </>
            ) : null}
          </span>
        }
        actions={
          <Tag tone="neutral" className="gap-1.5 py-1">
            <Lock className="size-3" aria-hidden="true" />
            已冻结 · {run.startedAt}
          </Tag>
        }
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Strip 1: conclusion */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <BigNumber label="总通过率（case 级）" value={pct(s.caseRate[0] / s.caseRate[1])} sub={`${s.caseRate[0]} / ${s.caseRate[1]} case`} />
          <BigNumber
            label="裁判-人工一致率"
            value={pct(s.agreement.n ? s.agreement.agree / s.agreement.n : null)}
            sub={`n = ${s.agreement.n}`}
            href={reviewHref}
          />
          <BigNumber
            label="有效样本"
            value={String(valid)}
            sub={
              <span className="flex items-center gap-2">
                <span className="text-pass">pass {s.pass}</span>
                <span className="text-fail">fail {s.fail}</span>
                <span className="text-na">na {s.na}</span>
                <span className="text-warn">error {s.error}</span>
              </span>
            }
          />
        </div>

        <Panel title="能力配置快照">
          <FrozenSnapshotCard snap={capSnap} />
        </Panel>

        {/* Strip 2: dimension table */}
        <Panel title="维度" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <Th>维度</Th>
                  <Th>通过率 case</Th>
                  <Th>turn</Th>
                  <Th>样本</Th>
                  <Th>na</Th>
                  <Th>其中缺 GT</Th>
                  <Th>error</Th>
                  <Th>人工一致</Th>
                  <Th className="text-right">判定</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {s.dims.map((d) => {
                  const dim = dimensions.find((x) => x.key === d.key)!
                  const j = judgeDimension(d, dim)
                  return (
                    <tr key={d.key} className="hover:bg-muted/30">
                      <Td>
                        <div className="flex items-center gap-2">
                          <Mono className="text-muted-foreground">{d.key}</Mono>
                          <span className="font-medium">{dim.name}</span>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex w-36 flex-col gap-1">
                          <Ratio n={d.caseRate[0]} d={d.caseRate[1]} />
                          <Progress value={d.caseRate[0] / d.caseRate[1]} tone={d.caseRate[0] / d.caseRate[1] >= dim.thresholds.release ? 'pass' : 'warn'} />
                        </div>
                      </Td>
                      <Td className="text-muted-foreground"><Ratio n={d.turnRate[0]} d={d.turnRate[1]} className="text-xs" /></Td>
                      <Td><Mono>{d.participated}/{d.total}</Mono></Td>
                      <Td>
                        <Mono>{d.na}</Mono>
                        <span className="ml-1 text-[11px] text-muted-foreground">{pct(d.na / d.total, 0)}</span>
                      </Td>
                      <Td>{d.naMissingGt > 0 ? <Tag tone="warn">{d.naMissingGt}</Tag> : <Mono className="text-muted-foreground">0</Mono>}</Td>
                      <Td><Mono className={d.error ? 'text-warn' : 'text-muted-foreground'}>{d.error}</Mono></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className={d.agreement.stale ? 'text-muted-foreground line-through' : 'font-medium'}>
                            {pct(d.agreement.n ? d.agreement.agree / d.agreement.n : null)}
                          </span>
                          <Mono className="text-[11px] text-muted-foreground">n={d.agreement.n}</Mono>
                          {d.agreement.stale ? (
                            <Tag tone="warn" className="gap-1"><Clock className="size-3" aria-hidden="true" />已过期</Tag>
                          ) : null}
                        </div>
                      </Td>
                      <Td className="text-right">
                        <Tag tone={j.tone} className="px-2 py-1 text-xs">{j.label}</Tag>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Strip 3: anomalies */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-fail" aria-hidden="true" />失败 Top5</span>} bodyClassName="p-0">
            <ul className="divide-y text-sm">
              {s.failTop.map((f) => (
                <li key={f.caseId + f.dim} className="flex items-start gap-3 px-4 py-2.5">
                  <Mono className="mt-0.5 shrink-0 text-muted-foreground">{f.dim}</Mono>
                  <div className="min-w-0">
                    <Link href={reviewHref} className="font-mono text-xs text-primary hover:underline">{f.caseId}</Link>
                    <p className="text-pretty text-[13px] leading-snug">{f.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><GitCompareArrows className="size-4 text-warn" aria-hidden="true" />分歧 Top5</span>} bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr><Th>case / turn</Th><Th>维度</Th><Th>裁判</Th><Th>人工</Th></tr>
              </thead>
              <tbody className="divide-y">
                {s.disagreeTop.map((d) => (
                  <tr key={d.caseId + d.turn + d.dim}>
                    <Td><Link href={reviewHref} className="font-mono text-xs text-primary hover:underline">{d.caseId}#{d.turn}</Link></Td>
                    <Td><Mono>{d.dim}</Mono></Td>
                    <Td><VerdictBadge verdict={d.judge} /></Td>
                    <Td><VerdictBadge verdict={d.human} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><Coins className="size-4 text-muted-foreground" aria-hidden="true" />成本</span>}>
            <dl className="grid grid-cols-3 gap-3">
              {[
                ['token', s.cost.tokens],
                ['调用次数', String(s.cost.calls)],
                ['估算费用', s.cost.fee],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md bg-muted/50 p-3">
                  <dt className="text-[11px] text-muted-foreground">{k}</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 font-mono text-[11px] text-muted-foreground">单元 {run.units}</p>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function DashboardOverview() {
  const rows = viewableRuns.flatMap((run) => {
    const s = runStats[run.id]
    const exp = experiments.find((e) => e.id === run.experimentId)
    return s && exp ? [{ run, exp, s }] : []
  })
  const casePass = rows.reduce((n, r) => n + r.s.caseRate[0], 0)
  const caseTotal = rows.reduce((n, r) => n + r.s.caseRate[1], 0)
  const checkPass = rows.reduce((n, r) => n + r.s.pass, 0)
  const checkTotal = rows.reduce((n, r) => n + r.s.pass + r.s.fail, 0)
  const dimRows = rows.flatMap(({ run, s }) => s.dims.map((d) => ({ run, d, fails: s.failTop.filter((f) => f.dim === d.key) })))

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BigNumber label="总通过率（case 级）" value={pct(caseTotal ? casePass / caseTotal : null)} sub={`${casePass} / ${caseTotal} case`} />
        <BigNumber label="检查点通过率（轮次 × 维度）" value={pct(checkTotal ? checkPass / checkTotal : null)} sub={`${checkPass} / ${checkTotal}`} />
        <BigNumber label="覆盖维度" value={String(dimRows.length)} sub={`${rows.length} 个 run`} />
      </div>

      <Panel title="维度" bodyClassName="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <Th>维度</Th>
              <Th>通过率 case</Th>
              <Th>turn</Th>
              <Th>na</Th>
              <Th>结论</Th>
              <Th className="w-16"><span className="sr-only">查看</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dimRows.map(({ run, d, fails }) => {
              const dim = dimensions.find((x) => x.key === d.key)
              return (
                <tr key={`${run.id}:${d.key}`} className="hover:bg-muted/30">
                  <Td>
                    <div className="flex items-center gap-2">
                      <Mono className="text-muted-foreground">{d.key}</Mono>
                      <span className="font-medium">{dim?.name ?? d.key}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex w-36 flex-col gap-1">
                      <Ratio n={d.caseRate[0]} d={d.caseRate[1]} />
                      <Progress value={d.caseRate[1] ? d.caseRate[0] / d.caseRate[1] : 0} tone={d.caseRate[0] === d.caseRate[1] ? 'pass' : 'fail'} />
                    </div>
                  </Td>
                  <Td><Ratio n={d.turnRate[0]} d={d.turnRate[1]} /></Td>
                  <Td><Mono className={d.na ? '' : 'text-muted-foreground'}>{d.na}</Mono></Td>
                  <Td className="max-w-md">
                    {fails.length ? (
                      <span className="line-clamp-2 text-pretty text-fail">{fails[0].reason}</span>
                    ) : (
                      <Tag tone="pass">通过</Tag>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link href={`/dashboard?run=${run.id}`} className="whitespace-nowrap text-sm text-primary hover:underline">明细</Link>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

function BigNumber({ label, value, sub, href }: { label: string; value: string; sub: React.ReactNode; href?: string }) {
  const body = (
    <div className="flex h-full flex-col justify-between rounded-lg border bg-card p-5 transition-colors">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-4xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
  return href ? <Link href={href} className="block hover:[&>div]:border-primary/40">{body}</Link> : body
}
