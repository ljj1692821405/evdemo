'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Check,
  Code2,
  Database,
  FileText,
  Gavel,
  Loader2,
  Play,
  Plus,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveEntry, useFieldDict } from '@/lib/field-dict-store'
import { useAgentShared } from '@/lib/tenant-store'
import { demoData, shortTime, turnFieldValues } from '@/lib/demo-data'
import { fieldDict } from '@/lib/mock-data'
import { Panel, Tag, Mono } from './primitives'

type FieldNode = { name: string; tokens: number; sample: string }

const sourceSamples: FieldNode[] = []

type Version = { v: string; status: 'draft' | 'published' }

type Script = {
  id: string
  name: string
  versions: Version[]
  inputs: string[]
  outputs: FieldNode[]
  code: string
  consumers: string[]
}

type CacheEntry = { key: string; status: 'cached' | 'computing' | 'error'; at: string; by: string; tok: number }

const demoTurnValues = demoData.cases.flatMap((c) => c.turns.map((t) => ({ c, t, values: turnFieldValues(c, t) })))

const outputNode = (name: string): FieldNode => {
  const sample = demoTurnValues.find((x) => x.values[name])?.values[name] ?? ''
  return {
    name,
    tokens: fieldDict.find((f) => f.logicalName === name)?.avgTokens ?? 0,
    sample: sample.length > 600 ? `${sample.slice(0, 600)}…` : sample,
  }
}

const scriptDefs = [
  { id: 'workspace_diff', inputs: ['workspace_before', 'workspace_after'], outputs: ['diff_stats', 'metadata_diff_text', 'scoped_modified_diff'], consumers: ['sc_targeted@v1', 'sc_quality@v1', 'sc_context@v1'] },
  { id: 'section_radar', inputs: ['workspace_before', 'workspace_after'], outputs: ['skeleton_radar_summary'], consumers: ['sc_targeted@v1', 'sc_context@v1'] },
  { id: 'temporal_tracker', inputs: ['workspace_after', 'ground_truth'], outputs: ['temporal_audit_summary'], consumers: ['sc_context@v1'] },
  { id: 'interaction_flow', inputs: ['interactive_cards', 'write_confirm', 'file_actions'], outputs: ['interaction_flow'], consumers: ['sc_intent@v1'] },
]

const initialScripts: Script[] = scriptDefs.map((d) => ({
  id: d.id,
  name: d.id,
  versions: [{ v: 'v1', status: 'published' }],
  inputs: d.inputs,
  outputs: d.outputs.map(outputNode),
  code: demoData.scripts[d.id] ?? '',
  consumers: d.consumers,
}))

const cacheByScript: Record<string, CacheEntry[]> = Object.fromEntries(
  scriptDefs.map((d) => [
    d.id,
    demoTurnValues
      .filter((x) => d.outputs.some((o) => x.values[o]))
      .map((x) => ({
        key: `${x.c.caseId}#${x.t.turn}`,
        status: 'cached' as const,
        at: shortTime(x.c.runTime),
        by: d.consumers[0],
        tok: Math.round(d.outputs.reduce((n, o) => n + (x.values[o]?.length ?? 0), 0) * 1.4),
      })),
  ]),
)

type RunState = 'idle' | 'running' | 'done'
type Selection = { kind: 'script' } | { kind: 'store' } | { kind: 'field'; name: string }

const seedScripts = (isDemo: boolean): Script[] => (isDemo ? initialScripts : [])

export function usePreprocessScripts() {
  return useAgentShared<Script[]>('preprocess-scripts', seedScripts)
}

export function PreprocessPipeline() {
  const [scripts, setScripts] = usePreprocessScripts()
  if (scripts.length > 0) return <ScriptPipeline />
  return (
    <Panel title="预处理脚本">
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
        暂无脚本
        <button
          type="button"
          onClick={() =>
            setScripts([
              { id: 'script_1', name: 'script_1', versions: [{ v: 'v1', status: 'draft' }], inputs: [], outputs: [], code: 'def extract() -> dict:\n    return {}', consumers: [] },
            ])
          }
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3.5" aria-hidden="true" />新建脚本
        </button>
      </div>
    </Panel>
  )
}

