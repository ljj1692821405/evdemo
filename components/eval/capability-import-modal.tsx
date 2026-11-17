'use client'

import { useState } from 'react'
import { Sparkles, ArrowRight, Check, X, Database, Pencil, Upload, Paperclip, Cable, Link2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td } from './primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
  type ScorerRubricType,
  type RubricOption,
} from '@/lib/eval-capability-store'
import { isValidFieldName, useFieldDict } from '@/lib/field-dict-store'
import type { Dimension, Scorer } from '@/lib/mock-data'

type InputSource = 'field' | 'text' | 'file'
type InputMapping = { source: InputSource; field: string; isNew: boolean; text: string; fileName: string }

type Rubric = {
  scoreType: ScorerRubricType
  customOptions?: RubricOption[]
  threshold: number
  weight: number
  promptInstruction?: string
  criteriaText?: string
}

const sources: { id: InputSource; label: string; icon: typeof Database }[] = [
  { id: 'field', label: '项目/字典字段', icon: Database },
  { id: 'text', label: '固定文本/参数', icon: Pencil },
  { id: 'file', label: '上传素材底料', icon: Upload },
]

const NEW_FIELD = '__new__'
const acceptByType: Record<string, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*' }

const toFieldName = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '')

const isComplete = (m: InputMapping | undefined) => {
  if (!m) return false
  if (m.source === 'field') return m.isNew ? isValidFieldName(m.field) : m.field !== ''
  if (m.source === 'text') return m.text.trim() !== ''
  return m.fileName !== ''
}

