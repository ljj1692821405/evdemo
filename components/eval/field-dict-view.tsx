'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertOctagon, Check, CornerDownRight, Gavel, Code2, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sampleSimTraj, type FieldContext, type FieldEntry } from '@/lib/mock-data'
import { isDerivedPath, isRawPath, isValidFieldName, resolvePath, useFieldDict, useScorers } from '@/lib/field-dict-store'
import { useScope } from '@/lib/tenant-store'
import { useAgentTools } from '@/lib/capability-store'
import { Panel, Tag, Mono, Th, Td } from './primitives'
import { usePreprocessScripts } from './preprocess-pipeline'

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

type ContextKind = 'none' | 'enum' | 'tools' | 'note'

const contextKinds: { id: ContextKind; label: string }[] = [
  { id: 'none', label: '无' },
  { id: 'enum', label: '枚举字典' },
  { id: 'tools', label: '关联工具' },
  { id: 'note', label: '独立口径' },
]

export function FieldDictVersionTag() {
  const { version } = useFieldDict()
  return <Tag tone="primary"><Mono>{version}</Mono></Tag>
}

export function FieldDictView() {
  const dict = useFieldDict()
  const [scorers] = useScorers()
  const [scripts] = usePreprocessScripts()
  const { agent } = useScope()
  const { tools, configVersion } = useAgentTools(agent?.id)
  const [selected, setSelected] = useState('action_sequence')
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const entry = dict.find(selected) ?? dict.entries[0]
  const entryKind: ContextKind = entry?.context?.kind ?? 'none'

  // 每个字段的附带上下文完全独立设置与保存
  const setContextKind = (f: FieldEntry, kind: ContextKind) => {
    let context: FieldContext | undefined
    if (kind === 'tools') {
      context = {
        kind: 'tools',
        selectedTools: f.context?.kind === 'tools' && f.context.selectedTools ? f.context.selectedTools : tools.map((t) => t.name),
      }
    } else if (kind === 'enum') {
      context = {
        kind: 'enum',
        values: f.context?.kind === 'enum' ? f.context.values : [],
      }
    } else if (kind === 'note') {
      context = {
        kind: 'note',
        text: f.context?.kind === 'note' ? f.context.text : '',
      }
    }
    dict.update(f.logicalName, { context })
  }

  const refsOf = (name: string) => [
    ...scorers.filter((s) => s.inputFields.includes(name)).map((s) => ({ kind: 'scorer' as const, id: `${s.id}@${s.version}` })),
    ...scripts.filter((s) => s.inputs.includes(name)).map((s) => ({ kind: 'script' as const, id: s.name })),
  ]
  const entryRefs = entry ? refsOf(entry.logicalName) : []

  const trace = useMemo(() => {
    if (!entry) return { steps: [], hit: -1 }
    let hit = -1
    const steps = entry.paths.map((p, i) => {
      const raw = isRawPath(p)
      const value = raw ? undefined : resolvePath(p)
      if (hit === -1 && !raw && !isEmpty(value)) hit = i
      return { path: p, raw, value }
    })
    return { steps, hit }
  }, [entry])

  const remove = (name: string) => {
    dict.remove(name)
    setConfirming(null)
    if (selected === name) setSelected(dict.entries.find((e) => e.logicalName !== name)?.logicalName ?? '')
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel
        title={<span className="flex items-center gap-2">字段 <Tag className="font-mono">{dict.entries.length}</Tag></span>}
        actions={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" aria-hidden="true" />新增字段
          </button>
        }
        className="min-w-0 lg:self-start"
        bodyClassName="overflow-x-auto p-0"
      >
        {adding ? (
          <NewFieldForm
            existing={dict.names}
            onCancel={() => setAdding(false)}
            onCreate={(e) => {
              dict.add(e)
              setAdding(false)
              setSelected(e.logicalName)
            }}
          />
        ) : null}
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><Th>字段</Th><Th>附带上下文</Th><Th>引用</Th><Th className="text-right">体积</Th><Th className="w-10"><span className="sr-only">操作</span></Th></tr>
          </thead>
          <tbody className="divide-y">
            {dict.entries.map((f) => {
              const bad = f.paths.some(isRawPath)
              const refs = refsOf(f.logicalName)
              const isConfirming = confirming === f.logicalName
              const active = f.logicalName === entry?.logicalName
              return (
                <tr
                  key={f.logicalName}
                  onClick={() => setSelected(f.logicalName)}
                  aria-selected={active}
                  className={cn(
                    'group cursor-pointer',
                    isConfirming ? 'bg-fail-soft' : active ? 'bg-accent/60 shadow-[inset_2px_0_0_var(--color-primary)]' : 'hover:bg-muted/40',
                  )}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <Mono className="font-semibold">{f.logicalName}</Mono>
                      {f.source === 'derived' ? <Tag tone="pass" className="text-[10px]">评测派生</Tag> : null}
                      {bad ? <AlertOctagon className="size-3.5 text-fail" aria-label="含非法路径" /> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{f.description}</div>
                  </Td>
                  <Td>
                    {f.context?.kind === 'tools' ? (
                      <Tag tone="primary" className="text-[10px]"><Wrench className="size-3" aria-hidden="true" />工具 {f.context.selectedTools?.length ?? tools.length} 个</Tag>
                    ) : f.context?.kind === 'enum' ? (
                      <Tag tone="primary" className="text-[10px]">枚举字典 <span className="font-mono">{f.context.values.length}</span> 项</Tag>
                    ) : f.context?.kind === 'note' ? (
                      <Tag tone="primary" className="text-[10px]">独立口径</Tag>
                    ) : (
                      <Mono className="text-muted-foreground">—</Mono>
                    )}
                  </Td>
                  <Td>{refs.length ? <Tag tone={isConfirming ? 'fail' : 'neutral'} className="font-mono">{refs.length}</Tag> : <Mono className="text-muted-foreground">—</Mono>}</Td>
                  <Td className="text-right">
                    <Mono className={cn('whitespace-nowrap text-[11px]', f.avgTokens > 2000 ? 'text-warn' : 'text-muted-foreground')}>~{f.avgTokens.toLocaleString()} tok</Mono>
                  </Td>
                  <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {isConfirming ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => remove(f.logicalName)}
                          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-fail px-2 text-xs text-primary-foreground hover:bg-fail/90"
                        >
                          <Trash2 className="size-3" aria-hidden="true" />删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          aria-label="取消"
                          className="flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-muted"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(f.logicalName)}
                        aria-label={`删除 ${f.logicalName}`}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-fail-soft hover:text-fail focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      {entry ? (
        <aside
          key={entry.logicalName}
          aria-label={`${entry.logicalName} 详情`}
          className="flex flex-col rounded-lg border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Mono className="text-sm font-semibold">{entry.logicalName}</Mono>
            {entry.source === 'derived' ? <Tag tone="pass" className="text-[10px]">评测派生</Tag> : null}
            <Mono className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">~{entry.avgTokens.toLocaleString()} tok</Mono>
          </div>

          <div className="flex flex-col gap-4 p-4">
            {/* 仅对评测派生字段展示专属的精炼说明 */}
            {entry.source === 'derived' && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-pass/30 bg-pass-soft/10 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-pass text-[11px]">评测派生字段 (特征提纯)</span>
                  <Tag tone="pass" className="text-[9px]">专供裁判</Tag>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  该字段由评测开发预处理脚本计算派生，对超长仿真基准（如前后工作区快照）做针对性精炼，体量仅 ~{entry.avgTokens} tok，推荐优先用于大模型裁判打分。
                </p>
                {entry.script && (
                  <div className="text-[10px] text-muted-foreground pt-1 border-t">
                    处理算子/脚本: <Mono className="text-foreground">{entry.script}</Mono>
                  </div>
                )}
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">说明</span>
              <input
                defaultValue={entry.description}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next && next !== entry.description) dict.update(entry.logicalName, { description: next })
                }}
                className="h-8 rounded-md border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium">附带上下文</span>
              <div role="radiogroup" aria-label="附带上下文" className="grid grid-cols-4 gap-0.5 rounded-md border bg-muted/40 p-0.5">
                {contextKinds.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="radio"
                    aria-checked={entryKind === k.id}
                    onClick={() => setContextKind(entry, k.id)}
                    className={cn(
                      'h-7 rounded text-[11px] font-medium transition-colors',
                      entryKind === k.id ? 'bg-card text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              {entry.context?.kind === 'tools' ? (
                <ToolsContextEditor
                  key={entry.logicalName}
                  allTools={tools}
                  selectedTools={entry.context.selectedTools}
                  onSave={(selectedTools) => dict.update(entry.logicalName, { context: { kind: 'tools', selectedTools } })}
                />
              ) : null}
              {entry.context?.kind === 'enum' ? (
                <EnumEditor
                  key={entry.logicalName}
                  values={entry.context.values}
                  onSave={(values) => dict.update(entry.logicalName, { context: { kind: 'enum', values } })}
                />
              ) : null}
              {entry.context?.kind === 'note' ? (
                <NoteContextEditor
                  key={entry.logicalName}
                  text={entry.context.text}
                  onSave={(text) => dict.update(entry.logicalName, { context: { kind: 'note', text } })}
                />
              ) : null}
            </div>

            {entryRefs.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">引用</span>
                <div className="flex flex-wrap gap-1">
                  {entryRefs.map((r) => (
                    <Tag key={r.id} className="font-mono">
                      {r.kind === 'scorer' ? <Gavel className="size-3" aria-hidden="true" /> : <Code2 className="size-3" aria-hidden="true" />}
                      {r.id}
                    </Tag>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">物理路径</span>
              <ol className="flex flex-col gap-1.5">
                {trace.steps.map((s, i) => {
                  const hit = i === trace.hit
                  const skipped = trace.hit !== -1 && i > trace.hit
                  return (
                    <li
                      key={s.path}
                      className={cn('rounded-md border p-2', hit && 'border-pass bg-pass-soft', s.raw && 'border-fail bg-fail-soft', skipped && 'opacity-50')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Mono className={cn('min-w-0 break-all text-[11px]', s.raw && 'text-fail line-through', isDerivedPath(s.path) && 'text-primary')}>{s.path}</Mono>
                        {s.raw ? <Tag tone="fail">拒绝</Tag> : hit ? <Tag tone="pass">命中</Tag> : skipped ? <Tag>未访问</Tag> : <Tag tone="na">空</Tag>}
                      </div>
                      {hit ? (
                        <div className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                          <CornerDownRight className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                          <Mono className="line-clamp-3 break-all text-[11px]">{JSON.stringify(s.value ?? null)}</Mono>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            </div>

            <details className="rounded-md border">
              <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium">样例 sim_traj</summary>
              <pre className="max-h-64 overflow-auto border-t p-2.5 font-mono text-[11px] leading-relaxed">{JSON.stringify(sampleSimTraj, null, 2)}</pre>
            </details>
          </div>
        </aside>
      ) : null}
    </div>
  )
}

type EnumValue = { value: string; meaning: string }

function EnumEditor({ values, onSave }: { values: EnumValue[]; onSave: (values: EnumValue[]) => void }) {
  const [rows, setRows] = useState<EnumValue[]>(values)
  useEffect(() => {
    setRows(values)
  }, [values])
  const clean = rows.map((r) => ({ value: r.value.trim(), meaning: r.meaning.trim() })).filter((r) => r.value)
  const dirty = JSON.stringify(clean) !== JSON.stringify(values)
  const patch = (i: number, p: Partial<EnumValue>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs text-muted-foreground">当前字段独立枚举字典 (独立保存)</legend>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={r.value}
            onChange={(e) => patch(i, { value: e.target.value })}
            aria-label={`取值 ${i + 1}`}
            placeholder="completed"
            className="h-8 w-28 shrink-0 rounded-md border bg-card px-2 font-mono text-xs"
          />
          <input
            value={r.meaning}
            onChange={(e) => patch(i, { meaning: e.target.value })}
            aria-label={`含义 ${i + 1}`}
            placeholder="正常结束"
            className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs"
          />
          <button
            type="button"
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            aria-label={`移除取值 ${i + 1}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { value: '', meaning: '' }])}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="size-3" aria-hidden="true" />取值
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => { onSave(clean); setRows(clean) }}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
        >
          <Check className="size-3" aria-hidden="true" />保存枚举
        </button>
      </div>
    </fieldset>
  )
}

function ToolsContextEditor({
  allTools,
  selectedTools,
  onSave,
}: {
  allTools: { name: string; purpose: string }[]
  selectedTools?: string[]
  onSave: (tools: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(selectedTools ?? allTools.map((t) => t.name))
  const toggle = (name: string) => {
    const next = selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name]
    setSelected(next)
    onSave(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>当前字段独立关联工具 ({selected.length}/{allTools.length})</span>
        <button
          type="button"
          onClick={() => {
            const next = selected.length === allTools.length ? [] : allTools.map((t) => t.name)
            setSelected(next)
            onSave(next)
          }}
          className="text-primary hover:underline text-[11px]"
        >
          {selected.length === allTools.length ? '全部取消' : '一键全选'}
        </button>
      </div>
      <ul className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {allTools.map((t) => {
          const on = selected.includes(t.name)
          return (
            <li
              key={t.name}
              onClick={() => toggle(t.name)}
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors text-xs',
                on ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/30 bg-card',
              )}
            >
              <input type="checkbox" checked={on} readOnly className="mt-0.5 rounded accent-primary" />
              <div className="min-w-0 flex-1">
                <Mono className="font-semibold text-foreground text-xs">{t.name}</Mono>
                <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{t.purpose}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NoteContextEditor({ text, onSave }: { text?: string; onSave: (t: string) => void }) {
  const [val, setVal] = useState(text ?? '')
  const [dirty, setDirty] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] text-muted-foreground">为当前字段配置专属于它的独立业务说明与裁判打分口径：</span>
      <textarea
        rows={4}
        value={val}
        onChange={(e) => {
          setVal(e.target.value)
          setDirty(true)
        }}
        placeholder="例如：本字段在多轮交互中用于记录澄清卡的下发与选项选择情况，评测时需比对是否有遗漏选项..."
        className="w-full rounded-md border bg-card p-2 text-xs leading-relaxed font-mono"
      />
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            onSave(val.trim())
            setDirty(false)
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
        >
          <Check className="size-3" />
          保存独立口径
        </button>
      </div>
    </div>
  )
}

function NewFieldForm({ existing, onCancel, onCreate }: { existing: string[]; onCancel: () => void; onCreate: (e: FieldEntry) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [paths, setPaths] = useState<string[]>([''])
  const [tokens, setTokens] = useState('')

  const id = name.trim()
  const cleanPaths = paths.map((p) => p.trim()).filter(Boolean)
  const nameError = id && !isValidFieldName(id) ? '仅限小写字母、数字、下划线' : existing.includes(id) ? '逻辑名已存在' : null
  const rawPath = cleanPaths.find(isRawPath)
  const valid = id && !nameError && cleanPaths.length > 0 && !rawPath

  const preview = useMemo(() => {
    for (const p of cleanPaths) {
      if (isRawPath(p)) continue
      const v = resolvePath(p)
      if (!isEmpty(v)) return { path: p, value: v }
    }
    return null
  }, [cleanPaths])

  const submit = () => {
    if (!valid) return
    const est = Number(tokens)
    onCreate({
      logicalName: id,
      paths: cleanPaths,
      description: description.trim() || id,
      avgTokens: Number.isFinite(est) && est > 0 ? Math.round(est) : preview ? Math.max(1, Math.round(JSON.stringify(preview.value).length * 1.4)) : 0,
      source: cleanPaths.every(isDerivedPath) ? 'derived' : 'sim',
    })
  }

  return (
    <div className="flex flex-col gap-3 border-b bg-accent/30 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">新增字段</span>
        <button type="button" onClick={onCancel} aria-label="关闭" className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_120px]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">逻辑名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="doc_title"
            aria-invalid={Boolean(nameError)}
            className={cn('h-8 rounded-md border bg-card px-2 font-mono text-xs', nameError && 'border-fail')}
          />
          {nameError ? <span className="text-[11px] text-fail">{nameError}</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">说明</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="文档标题"
            className="h-8 rounded-md border bg-card px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">体积估算 tok</span>
          <input
            value={tokens}
            onChange={(e) => setTokens(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder={preview ? '自动' : '0'}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs"
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-muted-foreground">物理路径</legend>
        {paths.map((p, i) => {
          const raw = isRawPath(p.trim())
          return (
            <div key={i} className="flex items-center gap-1.5">
              <Mono className="w-3 text-muted-foreground">{i + 1}</Mono>
              <input
                value={p}
                onChange={(e) => setPaths((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="sim_traj.turns[].doc.title"
                aria-label={`路径 ${i + 1}`}
                aria-invalid={raw}
                className={cn('h-8 flex-1 rounded-md border bg-card px-2 font-mono text-xs', raw && 'border-fail text-fail')}
              />
              {paths.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPaths((ps) => ps.filter((_, j) => j !== i))}
                  aria-label={`移除路径 ${i + 1}`}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setPaths((ps) => [...ps, ''])}
          className="ml-4.5 inline-flex h-7 w-fit items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="size-3" aria-hidden="true" />备选路径
        </button>
        {rawPath ? <span className="text-[11px] text-fail">L-raw 路径加载时拒绝：{rawPath}</span> : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-xs">
          <CornerDownRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          {preview ? (
            <>
              <Tag tone="pass">命中</Tag>
              <Mono className="truncate">{JSON.stringify(preview.value)}</Mono>
            </>
          ) : (
            <Mono className="text-na">null</Mono>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Check className="size-3.5" aria-hidden="true" />添加
        </button>
      </div>
    </div>
  )
}