function ScriptPipeline() {
  const dict = useFieldDict()
  const sourceFields: FieldNode[] = dict.entries
    .filter((e) => e.source !== 'derived')
    .map((e) => ({
      name: e.logicalName,
      tokens: e.avgTokens,
      sample: sourceSamples.find((s) => s.name === e.logicalName)?.sample ?? resolveEntry(e) ?? 'null',
    }))
  const [scripts, setScripts] = usePreprocessScripts()
  const [activeId, setActiveId] = useState(initialScripts[0].id)
  const [version, setVersion] = useState(initialScripts[0].versions[0].v)
  const [selection, setSelection] = useState<Selection>({ kind: 'script' })
  const [run, setRun] = useState<RunState>('idle')
  const [creating, setCreating] = useState(false)

  const script = scripts.find((s) => s.id === activeId) ?? scripts[0]
  const inputs = script.inputs.map((n) => sourceFields.find((f) => f.name === n)).filter(Boolean) as FieldNode[]
  const missingInputs = script.inputs.filter((n) => !sourceFields.some((f) => f.name === n))
  const inTok = inputs.reduce((s, n) => s + n.tokens, 0)
  const outTok = script.outputs.reduce((s, n) => s + n.tokens, 0)
  const ratio = inTok > 0 && outTok > 0 ? Math.round((1 - outTok / inTok) * 100) : null
  const isDraft = script.versions.find((x) => x.v === version)?.status === 'draft'
  const cache = cacheByScript[script.id] ?? []
  const field =
    selection.kind === 'field'
      ? [...inputs, ...script.outputs].find((n) => n.name === selection.name)
      : undefined

  const selectScript = (id: string) => {
    const next = scripts.find((s) => s.id === id)
    if (!next) return
    setActiveId(id)
    setVersion(next.versions[0].v)
    setSelection({ kind: 'script' })
    setRun('idle')
  }

  const createScript = (draft: Script) => {
    setScripts((prev) => [...prev, draft])
    for (const o of draft.outputs) {
      dict.add({
        logicalName: o.name,
        paths: [`derived.${draft.name}.${o.name}`],
        avgTokens: o.tokens,
        description: `${draft.name} 输出`,
        source: 'derived',
        script: draft.name,
      })
    }
    setCreating(false)
    setActiveId(draft.id)
    setVersion(draft.versions[0].v)
    setSelection({ kind: 'script' })
    setRun('idle')
  }

  const startRun = () => {
    setRun('running')
    setTimeout(() => setRun('done'), 900)
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Code2 className="size-4 text-primary" aria-hidden="true" />前置脚本</span>}
      actions={
        <div className="flex items-center gap-2">
          <select
            aria-label="脚本版本"
            value={version}
            onChange={(e) => { setVersion(e.target.value); setRun('idle') }}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs"
          >
            {script.versions.map((x) => (
              <option key={x.v} value={x.v}>{script.name}@{x.v} · {x.status}</option>
            ))}
          </select>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted">
            <Upload className="size-3.5" aria-hidden="true" />上传
          </button>
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <span className="text-xs text-muted-foreground">共 {scripts.length} 个脚本</span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2.5 text-xs hover:border-primary hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden="true" />新增
        </button>
      </div>
      <ul aria-label="前置脚本列表" className="divide-y border-b">
        {scripts.map((s) => {
          const active = s.id === script.id
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => selectScript(s.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                  active ? 'bg-primary/5 font-medium text-primary' : 'hover:bg-muted',
                )}
              >
                <span className="font-mono">{s.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{s.versions[0].v}</span>
                  <span>{s.inputs.length} 入 · {s.outputs.length} 出</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {creating ? (
        <NewScriptForm
          existing={scripts.map((s) => s.id)}
          takenFields={dict.names}
          sourceFields={sourceFields}
          onCancel={() => setCreating(false)}
          onCreate={createScript}
        />
      ) : null}

      <div className="flex flex-col gap-4 overflow-x-auto p-4 lg:flex-row lg:items-center">
        <div className="flex flex-col gap-2">
          {inputs.map((n) => (
            <FieldButton
              key={n.name}
              node={n}
              active={selection.kind === 'field' && selection.name === n.name}
              onClick={() => setSelection({ kind: 'field', name: n.name })}
            />
          ))}
          {missingInputs.map((n) => (
            <span key={n} className="inline-flex items-center gap-1.5 rounded-md border border-fail bg-fail-soft px-2.5 py-1.5 text-fail">
              <X className="size-3.5" aria-hidden="true" />
              <Mono className="text-xs line-through">{n}</Mono>
              <Tag tone="fail">字典缺失</Tag>
            </span>
          ))}
        </div>
        <Flow />
        <button
          type="button"
          onClick={() => setSelection({ kind: 'script' })}
          aria-pressed={selection.kind === 'script'}
          className={cn(
            'flex min-w-56 flex-col gap-2 rounded-lg border-2 bg-card p-3 text-left transition-colors',
            selection.kind === 'script' ? 'border-primary' : 'border-dashed hover:border-primary/50',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <Mono className="font-semibold">{script.name}</Mono>
            <Tag tone={isDraft ? 'neutral' : 'pass'}>{version}</Tag>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Tag tone="primary"><Zap className="size-3" aria-hidden="true" />评分器调用时</Tag>
            <Tag className="font-mono">python 3.11</Tag>
            <Tag className="font-mono">10s</Tag>
          </span>
        </button>
        <Flow />
        <div className="flex flex-col gap-2">
          {script.outputs.map((n) => (
            <FieldButton
              key={n.name}
              node={n}
              derived
              active={selection.kind === 'field' && selection.name === n.name}
              onClick={() => setSelection({ kind: 'field', name: n.name })}
            />
          ))}
        </div>
        <Flow />
        <button
          type="button"
          onClick={() => setSelection({ kind: 'store' })}
          aria-pressed={selection.kind === 'store'}
          className={cn(
            'flex min-w-52 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors',
            selection.kind === 'store' ? 'border-primary bg-accent/60' : 'hover:bg-muted/50',
          )}
        >
          <span className="flex items-center gap-2">
            <Database className="size-4 text-primary" aria-hidden="true" />
            <Mono className="text-xs font-semibold">derived_store</Mono>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <Tag tone="pass" className="font-mono">{cache.filter((c) => c.status === 'cached').length} cached</Tag>
            <Tag className="font-mono">{cache.length}</Tag>
          </span>
        </button>
        <Flow />
        <div className="flex flex-col gap-1.5">
          {script.consumers.length > 0 ? (
            script.consumers.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                <Gavel className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <Mono className="text-xs">{c}</Mono>
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-muted-foreground">
              <Gavel className="size-3.5" aria-hidden="true" />
              <Mono className="text-xs">—</Mono>
            </span>
          )}
        </div>
        {ratio !== null ? (
          <div className="flex min-w-32 flex-col items-start gap-1 rounded-lg bg-muted/50 p-3 lg:ml-auto">
            <span className="font-mono text-xs text-muted-foreground">
              {inTok.toLocaleString()} → {outTok.toLocaleString()} tok
            </span>
            <span className="font-mono text-2xl font-semibold text-pass">-{ratio}%</span>
          </div>
        ) : null}
      </div>

      <div className="border-t">
        {selection.kind === 'script' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
            <pre className="overflow-auto bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">{script.code}</pre>
            <div className="flex flex-col gap-3 border-t p-4 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between">
                <Mono className="text-xs">{cache[0]?.key ?? "—"}</Mono>
                <button
                  type="button"
                  onClick={startRun}
                  disabled={run === 'running' || script.outputs.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {run === 'running' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                  试跑
                </button>
              </div>
              {run === 'done' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <Tag tone="pass"><Check className="size-3" aria-hidden="true" />exit 0</Tag>
                    <Tag className="font-mono">0.21s</Tag>
                    <Tag tone="pass" className="font-mono">{outTok} tok</Tag>
                  </div>
                  {script.outputs.map((o) => (
                    <div key={o.name} className="rounded-md border">
                      <div className="border-b bg-muted/40 px-2.5 py-1.5"><Mono className="text-xs">{o.name}</Mono></div>
                      <pre className="whitespace-pre-wrap p-2.5 font-mono text-[11px] leading-relaxed">{o.sample}</pre>
                    </div>
                  ))}
                  {isDraft ? (
                    <button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-primary px-3 text-xs text-primary hover:bg-accent">
                      发布 {version}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center py-8 text-muted-foreground">
                  <Play className="size-6 opacity-30" aria-hidden="true" />
                </div>
              )}
            </div>
          </div>
        ) : selection.kind === 'store' ? (
          <StoreView script={script} version={version} cache={cache} />
        ) : field ? (
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Mono className="font-semibold">{field.name}</Mono>
              <Tag tone={field.tokens > 2000 ? 'warn' : 'pass'} className="font-mono">~{field.tokens.toLocaleString()} tok</Tag>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[12px] leading-relaxed">{field.sample}</pre>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

function StoreView({ script, version, cache }: { script: Script; version: string; cache: CacheEntry[] }) {
  const tone = { cached: 'pass', computing: 'primary', error: 'fail' } as const
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <Mono className="text-xs">
          derived/{'{snapshot}'}/{script.name}@{version}/{'{case}#{turn}'}.json
        </Mono>
        <Tag className="ml-auto font-mono">snap_0105</Tag>
      </div>
      {cache.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Database className="size-6 opacity-30" aria-hidden="true" />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">case / turn</th>
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">首次调用</th>
              <th className="px-4 py-2 font-medium">计算于</th>
              <th className="px-4 py-2 text-right font-medium">tok</th>
            </tr>
          </thead>
          <tbody>
            {cache.map((c) => (
              <tr key={c.key} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-2"><Mono className="text-xs text-primary">{c.key}</Mono></td>
                <td className="px-4 py-2">
                  <Tag tone={tone[c.status]} className="font-mono">
                    {c.status === 'computing' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                    {c.status}
                  </Tag>
                </td>
                <td className="px-4 py-2"><Mono className="text-xs">{c.by}</Mono></td>
                <td className="px-4 py-2"><Mono className="text-xs text-muted-foreground">{c.at}</Mono></td>
                <td className="px-4 py-2 text-right"><Mono className="text-xs">{c.tok || '—'}</Mono></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function NewScriptForm({
  existing,
  takenFields,
  sourceFields,
  onCancel,
  onCreate,
}: {
  existing: string[]
  takenFields: string[]
  sourceFields: FieldNode[]
  onCancel: () => void
  onCreate: (s: Script) => void
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [output, setOutput] = useState('')

  const id = name.trim()
  const valid =
    /^[a-z][a-z0-9_]*$/.test(id) &&
    !existing.includes(id) &&
    picked.length > 0 &&
    /^[a-z][a-z0-9_]*$/.test(output.trim()) &&
    !takenFields.includes(output.trim())

  const toggle = (f: string) =>
    setPicked((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))

  const submit = () => {
    if (!valid) return
    const out = output.trim()
    onCreate({
      id,
      name: id,
      versions: [{ v: 'v1', status: 'draft' }],
      inputs: picked,
      outputs: [{ name: out, tokens: 0, sample: '' }],
      code: `def extract(${picked.map((p) => `${p}`).join(', ')}) -> dict:\n    return {"${out}": ...}`,
      consumers: [],
    })
  }

  return (
    <div className="flex flex-col gap-3 border-b bg-accent/30 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">新增前置脚本</span>
        <button type="button" onClick={onCancel} aria-label="关闭" className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_220px_auto] md:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="table_diff_extract"
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-muted-foreground">输入字段</legend>
          <div className="flex flex-wrap gap-1.5">
            {sourceFields.map((f) => {
              const on = picked.includes(f.name)
              return (
                <button
                  key={f.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(f.name)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-md border px-2 font-mono text-xs transition-colors',
                    on ? 'border-primary bg-accent text-primary' : 'bg-card hover:bg-muted',
                  )}
                >
                  {on ? <Check className="size-3" aria-hidden="true" /> : <Plus className="size-3" aria-hidden="true" />}
                  {f.name}
                </button>
              )
            })}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">输出字段</span>
          <input
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="table_diff"
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Check className="size-3.5" aria-hidden="true" />创建
        </button>
      </div>
    </div>
  )
}

function FieldButton({
  node,
  active,
  onClick,
  derived,
}: {
  node: FieldNode
  active: boolean
  onClick: () => void
  derived?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-w-52 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        active ? 'border-primary bg-accent/60' : 'hover:bg-muted/50',
        derived && 'border-pass/40 bg-pass-soft/40',
      )}
    >
      <span className="flex items-center gap-2">
        <FileText className={cn('size-3.5', derived ? 'text-pass' : 'text-muted-foreground')} aria-hidden="true" />
        <Mono className="text-xs">{node.name}</Mono>
      </span>
      <Mono className={cn('text-xs', node.tokens > 2000 ? 'text-warn' : 'text-muted-foreground')}>
        {node.tokens ? node.tokens.toLocaleString() : '—'}
      </Mono>
    </button>
  )
}

function Flow() {
  return <ArrowRight className="size-4 shrink-0 rotate-90 self-center text-muted-foreground lg:rotate-0" aria-hidden="true" />
}