export function CapabilityImportModal({
  onClose,
  onImportComplete,
  defaultSelectedCapId,
}: {
  onClose: () => void
  onImportComplete: (importedScorer: Scorer, newDims: Dimension[]) => void
  defaultSelectedCapId?: string
}) {
  const { capabilities } = useCapabilityRegistry()
  const dict = useFieldDict()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedCapId, setSelectedCapId] = useState<string>(() => defaultSelectedCapId || capabilities[0]?.id || '')

  const currentCap = capabilities.find((c) => c.id === selectedCapId) || capabilities[0]

  const getInitData = (cap?: RegisteredCapability) => {
    const mappings: Record<string, InputMapping> = {}
    const rbs: Record<string, Rubric> = {}
    if (!cap) return { name: '', dims: [] as string[], mappings, rubrics: rbs }

    cap.inputSchema.forEach((f) => {
      const registered = [f.defaultMapping, f.name].find((n) => n && dict.names.includes(n))
      const suggested = f.required && f.defaultMapping ? toFieldName(f.defaultMapping) : ''
      mappings[f.name] = {
        source: 'field',
        field: registered ?? suggested,
        isNew: !registered && suggested !== '',
        text: '',
        fileName: '',
      }
    })
    cap.supportedDimensions.forEach((d) => {
      rbs[d.key] = {
        scoreType: d.defaultScoreType,
        threshold: d.defaultScoreType === 'scale_5' ? 4.0 : 0.85,
        weight: 1.0,
        promptInstruction: d.suggestedPrompt,
        criteriaText: d.defaultRubric,
        customOptions: [
          { key: 'A', label: '极佳', score: 5, tone: 'pass' },
          { key: 'B', label: '合格', score: 4, tone: 'pass' },
          { key: 'C', label: '不合格', score: 1, tone: 'fail' },
        ],
      }
    })
    return {
      name: `${cap.name.split(' ')[0]}业务评分器`,
      dims: cap.supportedDimensions.map((d) => d.key),
      mappings,
      rubrics: rbs,
    }
  }

  const initData = getInitData(currentCap)

  const [scorerName, setScorerName] = useState(initData.name)
  const [selectedDims, setSelectedDims] = useState<string[]>(initData.dims)
  const [mappings, setMappings] = useState<Record<string, InputMapping>>(initData.mappings)
  const [rubrics, setRubrics] = useState<Record<string, Rubric>>(initData.rubrics)

  const patchMapping = (name: string, patch: Partial<InputMapping>) =>
    setMappings((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))

  const handleSelectCap = (cap: RegisteredCapability) => {
    setSelectedCapId(cap.id)
    const data = getInitData(cap)
    setScorerName(data.name)
    setSelectedDims(data.dims)
    setMappings(data.mappings)
    setRubrics(data.rubrics)
  }

  const handleFile = (field: CapabilityInputField, file: File | undefined) => {
    if (!file) return
    if (field.type === 'text' || field.type === 'json') {
      file.text().then((text) => patchMapping(field.name, { source: 'text', text }))
    } else {
      patchMapping(field.name, { fileName: file.name })
    }
  }

  const mappingReady = currentCap
    ? selectedDims.length > 0 && currentCap.inputSchema.every((f) => !f.required || isComplete(mappings[f.name]))
    : false

  const handleFinishImport = () => {
    if (!currentCap || !mappingReady) return

    const newDims: Dimension[] = selectedDims.map((dimKey) => {
      const dimTpl = currentCap.supportedDimensions.find((d) => d.key === dimKey)
      return {
        key: dimKey,
        name: dimTpl?.name || dimKey,
        gtKey: `gt_${dimKey.replace('.', '_')}`,
        scoreType: 'binary',
        thresholds: { release: rubrics[dimKey]?.threshold || 0.85, agreement: 0.85, minSamples: 10 },
        enabled: true,
      }
    })

    const activeInputs = currentCap.inputSchema.filter((f) => isComplete(mappings[f.name]))
    const fieldInputs = activeInputs.filter((f) => mappings[f.name].source === 'field')

    fieldInputs.forEach((f) => {
      const m = mappings[f.name]
      if (m.isNew && !dict.names.includes(m.field)) {
        dict.add({ logicalName: m.field, paths: [`sim_traj.turns[].${m.field}`], avgTokens: 0, description: f.label })
      }
    })

    const inputSection = activeInputs
      .map((f) => {
        const m = mappings[f.name]
        const body = m.source === 'field' ? `{{${m.field}}}` : m.source === 'text' ? m.text.trim() : `[文件素材] ${m.fileName}`
        return `## ${f.name}\n${body}`
      })
      .join('\n')
    const rubricSection = selectedDims
      .map((k) => `### ${k}\n${rubrics[k]?.promptInstruction || ''}\n${rubrics[k]?.criteriaText || ''}`)
      .join('\n\n')

    const newScorer: Scorer = {
      id: `sc_${currentCap.id.replace('cap_', '')}_${Date.now().toString().slice(-4)}`,
      name: scorerName || `${currentCap.name}评分器`,
      outputs: selectedDims,
      implType: currentCap.executionType === 'python_adapter' ? 'script' : 'llm_judge',
      inputFields: Array.from(new Set(fieldInputs.map((f) => mappings[f.name].field))),
      fixedInputs: activeInputs
        .filter((f) => mappings[f.name].source !== 'field')
        .map((f) => {
          const m = mappings[f.name]
          return m.source === 'text'
            ? { name: f.name, kind: 'text' as const, value: m.text.trim() }
            : { name: f.name, kind: 'file' as const, value: m.fileName }
        }),
      judgeModel: currentCap.entrypoint.target,
      promptVersion: `pt_${currentCap.id}@v1`,
      promptTemplate: `${inputSection}\n\n${rubricSection}`,
      status: 'draft',
      version: 1,
      createdBy: '业务配置导入',
    }

    onImportComplete(newScorer, newDims)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-bold text-foreground">导入评测能力生成评分器</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* 步骤条 */}
        <div className="grid grid-cols-3 border-b bg-muted/20 text-xs">
          {[
            { n: 1, label: '1. 选择底层能力' },
            { n: 2, label: '2. 字段水管式映射与维度' },
            { n: 3, label: '3. 评分标准 Rubric' },
          ].map((st) => (
            <div
              key={st.n}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 font-medium transition-colors border-r last:border-r-0',
                step === st.n ? 'bg-card text-primary font-bold border-b-2 border-b-primary' : 'text-muted-foreground',
              )}
            >
              <span className={cn('flex size-4.5 items-center justify-center rounded-full font-mono text-[10px]', step === st.n ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                {st.n}
              </span>
              <span>{st.label}</span>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {/* 步骤 1：选择能力 */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {capabilities.map((cap) => {
                const isSelected = cap.id === currentCap?.id
                return (
                  <button
                    key={cap.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectCap(cap)}
                    className={cn(
                      'flex flex-col justify-between rounded-xl border p-4 text-left transition-all',
                      isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:border-primary/40 bg-card',
                    )}
                  >
                    <span className="block">
                      <span className="flex items-center justify-between">
                        <span className="font-bold text-sm text-foreground">{cap.name}</span>
                        <Tag tone="primary">{cap.version}</Tag>
                      </span>
                      <Mono className="text-[10px] text-muted-foreground mt-0.5">{cap.code}</Mono>
                      <span className="mt-2 block text-muted-foreground leading-relaxed text-xs">{cap.intro}</span>
                    </span>

                    <span className="mt-4 border-t pt-2.5 flex w-full items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{cap.inputSchema.length} 输入参数 · {cap.supportedDimensions.length} 维度模板</span>
                      {isSelected ? (
                        <span className="flex items-center gap-1 font-semibold text-primary"><Check className="size-3.5" aria-hidden="true" /> 已选</span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* 步骤 2：水管式字段映射 */}
          {step === 2 && currentCap && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-muted/30 p-3 border">
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Cable className="size-3.5 text-primary" />
                    当前引用能力：{currentCap.name} ({currentCap.code})
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    产品经理通过字段对齐、固定值或上传物料完成输入绑定，系统自动驱动底层执行入口
                  </div>
                </div>
                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="业务评分器名称"
                    value={scorerName}
                    onChange={(e) => setScorerName(e.target.value)}
                    className="h-7.5 w-full rounded border border-input bg-card px-2.5 text-xs font-medium"
                  />
                </div>
              </div>

              {/* 映射列表 */}
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full table-fixed text-xs">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <Th className="w-60">能力所需入参 (Input Schema)</Th>
                      <Th className="w-10 text-center"><span className="sr-only">连接</span></Th>
                      <Th>数据来源与映射 (Data Pipe)</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {currentCap.inputSchema.map((field) => {
                      const m = mappings[field.name]
                      const complete = isComplete(m)
                      const missing = field.required && !complete
                      const controlCls = cn(
                        'w-full rounded border bg-background px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring',
                        missing ? 'border-fail' : complete ? 'border-primary/50' : 'border-input',
                      )
                      return (
                        <tr key={field.name} className="align-top">
                          <Td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Mono className="font-semibold">{field.name}</Mono>
                              <Tag tone="primary">{field.type}</Tag>
                              {field.required ? <Tag tone="warn">必填</Tag> : <Tag tone="neutral">可选</Tag>}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{field.label}</div>
                            {field.description ? <div className="mt-0.5 text-[10px] text-muted-foreground/80 line-clamp-1">{field.description}</div> : null}
                          </Td>

                          <Td className="text-center pt-3">
                            <span className={cn('inline-flex size-5 items-center justify-center rounded-full text-xs font-mono', complete ? 'bg-pass-soft text-pass' : missing ? 'bg-fail-soft text-fail' : 'bg-muted text-muted-foreground')}>
                              →
                            </span>
                          </Td>

                          <Td>
                            <div className="flex flex-col gap-2">
                              <div role="radiogroup" aria-label={`${field.name} 来源`} className="flex flex-wrap gap-1">
                                {sources.map((s) => {
                                  const active = m.source === s.id
                                  const Icon = s.icon
                                  return (
                                    <button
                                      key={s.id}
                                      type="button"
                                      role="radio"
                                      aria-checked={active}
                                      onClick={() => patchMapping(field.name, { source: s.id })}
                                      className={cn(
                                        'flex h-6.5 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors border',
                                        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground hover:bg-muted border-input',
                                      )}
                                    >
                                      <Icon className="size-3" aria-hidden="true" />
                                      {s.label}
                                    </button>
                                  )
                                })}
                              </div>

                              <div className="min-w-0">
                                {m.source === 'field' ? (
                                  m.isNew ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={m.field}
                                        aria-label={`${field.name} 新字段名`}
                                        placeholder="新字段名 (例如: agent_image_output)"
                                        autoFocus={m.field === ''}
                                        onChange={(e) => patchMapping(field.name, { field: e.target.value })}
                                        className={cn(controlCls, 'h-8 font-mono', m.field !== '' && !isValidFieldName(m.field) && 'border-fail text-fail')}
                                      />
                                      <Tag tone="primary">字典新建</Tag>
                                      <button
                                        type="button"
                                        aria-label="改为选择已有字段"
                                        onClick={() => patchMapping(field.name, { isNew: false, field: '' })}
                                        className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                      >
                                        <X className="size-3.5" aria-hidden="true" />
                                      </button>
                                    </div>
                                  ) : (
                                    <select
                                      value={m.field}
                                      aria-label={`${field.name} 映射字段`}
                                      onChange={(e) =>
                                        e.target.value === NEW_FIELD
                                          ? patchMapping(field.name, { isNew: true, field: '' })
                                          : patchMapping(field.name, { field: e.target.value })
                                      }
                                      className={cn(controlCls, 'h-8 font-mono')}
                                    >
                                      <option value="">{field.required ? '请选择映射字段...' : '不映射（使用默认空值）'}</option>
                                      <optgroup label="字段字典 (当前 Agent / 仿真输出)">
                                        {dict.entries.map((e) => (
                                          <option key={e.logicalName} value={e.logicalName}>
                                            {e.logicalName} · {e.description}
                                          </option>
                                        ))}
                                      </optgroup>
                                      <option value={NEW_FIELD}>+ 在字典中新建字段映射</option>
                                    </select>
                                  )
                                ) : m.source === 'text' ? (
                                  <textarea
                                    rows={2}
                                    value={m.text}
                                    aria-label={`${field.name} 固定内容`}
                                    placeholder={field.placeholder ?? `输入固定 ${field.label}...`}
                                    onChange={(e) => patchMapping(field.name, { text: e.target.value })}
                                    className={cn(controlCls, 'resize-y py-1.5 leading-relaxed font-mono')}
                                  />
                                ) : m.fileName ? (
                                  <div className="flex h-8 items-center gap-2 rounded border border-input bg-muted/30 px-2.5">
                                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{m.fileName}</span>
                                    <button
                                      type="button"
                                      aria-label={`移除 ${m.fileName}`}
                                      onClick={() => patchMapping(field.name, { fileName: '' })}
                                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                                    >
                                      <X className="size-3.5" aria-hidden="true" />
                                    </button>
                                  </div>
                                ) : (
                                  <label
                                    className={cn(
                                      'flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-primary',
                                      missing ? 'border-fail bg-fail-soft/10' : 'border-input bg-card',
                                    )}
                                  >
                                    <Upload className="size-3.5" aria-hidden="true" />
                                    上传标准物料文件 ({field.type})
                                    <input
                                      type="file"
                                      accept={acceptByType[field.type] ?? '.txt,.md,.json'}
                                      onChange={(e) => handleFile(field, e.target.files?.[0])}
                                      className="sr-only"
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* 勾选挂载的维度 */}
              <fieldset className="flex flex-col gap-1.5 border-t pt-3">
                <legend className="font-semibold text-foreground mb-1">选择评分器输出维度 (Dimensions)</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {currentCap.supportedDimensions.map((dim) => {
                    const checked = selectedDims.includes(dim.key)
                    return (
                      <label
                        key={dim.key}
                        className={cn(
                          'flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors',
                          checked ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/20 bg-card',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedDims(e.target.checked ? [...selectedDims, dim.key] : selectedDims.filter((k) => k !== dim.key))
                          }
                          className="mt-0.5 rounded border-input accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Mono className="font-semibold text-primary">{dim.key}</Mono>
                            <span className="font-medium text-foreground">{dim.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {dim.requiredInputs.map((name) => (
                              <Tag key={name} tone={isComplete(mappings[name]) ? 'pass' : 'neutral'} className="font-mono text-[9px]">
                                {name}: {isComplete(mappings[name]) ? '已映射' : '待绑定'}
                              </Tag>
                            ))}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            </div>
          )}

          {/* 步骤 3：Rubric 规则配置 */}
          {step === 3 && currentCap && (
            <div className="flex flex-col gap-3.5">
              {selectedDims.map((dimKey) => {
                const dimTpl = currentCap.supportedDimensions.find((d) => d.key === dimKey)
                const rubric: Rubric = rubrics[dimKey] || {
                  scoreType: 'scale_5',
                  threshold: 4.0,
                  weight: 1.0,
                  promptInstruction: dimTpl?.suggestedPrompt || '',
                  criteriaText: dimTpl?.defaultRubric || '',
                }
                const setRubric = (patch: Partial<Rubric>) => setRubrics({ ...rubrics, [dimKey]: { ...rubric, ...patch } })

                return (
                  <div key={dimKey} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Mono className="font-bold text-primary">{dimKey}</Mono>
                        <span className="font-bold text-foreground text-sm">{dimTpl?.name}</span>
                      </div>

                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">制式</span>
                        <select
                          value={rubric.scoreType}
                          onChange={(e) => {
                            const newType = e.target.value as ScorerRubricType
                            setRubric({ scoreType: newType, threshold: newType === 'scale_5' ? 4 : newType === 'scale_100' ? 85 : 0.85 })
                          }}
                          className="h-7 rounded border border-input bg-background px-2 text-xs font-medium"
                        >
                          <option value="binary">0/1 二元通过率</option>
                          <option value="scale_5">1~5 连续打分</option>
                          <option value="scale_100">0~100 百分制</option>
                        </select>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">判定标准 (Rubric)</span>
                        <textarea
                          rows={3}
                          value={rubric.criteriaText || ''}
                          onChange={(e) => setRubric({ criteriaText: e.target.value })}
                          className="w-full rounded border border-input bg-background p-2 text-[11px] leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">业务补充提示词 (Instruction)</span>
                        <textarea
                          rows={3}
                          value={rubric.promptInstruction || ''}
                          onChange={(e) => setRubric({ promptInstruction: e.target.value })}
                          className="w-full rounded border border-input bg-background p-2 text-[11px] leading-relaxed font-mono focus-visible:outline-2 focus-visible:outline-ring"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-4 text-[11px]">
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">通过阈值</span>
                        <input
                          type="number"
                          step="0.1"
                          value={rubric.threshold}
                          onChange={(e) => setRubric({ threshold: Number(e.target.value) })}
                          className="h-6 w-14 rounded border border-input bg-background px-1.5 font-mono"
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">权重</span>
                        <input
                          type="number"
                          step="0.1"
                          value={rubric.weight}
                          onChange={(e) => setRubric({ weight: Number(e.target.value) })}
                          className="h-6 w-14 rounded border border-input bg-background px-1.5 font-mono"
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between border-t px-6 py-3.5">
          <Btn variant="outline" size="sm" onClick={onClose}>
            取消
          </Btn>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <Btn size="sm" variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
                上一步
              </Btn>
            )}
            {step < 3 ? (
              <Btn size="sm" variant="primary" disabled={step === 2 && !mappingReady} onClick={() => setStep((s) => (s + 1) as 2 | 3)}>
                下一步
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Btn>
            ) : (
              <Btn size="sm" variant="primary" onClick={handleFinishImport} disabled={!mappingReady}>
                <Check className="size-3.5" aria-hidden="true" />
                完成导入并生成评分器
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
