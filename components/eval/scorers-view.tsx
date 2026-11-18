'use client'

import { useRef, useState } from 'react'
import {
  Lock,
  Upload,
  GitBranch,
  Check,
  ShieldCheck,
  Plus,
  X,
  Braces,
  FlaskConical,
  Download,
  Cpu,
  Trash2,
  AlertCircle,
  Eye,
  FileText,
  Sparkles,
  Play,
  RotateCcw,
  Sliders,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { scorers as initialScorers, type Scorer, type Dimension } from '@/lib/mock-data'
import { goldenCases } from '@/lib/golden-seed'
import { useDimensions, useFieldDict, useScorers } from '@/lib/field-dict-store'
import { useScope } from '@/lib/tenant-store'
import { useAgentTools } from '@/lib/capability-store'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import { PromptEditor, defaultPrompt, referencedVars, judgeModels } from './prompt-editor'
import { TrialLab } from './trial-lab'
import { CapabilityImportModal } from './capability-import-modal'
import { useCapabilityRegistry } from '@/lib/eval-capability-store'

type Trial = 'idle' | 'running' | 'passed'

const implLabel = { llm_judge: 'LLM 裁判', script: '脚本', hybrid: '混合' }

const emptyDim = { key: '', name: '', gtKey: '', release: '0.85' }

// 维度引用的服务能力类型推导
const getDimServiceType = (dimKey: string, dimName: string): { label: string; tone: 'primary' | 'warn' | 'pass' | 'neutral' } => {
  if (dimKey.startsWith('t2i.') || dimKey.includes('image') || dimName.includes('图') || dimName.includes('画') || dimName.includes('视觉')) {
    return { label: '图片', tone: 'warn' }
  }
  if (dimKey.startsWith('i2v.') || dimKey.includes('video') || dimName.includes('视频') || dimName.includes('时序')) {
    return { label: '视频', tone: 'primary' }
  }
  if (dimKey.startsWith('code.') || dimKey.includes('ast') || dimKey.includes('syntax') || dimName.includes('代码') || dimName.includes('AST') || dimName.includes('脚本') || dimKey === '4.1') {
    return { label: '规则', tone: 'pass' }
  }
  return { label: '文本', tone: 'primary' }
}

export function ScorersView({ initialImportCapId }: { initialImportCapId?: string }) {
  const { agent } = useScope()
  return <AgentScorers key={agent?.id ?? 'none'} initialImportCapId={initialImportCapId} />
}

function AgentScorers({ initialImportCapId }: { initialImportCapId?: string }) {
  const { agent } = useScope()
  const { tools } = useAgentTools(agent?.id)
  const agentBackground = agent?.background ?? ''
  const [dims, setDims] = useDimensions()
  const [list, setList] = useScorers()
  const dict = useFieldDict()
  const [sel, setSel] = useState(list[0]?.id || initialScorers[0].id)
  const [selectedDimKey, setSelectedDimKey] = useState(list[0]?.outputs[0] || initialScorers[0].outputs[0])
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)
  const [trial, setTrial] = useState<Record<string, Trial>>({})
  const [importModalOpen, setImportModalOpen] = useState(!!initialImportCapId)
  const [showFullPromptPreview, setShowFullPromptPreview] = useState(false)

  // 临时调试台状态（绑定 Case 测试打分，结果不保存）
  const [testCaseId, setTestCaseId] = useState<string>(goldenCases[0]?.id || '')
  const [isDebugging, setIsDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState<{
    score: number
    pass: boolean
    evidence: string
    latencyMs: number
    timestamp: string
  } | null>(null)

  const s = list.find((x) => x.id === sel) || list[0]
  const locked = s?.status === 'published'
  const t = trial[s?.id || ''] ?? 'idle'
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyDim)
  const editorRef = useRef<{ insert: (field: string) => void }>(null)

  const usesPrompt = s ? s.implType !== 'script' : false
  const template = s?.promptTemplate ?? (s ? defaultPrompt(s.inputFields) : '')
  const background = s?.background ?? ''
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
  const tokens = s ? s.inputFields.reduce((sum, f) => sum + (dict.find(f)?.avgTokens ?? 0), 0) : 0
  const missingFields = s ? s.inputFields.filter((f) => !dict.names.includes(f)) : []

  const [lab, setLab] = useState(false)

  const selectDimension = (dimKey: string) => {
    const target = list.find((item) => item.outputs.includes(dimKey))
    setSelectedDimKey(dimKey)
    setConfirmDeleteKey(null)
    if (target) setSel(target.id)
  }

  const deleteDimension = (dimKey: string) => {
    const remainingDims = dims.filter((dim) => dim.key !== dimKey)
    const remainingScorers = list.map((item) => ({
      ...item,
      outputs: item.outputs.filter((output) => output !== dimKey),
    }))

    setDims(remainingDims)
    setList(remainingScorers)
    setConfirmDeleteKey(null)

    if (selectedDimKey === dimKey) {
      const nextDim = remainingDims.find((dim) => remainingScorers.some((item) => item.outputs.includes(dim.key)))
      if (nextDim) {
        setSelectedDimKey(nextDim.key)
        const nextScorer = remainingScorers.find((item) => item.outputs.includes(nextDim.key))
        if (nextScorer) setSel(nextScorer.id)
      }
    }
  }

  const handleImportComplete = (newScorer: Scorer, newDims: Dimension[]) => {
    setDims((prevDims) => {
      const existingKeys = new Set(prevDims.map((d) => d.key))
      const toAdd = newDims.filter((d) => !existingKeys.has(d.key))
      return [...prevDims, ...toAdd]
    })
    setList((prevList) => [newScorer, ...prevList])
    setSel(newScorer.id)
    setSelectedDimKey(newScorer.outputs[0])
  }

  if (lab && s) {
    return (
      <TrialLab
        scorer={s}
        template={template}
        background={background}
        agentBackground={agentBackground}
        tools={tools}
        onClose={() => setLab(false)}
        onChange={update}
        onPublish={() => update({ status: 'published' })}
        onPassed={() => setTrial((m) => ({ ...m, [s.id]: 'passed' }))}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部操作条：精炼无废话 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">维度与评分器</h2>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{dims.length} 维度</span>
            <span>·</span>
            <span>{list.length} 评分器</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Btn variant="primary" size="sm" onClick={() => setImportModalOpen(true)}>
            <Plus className="size-3.5" />
            新建业务评分器 (选能力/配维度)
          </Btn>
          <a href="/capabilities">
            <Btn variant="outline" size="sm">
              <Cpu className="size-3.5" />
              评测能力注册库
            </Btn>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[430px_1fr]">
        <Panel
          title="维度注册表"
          actions={
            <Btn size="sm" variant={adding ? 'ghost' : 'outline'} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {adding ? <X className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              {adding ? '取消' : '新建维度'}
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
          {dims.length === 0 ? <p className="border-b px-4 py-8 text-center text-sm text-muted-foreground">暂无维度</p> : null}
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <Th className="w-14">key</Th>
                <Th className="w-16">能力类型</Th>
                <Th>名称</Th>
                <Th>阈值</Th>
                <Th className="w-16 text-center">启用</Th>
                <Th className="w-12 text-center" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {dims.map((d) => {
                const hasScorer = list.some((item) => item.outputs.includes(d.key))
                const selected = selectedDimKey === d.key
                const svc = getDimServiceType(d.key, d.name)

                return (
                  <tr
                    key={d.key}
                    role={hasScorer ? 'button' : undefined}
                    tabIndex={hasScorer ? 0 : -1}
                    aria-selected={selected}
                    onClick={() => hasScorer && selectDimension(d.key)}
                    onKeyDown={(event) => {
                      if (hasScorer && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        selectDimension(d.key)
                      }
                    }}
                    className={cn(
                      'group transition-colors',
                      hasScorer && 'cursor-pointer hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring',
                      !d.enabled && 'text-muted-foreground',
                      selected && 'bg-accent/60',
                    )}
                  >
                    <Td><Mono>{d.key}</Mono></Td>
                    <Td>
                      <Tag tone={svc.tone} className="font-medium text-[10px] px-1.5 py-0.5">
                        {svc.label}
                      </Tag>
                    </Td>
                    <Td><span className={cn('font-medium', !hasScorer && 'opacity-50')}>{d.name}</span></Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                        <span>通过 ≥ <span className="font-mono">{d.thresholds.release}</span></span>
                        <span>一致 ≥ <span className="font-mono">{d.thresholds.agreement}</span> · n ≥ <span className="font-mono">{d.thresholds.minSamples}</span></span>
                      </div>
                    </Td>
                    <Td className="text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={d.enabled}
                        aria-label={`启用 ${d.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setDims((items) => items.map((item) => (item.key === d.key ? { ...item, enabled: !item.enabled } : item)))
                        }}
                        className={cn('relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors', d.enabled ? 'bg-primary' : 'bg-input')}
                      >
                        <span className={cn('inline-block size-3.5 rounded-full bg-card shadow transition-transform', d.enabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
                      </button>
                    </Td>
                    <Td className="text-center">
                      <button
                        type="button"
                        aria-label={`删除 ${d.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setConfirmDeleteKey(d.key)
                        }}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        {s ? (
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  {s.name}
                  <Tag tone="primary" className="font-mono font-semibold">v{s.version}.0</Tag>
                </span>
              }
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  {/* 输出维度上面加一行-按钮：预览完整效果 */}
                  <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <FileText className="size-3.5 text-primary" />
                      当前评分器执行契约与完整提示词
                    </span>
                    <Btn size="sm" variant="primary" onClick={() => setShowFullPromptPreview(true)}>
                      <Eye className="size-3.5" />
                      预览完整效果
                    </Btn>
                  </div>

                  <Field label="绑定维度">
                    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-transparent p-2.5">
                      {s.outputs.map((o) => {
                        const d = dims.find((x) => x.key === o)
                        return (
                          <span key={o} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs font-medium text-foreground">
                            <Mono className="text-primary font-bold">{o}</Mono>
                            <span>{d?.name || o}</span>
                          </span>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="实现方式">
                    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-transparent p-2.5">
                      {(Object.keys(implLabel) as Scorer['implType'][]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          disabled={locked}
                          onClick={() => update({ implType: k })}
                          className={cn(
                            'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                            s.implType === k
                              ? 'border-primary text-primary font-bold bg-primary/5'
                              : 'border-input text-muted-foreground hover:border-primary/40 hover:text-foreground bg-transparent',
                            locked && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          {implLabel[k]}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {usesPrompt ? (
                    <Field label="提示词 / 裁判模型 / 评分规则">
                      <PromptEditor
                        insertRef={editorRef}
                        template={template}
                        background={background}
                        agentBackground={agentBackground}
                        agentBackgroundVersion={agent?.backgroundVersion ?? 0}
                        model={s.judgeModel ?? judgeModels[0]}
                        promptVersion={s.promptVersion ? (s.promptVersion.includes('@') ? s.promptVersion.split('@')[1] : s.promptVersion) : `v${s.version}.0`}
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

                  {/* 预期输出字段 (Expected Output Schema) */}
                  <Field label="预期输出字段 (Output Contract)">
                    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-transparent p-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs font-mono font-bold text-foreground">
                          <span className="size-1.5 rounded-full bg-pass" />
                          score
                          <Tag tone="pass" className="font-mono text-[9px] px-1">0/1</Tag>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs font-mono font-bold text-foreground">
                          <span className="size-1.5 rounded-full bg-pass" />
                          pass
                          <Tag tone="pass" className="font-mono text-[9px] px-1">bool</Tag>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs font-mono font-bold text-foreground">
                          <span className="size-1.5 rounded-full bg-primary" />
                          evidence
                          <Tag tone="primary" className="font-mono text-[9px] px-1">string</Tag>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-xs font-mono font-bold text-foreground">
                          <span className="size-1.5 rounded-full bg-warn" />
                          flaw_type
                          <Tag tone="warn" className="font-mono text-[9px] px-1">enum?</Tag>
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        裁判执行后严格按 JSON Schema 输出得分、通过判定与证据链理由
                      </span>
                    </div>
                  </Field>

                  {/* 调试台 (支持绑定任意一条 Case 尝试，结果不保存) */}
                  <Field label="单条 Case 快速调试台 (试跑不保存)">
                    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">绑定样本 Case:</span>
                          <select
                            value={testCaseId}
                            onChange={(e) => {
                              setTestCaseId(e.target.value)
                              setDebugResult(null)
                            }}
                            className="h-7.5 rounded-md border border-input bg-card px-2 font-mono text-xs text-foreground font-semibold"
                          >
                            {goldenCases.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.id} · {c.query[0]?.slice(0, 22) || '测试样本'}...
                              </option>
                            ))}
                          </select>
                        </div>

                        <Btn
                          size="sm"
                          variant="primary"
                          disabled={isDebugging}
                          onClick={() => {
                            setIsDebugging(true)
                            setTimeout(() => {
                              setIsDebugging(false)
                              setDebugResult({
                                score: 1,
                                pass: true,
                                evidence: `[调试样例 ${testCaseId}] 经裁判客观审计：Agent 先行下发澄清卡确认诉求，在用户选择后再精准写回文件，全流程符合业务合规准绳。`,
                                latencyMs: 890,
                                timestamp: '刚刚',
                              })
                            }, 500)
                          }}
                        >
                          <Play className="size-3" />
                          {isDebugging ? '裁判打分中...' : '运行试跑'}
                        </Btn>
                      </div>

                      {/* 调试返回结果 */}
                      {debugResult && (
                        <div className="flex flex-col gap-2 rounded-lg border border-pass/30 bg-card p-3 shadow-2xs">
                          <div className="flex items-center justify-between border-b pb-1.5">
                            <span className="flex items-center gap-1.5 font-bold text-xs text-pass">
                              <CheckCircle2 className="size-3.5" />
                              试跑判定通过 (Pass)
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              耗时 {debugResult.latencyMs}ms · 临时调试不存库
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded bg-muted/40 p-1.5">
                              <span className="text-muted-foreground text-[10px]">score 判定分：</span>
                              <span className="font-mono font-bold text-foreground ml-1">{debugResult.score}</span>
                            </div>
                            <div className="rounded bg-muted/40 p-1.5">
                              <span className="text-muted-foreground text-[10px]">pass 状态：</span>
                              <span className="font-mono font-bold text-pass ml-1">TRUE</span>
                            </div>
                          </div>

                          <div className="rounded bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground">
                            <span className="font-bold text-muted-foreground block mb-0.5">evidence (证据说明)：</span>
                            <p>{debugResult.evidence}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </Field>
                </div>

                <div className="flex flex-col gap-4">
                  <Field label={<span className="flex items-center justify-between">输入字段 <span className={cn('text-xs', tokens > 5000 ? 'text-warn' : 'text-muted-foreground')}>≈ <span className="font-mono">{tokens.toLocaleString()}</span> tok / 单元</span></span>}>
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
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all',
                                on ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-2xs' : 'border-border bg-card/60 hover:border-primary/40 hover:bg-muted/50',
                                locked && 'cursor-not-allowed',
                              )}
                            >
                              {on ? <X className="size-3 text-muted-foreground" aria-hidden="true" /> : <Plus className="size-3 text-muted-foreground" aria-hidden="true" />}
                              <div className="flex flex-col items-start min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Mono className={cn('font-bold', !on && 'text-muted-foreground')}>{f.logicalName}</Mono>
                                  {on && usesPrompt ? (
                                    linked ? (
                                      <Tag tone="primary" className="px-1 text-[10px]">已引用</Tag>
                                    ) : (
                                      <span className="size-1.5 shrink-0 rounded-full bg-warn" role="img" aria-label="未引用" />
                                    )
                                  ) : null}
                                </div>
                                <span className="text-[11px] text-muted-foreground line-clamp-1">{f.description}</span>
                              </div>
                              <div className="ml-auto flex items-center gap-2">
                                <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
                                  <div className={cn('h-full', f.avgTokens > 2000 ? 'bg-warn' : 'bg-primary/60')} style={{ width: `${Math.min(100, (f.avgTokens / 8100) * 100)}%` }} />
                                </div>
                                <Mono className={cn('w-12 text-right text-[11px]', f.avgTokens > 2000 ? 'text-warn' : 'text-muted-foreground')}>{f.avgTokens.toLocaleString()}</Mono>
                              </div>
                            </button>
                            {usesPrompt && on && !locked ? (
                              <button
                                type="button"
                                onClick={() => editorRef.current?.insert(f.logicalName)}
                                aria-label={`插入 ${f.logicalName}`}
                                className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary shadow-2xs"
                              >
                                <Plus className="size-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </Field>
                  {s.fixedInputs?.length ? (
                    <Field label="固定输入">
                      <ul className="flex flex-col gap-1">
                        {s.fixedInputs.map((f) => (
                          <li key={f.name} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                            <Mono>{f.name}</Mono>
                            <Tag>{f.kind === 'file' ? '文件' : '文本'}</Tag>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{f.value}</span>
                          </li>
                        ))}
                      </ul>
                    </Field>
                  ) : null}
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
        ) : null}
      </div>

      {/* 导入评测能力向导 Modal */}
      {importModalOpen && (
        <CapabilityImportModal
          defaultSelectedCapId={initialImportCapId}
          onClose={() => setImportModalOpen(false)}
          onImportComplete={handleImportComplete}
        />
      )}

      {/* 删除维度二次确认 Dialog */}
      {confirmDeleteKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertCircle className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">删除评测维度</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  确定要删除维度 <strong className="font-mono text-foreground">{confirmDeleteKey}</strong>（{dims.find((item) => item.key === confirmDeleteKey)?.name}）吗？删除后相关评分器将解绑该维度。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn size="sm" variant="outline" onClick={() => setConfirmDeleteKey(null)}>
                取消
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => deleteDimension(confirmDeleteKey)}>
                确认删除
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* 预览完整效果弹窗 */}
      {showFullPromptPreview && s && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setShowFullPromptPreview(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  评分器完整提示词与执行效果预览
                </h3>
                <Tag tone="primary">{s.name}</Tag>
              </div>
              <button
                type="button"
                onClick={() => setShowFullPromptPreview(false)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 text-xs flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3">
                <div>
                  <span className="text-muted-foreground">裁判基座模型：</span>
                  <Mono className="font-bold text-foreground">{s.judgeModel || 'openai/gpt-5.4-mini'}</Mono>
                </div>
                <div>
                  <span className="text-muted-foreground">提示词版本：</span>
                  <Tag tone="primary" className="font-mono font-bold">
                    {s.promptVersion ? (s.promptVersion.includes('@') ? s.promptVersion.split('@')[1] : s.promptVersion) : `v${s.version}.0`}
                  </Tag>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">挂载输出维度：</span>
                  <span className="font-semibold text-foreground ml-1">
                    {s.outputs.map((o) => `${o} (${dims.find((x) => x.key === o)?.name || o})`).join('、')}
                  </span>
                </div>
              </div>

              <div>
                <span className="font-bold text-foreground block mb-1.5">完整编译后 System Prompt：</span>
                <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3.5 font-mono text-[11px] leading-relaxed text-foreground max-h-80 overflow-y-auto">
                  {s.promptTemplate || template}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-end border-t px-5 py-3">
              <Btn size="sm" variant="primary" onClick={() => setShowFullPromptPreview(false)}>
                完成浏览
              </Btn>
            </div>
          </div>
        </div>
      )}
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
          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', st.done ? 'bg-pass-soft text-pass' : 'bg-muted text-muted-foreground')}>
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
  placeholder,
  invalid,
  type = 'text',
  onChange,
  autoFocus,
}: {
  label: string
  value: string
  placeholder?: string
  invalid?: boolean
  type?: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={cn('h-7 rounded border bg-card px-2 text-xs', invalid ? 'border-fail text-fail' : 'border-input text-foreground')}
      />
    </label>
  )
}
