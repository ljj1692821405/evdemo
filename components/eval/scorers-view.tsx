'use client'

import { useRef, useState } from 'react'
import { Lock, Upload, GitBranch, Check, ShieldCheck, Plus, X, Braces, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dimensions as initialDims, scorers as initialScorers, type Scorer, type Dimension } from '@/lib/mock-data'
import { useFieldDict, useScorers } from '@/lib/field-dict-store'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import { PromptEditor, defaultPrompt, defaultBackground, referencedVars, judgeModels } from './prompt-editor'
import { TrialLab } from './trial-lab'

type Trial = 'idle' | 'running' | 'passed'

const implLabel = { llm_judge: 'LLM 裁判', script: '脚本', hybrid: '混合' }

const emptyDim = { key: '', name: '', gtKey: '', release: '0.85' }

export function ScorersView() {
  const [dims, setDims] = useState(initialDims)
  const [list, setList] = useScorers()
  const dict = useFieldDict()
  const [sel, setSel] = useState(initialScorers[3].id)
  const [trial, setTrial] = useState<Record<string, Trial>>({})
  const s = list.find((x) => x.id === sel)!
  const locked = s.status === 'published'
  const t = trial[s.id] ?? 'idle'
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyDim)
  const editorRef = useRef<{ insert: (field: string) => void }>(null)
  const usesPrompt = s.implType !== 'script'
  const template = s.promptTemplate ?? defaultPrompt(s.inputFields)
  const background = s.background ?? defaultBackground
  const refs = usesPrompt ? referencedVars(template) : []
  const keyTaken = dims.some((d) => d.key === draft.key.trim())
  const canAdd = draft.key.trim() && draft.name.trim() && !keyTaken

  const addDim = () => {
    if (!canAdd) return
    const dim: Dimension = {
      key: draft.key.trim(),
      name: draft.name.trim(),
      gtKey: draft.gtKey.trim() || draft.key.trim(),
      scoreType: 'binary',
      thresholds: { release: Number(draft.release) || 0.85, agreement: 0.85, minSamples: 10 },
      enabled: true,
    }
    setDims((ds) => [...ds, dim])
    setDraft(emptyDim)
    setAdding(false)
  }

  const update = (patch: Partial<Scorer>) => setList((l) => l.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))
  const tokens = s.inputFields.reduce((sum, f) => sum + (dict.find(f)?.avgTokens ?? 0), 0)
  const missingFields = s.inputFields.filter((f) => !dict.names.includes(f))

  const [lab, setLab] = useState(false)

  if (lab) {
    return (
      <TrialLab
        scorer={s}
        template={template}
        background={background}
        onClose={() => setLab(false)}
        onChange={update}
        onPublish={() => update({ status: 'published' })}
        onPassed={() => setTrial((m) => ({ ...m, [s.id]: 'passed' }))}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[380px_1fr]">
      <Panel
        title="维度注册表"
        actions={
          <Btn size="sm" variant={adding ? 'ghost' : 'outline'} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            {adding ? <X className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
            {adding ? '取消' : '新建'}
          </Btn>
        }
        bodyClassName="p-0"
      >
        {adding ? (
          <form
            onSubmit={(e) => { e.preventDefault(); addDim() }}
            className="grid grid-cols-2 gap-2 border-b bg-accent/30 p-3"
          >
            <MiniInput label="key" value={draft.key} placeholder="5.4" invalid={keyTaken} onChange={(v) => setDraft({ ...draft, key: v })} autoFocus />
            <MiniInput label="名称" value={draft.name} placeholder="回复质量" onChange={(v) => setDraft({ ...draft, name: v })} />
            <MiniInput label="gt key" value={draft.gtKey} placeholder="reply" onChange={(v) => setDraft({ ...draft, gtKey: v })} />
            <MiniInput label="通过阈值" value={draft.release} type="number" onChange={(v) => setDraft({ ...draft, release: v })} />
            <div className="col-span-2 flex justify-end">
              <Btn type="submit" size="sm" variant="primary" disabled={!canAdd}>
                <Check className="size-3.5" aria-hidden="true" />创建
              </Btn>
            </div>
          </form>
        ) : null}
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><Th>key</Th><Th>名称</Th><Th>阈值</Th><Th className="text-right">启用</Th></tr>
          </thead>
          <tbody className="divide-y">
            {dims.map((d) => (
              <tr key={d.key} className={cn(!d.enabled && 'text-muted-foreground')}>
                <Td><Mono>{d.key}</Mono></Td>
                <Td>
                  <div className="font-medium">{d.name}</div>
                </Td>
                <Td>
                  <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
                    <span>通过 ≥ {d.thresholds.release}</span>
                    <span>一致 ≥ {d.thresholds.agreement} · n ≥ {d.thresholds.minSamples}</span>
                  </div>
                </Td>
                <Td className="text-right">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={d.enabled}
                    aria-label={`启用 ${d.name}`}
                    onClick={() => setDims((ds) => ds.map((x) => (x.key === d.key ? { ...x, enabled: !x.enabled } : x)))}
                    className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', d.enabled ? 'bg-primary' : 'bg-input')}
                  >
                    <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', d.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSel(x.id)}
              aria-current={x.id === sel ? 'true' : undefined}
              className={cn('min-w-44 shrink-0 rounded-lg border bg-card p-3 text-left transition-colors', x.id === sel ? 'border-primary ring-2 ring-primary/15' : 'hover:border-input')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{x.name}</span>
                {x.status === 'published' ? <Lock className="size-3.5 text-muted-foreground" aria-label="已发布" /> : null}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Tag tone={x.status === 'published' ? 'pass' : 'neutral'}>{x.status}</Tag>
                <Mono className="text-muted-foreground">v{x.version}</Mono>
              </div>
            </button>
          ))}
        </div>

        <Panel
          title={
            <span className="flex items-center gap-2">
              {s.name}
              <Mono className="text-muted-foreground">{s.id}@v{s.version}</Mono>
            </span>
          }
          actions={
            <Stepper status={s.status} trial={t} />
          }
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Field label="输出维度">
                <div className="flex flex-wrap gap-1.5">
                  {s.outputs.map((o) => {
                    const d = dims.find((x) => x.key === o)!
                    return <Tag key={o} tone="primary"><Mono>{o}</Mono> {d.name}</Tag>
                  })}
                </div>
              </Field>
              <Field label="实现">
                <div className="flex gap-1">
                  {(Object.keys(implLabel) as Scorer['implType'][]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={locked}
                      onClick={() => update({ implType: k })}
                      className={cn('rounded-md border px-2.5 py-1 text-xs', s.implType === k ? 'border-primary bg-accent text-accent-foreground' : 'bg-card hover:bg-muted', locked && 'cursor-not-allowed opacity-60')}
                    >
                      {implLabel[k]}
                    </button>
                  ))}
                </div>
              </Field>
              {usesPrompt ? (
                <Field label="提示词 / 模型">
                  <PromptEditor
                    insertRef={editorRef}
                    template={template}
                    background={background}
                    model={s.judgeModel ?? judgeModels[0]}
                    promptVersion={s.promptVersion ?? `pt_${s.id.replace('sc_', '')}@v1`}
                    inputFields={s.inputFields}
                    allFields={dict.names}
                    locked={locked}
                    onChange={update}
                    onAddField={(f) => update({ inputFields: [...s.inputFields, f] })}
                  />
                </Field>
              ) : null}
              {s.implType !== 'llm_judge' ? (
                <Field label="脚本">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag><Mono>{s.scriptId ?? 'scorers.new:score'}</Mono></Tag>
                    <Mono className="text-muted-foreground">#{s.scriptHash ?? '—'}</Mono>
                  </div>
                </Field>
              ) : null}
              {s.evidenceScript ? (
                <Field label="preprocess">
                  <Tag><Mono>{s.evidenceScript}</Mono></Tag>
                </Field>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <Field label={<span className="flex items-center justify-between">输入字段 <span className={cn('font-mono', tokens > 5000 ? 'text-warn' : 'text-muted-foreground')}>≈ {tokens.toLocaleString()} tok / 单元</span></span>}>
                <ul className="flex flex-col gap-1">
                  {missingFields.map((f) => (
                    <li key={f} className="flex items-center gap-2 rounded-md border border-fail bg-fail-soft px-2.5 py-1.5">
                      <Mono className="text-fail line-through">{f}</Mono>
                      <Tag tone="fail">字典缺失</Tag>
                      {!locked ? (
                        <button
                          type="button"
                          onClick={() => update({ inputFields: s.inputFields.filter((x) => x !== f) })}
                          aria-label={`移除 ${f}`}
                          className="ml-auto flex size-6 items-center justify-center rounded text-fail hover:bg-card"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                  {dict.entries.map((f) => {
                    const on = s.inputFields.includes(f.logicalName)
                    const linked = refs.includes(f.logicalName)
                    return (
                      <li key={f.logicalName} className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={locked}
                          aria-pressed={on}
                          onClick={() => update({ inputFields: on ? s.inputFields.filter((x) => x !== f.logicalName) : [...s.inputFields, f.logicalName] })}
                          className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left', on ? 'border-primary/40 bg-accent/50' : 'border-transparent hover:bg-muted', locked && 'cursor-not-allowed')}
                        >
                          {on ? <X className="size-3 text-muted-foreground" aria-hidden="true" /> : <Plus className="size-3 text-muted-foreground" aria-hidden="true" />}
                          <Mono className={cn(!on && 'text-muted-foreground')}>{f.logicalName}</Mono>
                          {on && usesPrompt ? (
                            linked ? (
                              <Tag tone="primary" className="px-1"><Braces className="size-3" aria-hidden="true" /><span className="sr-only">已引用</span></Tag>
                            ) : (
                              <span className="size-1.5 shrink-0 rounded-full bg-warn" role="img" aria-label="未引用" />
                            )
                          ) : null}
                          <div className="ml-auto flex items-center gap-2">
                            <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                              <div className={cn('h-full', f.avgTokens > 2000 ? 'bg-warn' : 'bg-primary/60')} style={{ width: `${Math.min(100, (f.avgTokens / 8100) * 100)}%` }} />
                            </div>
                            <Mono className={cn('w-14 text-right text-[11px]', f.avgTokens > 2000 ? 'text-warn' : 'text-muted-foreground')}>{f.avgTokens.toLocaleString()}</Mono>
                          </div>
                        </button>
                        {usesPrompt && on && !locked ? (
                          <button
                            type="button"
                            onClick={() => editorRef.current?.insert(f.logicalName)}
                            aria-label={`插入 ${f.logicalName}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary"
                          >
                            <Braces className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </Field>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-4">
            {locked ? (
              <>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />published · 只读</span>
                <Btn
                  className="ml-auto"
                  onClick={() => { update({ status: 'draft', version: s.version + 1 }); setTrial((m) => ({ ...m, [s.id]: 'idle' })) }}
                >
                  <GitBranch className="size-4" aria-hidden="true" />升版 v{s.version + 1}
                </Btn>
              </>
            ) : (
              <>
                {t === 'passed' ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Tag tone="pass" className="gap-1"><ShieldCheck className="size-3" aria-hidden="true" />AST 门禁</Tag>
                    <Tag tone="pass">import ✓</Tag>
                    <Tag tone="pass">output_schema ✓</Tag>
                  </div>
                ) : null}
                <div className="ml-auto flex gap-2">
                  <Btn onClick={() => setLab(true)}>
                    <FlaskConical className="size-4" aria-hidden="true" />
                    试跑
                  </Btn>
                  <Btn variant="primary" disabled={t !== 'passed'} onClick={() => update({ status: 'published' })}>
                    <Upload className="size-4" aria-hidden="true" />发布
                  </Btn>
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function Stepper({ status, trial }: { status: Scorer['status']; trial: Trial }) {
  const steps = [
    { label: 'draft', done: true },
    { label: '试跑', done: status === 'published' || trial === 'passed' },
    { label: 'published', done: status === 'published' },
  ]
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {steps.map((st, i) => (
        <li key={st.label} className="flex items-center gap-1">
          {i > 0 ? <span className={cn('h-px w-4', st.done ? 'bg-pass' : 'bg-border')} aria-hidden="true" /> : null}
          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 font-mono', st.done ? 'bg-pass-soft text-pass' : 'bg-muted text-muted-foreground')}>
            {st.done ? <Check className="size-3" aria-hidden="true" /> : null}
            {st.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

function MiniInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  invalid,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  invalid?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        step={type === 'number' ? '0.01' : undefined}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn('h-8 rounded-md border bg-card px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/30', invalid && 'border-fail text-fail')}
      />
    </label>
  )
}
