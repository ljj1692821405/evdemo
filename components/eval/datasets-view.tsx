'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cases, datasets } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td } from './primitives'

export function DatasetsView() {
  const [dsId, setDsId] = useState(datasets[0].id)
  const [caseId, setCaseId] = useState(cases[0].id)
  const ds = datasets.find((d) => d.id === dsId)!
  const list = cases.filter((c) => c.datasetId === dsId)
  const current = list.find((c) => c.id === caseId) ?? list[0]
  const invalid = list.filter((c) => !c.valid).length

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[240px_1fr_320px]">
      <Panel title="数据集" bodyClassName="p-1">
        <ul>
          {datasets.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => { setDsId(d.id); setCaseId(cases.find((c) => c.datasetId === d.id)?.id ?? '') }}
                aria-current={d.id === dsId ? 'true' : undefined}
                className={cn('w-full rounded-md px-3 py-2 text-left', d.id === dsId ? 'bg-accent' : 'hover:bg-muted')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  <Mono className="text-muted-foreground">{d.version}</Mono>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Mono className="text-muted-foreground">{d.caseCount} case</Mono>
                  {d.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={<span className="flex items-center gap-2">{ds.name}<Mono className="text-muted-foreground">{ds.id}</Mono></span>}
        actions={
          list.length ? (
            <div className="flex items-center gap-1.5">
              <Tag tone="pass">{list.length - invalid} 合规</Tag>
              {invalid ? <Tag tone="fail">{invalid} 拒收</Tag> : null}
            </div>
          ) : null
        }
        bodyClassName="p-0"
      >
        {list.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">该数据集 case 未在原型中展开</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr><Th className="w-8" /><Th>case</Th><Th>query</Th><Th>轮数</Th><Th>工作区</Th><Th>GT</Th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setCaseId(c.id)}
                  className={cn('cursor-pointer', c.id === current?.id ? 'bg-accent/50' : 'hover:bg-muted/40')}
                >
                  <Td>{c.valid ? <CheckCircle2 className="size-4 text-pass" aria-label="合规" /> : <XCircle className="size-4 text-fail" aria-label="拒收" />}</Td>
                  <Td><Mono>{c.id}</Mono></Td>
                  <Td className="max-w-xs"><span className="line-clamp-1">{c.query[0] || <span className="text-fail">（空）</span>}</span></Td>
                  <Td><Mono>{c.query.length}</Mono></Td>
                  <Td><Mono className="text-muted-foreground">{c.workspaceSize}</Mono></Td>
                  <Td>
                    <Tag tone={c.gtSource === 'case' ? 'pass' : c.gtSource === 'dataset' ? 'primary' : 'warn'}>
                      {c.gtSource === 'case' ? 'case' : c.gtSource === 'dataset' ? '数据集兜底' : '缺 GT'}
                    </Tag>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {current ? (
        <div className="flex flex-col gap-4">
          <Panel title={<Mono className="text-sm">{current.id}</Mono>}>
            <ol className="flex flex-col gap-2">
              {current.query.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <Mono className="mt-0.5 text-muted-foreground">q{i}</Mono>
                  <span className={cn('text-pretty', !q && 'text-fail')}>{q || '（空字符串）'}</span>
                </li>
              ))}
            </ol>
            <div className={cn('mt-4 rounded-md p-3 text-xs', current.valid ? 'bg-pass-soft text-pass' : 'bg-fail-soft text-fail')}>
              {current.valid ? '结构校验通过' : <>拒收 · <Mono>{current.invalidReason}</Mono></>}
            </div>
          </Panel>
          <Panel title="GT 兜底链">
            <ol className="flex flex-col gap-1.5">
              {[
                { id: 'case', label: 'case.gt', hit: current.gtSource === 'case' },
                { id: 'dataset', label: 'dataset.default_gt', hit: current.gtSource === 'dataset', disabled: !ds.defaultGt },
                { id: 'missing', label: '缺 GT → na', hit: current.gtSource === 'missing' },
              ].map((s, i, arr) => {
                const passed = arr.findIndex((x) => x.hit) > i
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <div
                      className={cn(
                        'flex flex-1 items-center justify-between rounded-md border px-3 py-2 font-mono text-xs',
                        s.hit && (s.id === 'missing' ? 'border-warn bg-warn-soft text-warn' : 'border-pass bg-pass-soft text-pass'),
                        passed && 'text-muted-foreground line-through',
                      )}
                    >
                      {s.label}
                      {s.hit ? <span className="font-sans font-medium">命中</span> : null}
                    </div>
                    {i < arr.length - 1 ? <ArrowRight className="size-3 rotate-90 text-muted-foreground" aria-hidden="true" /> : null}
                  </li>
                )
              })}
            </ol>
            {current.gtKeys.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {current.gtKeys.map((k) => <Tag key={k}>{k}</Tag>)}
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
