'use client'

import { useMemo, useState } from 'react'
import { AlertOctagon, CornerDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fieldDict, sampleSimTraj } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td } from './primitives'

// TODO(R-1): FieldDict paths must live in the L-sim namespace; rejected at load time.
const isRaw = (p: string) => p.startsWith('raw.')

function resolve(path: string): unknown {
  if (isRaw(path)) return undefined
  const parts = path.replace('[]', '.0').split('.')
  let cur: unknown = sampleSimTraj
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

export function FieldDictView() {
  const [selected, setSelected] = useState(fieldDict[1].logicalName)
  const entry = fieldDict.find((f) => f.logicalName === selected)!

  const trace = useMemo(() => {
    let hit = -1
    const steps = entry.paths.map((p, i) => {
      const raw = isRaw(p)
      const value = raw ? undefined : resolve(p)
      if (hit === -1 && !raw && !isEmpty(value)) hit = i
      return { path: p, raw, value }
    })
    return { steps, hit }
  }, [entry])

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[1fr_380px]">
      <Panel bodyClassName="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><Th>逻辑名</Th><Th>物理路径（按序取第一非空）</Th><Th className="text-right">体积估算</Th></tr>
          </thead>
          <tbody className="divide-y">
            {fieldDict.map((f) => {
              const bad = f.paths.some(isRaw)
              return (
                <tr
                  key={f.logicalName}
                  onClick={() => setSelected(f.logicalName)}
                  className={cn('cursor-pointer align-top', f.logicalName === selected ? 'bg-accent/50' : 'hover:bg-muted/40')}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <Mono className="font-semibold">{f.logicalName}</Mono>
                      {bad ? <AlertOctagon className="size-3.5 text-fail" aria-label="含非法路径" /> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{f.description}</div>
                  </Td>
                  <Td>
                    <ol className="flex flex-col gap-1">
                      {f.paths.map((p, i) => (
                        <li key={p} className="flex items-center gap-1.5">
                          <Mono className="w-3 text-muted-foreground">{i + 1}</Mono>
                          <Mono className={cn(isRaw(p) && 'rounded bg-fail-soft px-1 text-fail line-through')}>{p}</Mono>
                        </li>
                      ))}
                    </ol>
                  </Td>
                  <Td className="text-right">
                    <Tag tone={f.avgTokens > 2000 ? 'warn' : 'neutral'} className="font-mono">~{f.avgTokens.toLocaleString()} tok</Tag>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title={<span className="flex items-center gap-2">解析 <Mono>{entry.logicalName}</Mono></span>} actions={<Tag>样例 sim_traj</Tag>}>
          <ol className="flex flex-col gap-2">
            {trace.steps.map((s, i) => {
              const hit = i === trace.hit
              const skipped = trace.hit !== -1 && i > trace.hit
              return (
                <li
                  key={s.path}
                  className={cn(
                    'rounded-md border p-2.5',
                    hit && 'border-pass bg-pass-soft',
                    s.raw && 'border-fail bg-fail-soft',
                    skipped && 'opacity-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Mono className={cn(s.raw && 'text-fail')}>{s.path}</Mono>
                    {s.raw ? <Tag tone="fail">加载拒绝</Tag> : hit ? <Tag tone="pass">命中</Tag> : skipped ? <Tag>未访问</Tag> : <Tag tone="na">空</Tag>}
                  </div>
                  {!s.raw && !skipped ? (
                    <div className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                      <CornerDownRight className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      <Mono className="break-all">{JSON.stringify(s.value ?? null)}</Mono>
                    </div>
                  ) : null}
                  {s.raw ? <p className="mt-1.5 text-xs text-fail">L-raw 永不进评分</p> : null}
                </li>
              )
            })}
          </ol>
          <div className="mt-3 rounded-md bg-muted/50 p-2.5 text-xs">
            结果：{trace.hit === -1 ? <Mono className="text-na">null</Mono> : <Mono className="text-pass">paths[{trace.hit}]</Mono>}
          </div>
        </Panel>
        <Panel title="样例 sim_traj" bodyClassName="p-0">
          <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(sampleSimTraj, null, 2)}</pre>
        </Panel>
      </div>
    </div>
  )
}
