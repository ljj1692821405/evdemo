'use client'

import { useState } from 'react'
import {
  Sparkles,
  ArrowRight,
  Check,
  X,
  Database,
  Pencil,
  Upload,
  Paperclip,
  Cable,
  Plus,
  Layers,
  FileText,
  ImageIcon,
  Video,
  Code2,
  CheckCircle2,
  Sliders,
  HelpCircle,
  BookmarkCheck,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td } from './primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
  type ScorerRubricType,
  type RubricOption,
  type DimensionTemplate,
} from '@/lib/eval-capability-store'
import { isValidFieldName, useFieldDict } from '@/lib/field-dict-store'
import type { Dimension, Scorer } from '@/lib/mock-data'

type InputSource = 'field' | 'text' | 'file'
type InputMapping = { source: InputSource; field: string; isNew: boolean; text: string; fileName: string }

export type Scale5Criteria = {
  score5: string
  score4: string
  score3: string
  score2: string
  score1: string
}

const defaultScale5Template: Scale5Criteria = {
  score5: '完全符合准绳，逻辑严密，无任何偏差或多余操作',
  score4: '符合核心诉求，略有微小表述或格式瑕疵，不影响使用',
  score3: '基本及格，满足基础功能，但存在部分细节疏漏或理解偏差',
  score2: '未达到预期，存在关键信息遗漏、工具调用错误或偏离主题',
  score1: '严重偏离，完全未解决问题，或产生越权风险与严重幻觉',
}

type Rubric = {
  scoreType: ScorerRubricType
  customOptions?: RubricOption[]
  threshold: number
  weight: number
  promptInstruction?: string
  criteriaText?: string
  scale5Criteria?: Scale5Criteria
}

type CustomDim = {
  key: string
  name: string
  scoreType: ScorerRubricType
  rubricText: string
  scale5Criteria?: Scale5Criteria
}

const sources: { id: InputSource; label: string; icon: typeof Database }[] = [
  { id: 'field', label: '项目/字典字段', icon: Database },
  { id: 'text', label: '固定文本/参数', icon: Pencil },
  { id: 'file', label: '上传素材底料', icon: Upload },
]

const categoryFilters = [
  { id: 'all', label: '全部能力' },
  { id: 'nlp_quality', label: '文本评价', icon: FileText },
  { id: 'multimodal_gen', label: '图片/视频评价', icon: ImageIcon },
  { id: 'custom', label: '规则与脚本', icon: Code2 },
]

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
  onImportComplete: (importedScorer: Scorer | null, newDims: Dimension[]) => void
  defaultSelectedCapId?: string
}) {
  const { capabilities } = useCapabilityRegistry()
  const dict = useFieldDict()

  // 4 步清晰心流：1.选能力 -> 2.选定/新增维度 -> 3.动态Input水管 -> 4.配置Rubric
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [catFilter, setCatFilter] = useState('all')
  const [selectedCapId, setSelectedCapId] = useState<string>(() => defaultSelectedCapId || capabilities[0]?.id || '')

  const currentCap = capabilities.find((c) => c.id === selectedCapId) || capabilities[0]

  // 自定义新维度表单状态
  const [customDims, setCustomDims] = useState<CustomDim[]>([])
  const [isAddingDim, setIsAddingDim] = useState(false)
  const [newDimKey, setNewDimKey] = useState('')
  const [newDimName, setNewDimName] = useState('')
  const [newDimType, setNewDimType] = useState<ScorerRubricType>('binary')
  const [newDimRubric, setNewDimRubric] = useState('')
  const [newDimScale5, setNewDimScale5] = useState<Scale5Criteria>({ ...defaultScale5Template })

  // 1-5分标尺编辑状态（当前正在编辑哪一个维度的 1-5 分）
  const [activeScale5DimKey, setActiveScale5DimKey] = useState<string | null>(null)

  // 动态输入字段列表（支持自由增加与删除）
  const [activeInputFields, setActiveInputFields] = useState<CapabilityInputField[]>(() =>
    currentCap ? [...currentCap.inputSchema] : []
  )
  const [isAddingField, setIsAddingField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CapabilityInputField['type']>('text')

  const handleAddField = (name?: string, label?: string, type?: CapabilityInputField['type']) => {
    const fName = (name || newFieldName).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    const fLabel = (label || newFieldLabel).trim() || fName
    const fType = type || newFieldType
    if (!fName) return
    if (activeInputFields.some((f) => f.name === fName)) return

    const newF: CapabilityInputField = {
      name: fName,
      label: fLabel,
      type: fType,
      required: false,
      description: '动态添加的评测字段',
      defaultMapping: fName,
    }

    setActiveInputFields((prev) => [...prev, newF])
    setMappings((prev) => ({
      ...prev,
      [fName]: {
        source: 'field',
        field: fName,
        isNew: true,
        text: '',
        fileName: '',
      },
    }))
    setNewFieldName('')
    setNewFieldLabel('')
    setIsAddingField(false)
  }

  const handleRemoveField = (fieldName: string) => {
    setActiveInputFields((prev) => prev.filter((f) => f.name !== fieldName))
  }

  const getInitData = (cap?: RegisteredCapability) => {
    const mappings: Record<string, InputMapping> = {}
    const rbs: Record<string, Rubric> = {}
    if (!cap) return { name: '', mappings, rubrics: rbs }

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
        scale5Criteria: d.defaultScoreType === 'scale_5' ? { ...defaultScale5Template } : undefined,
      }
    })
    return {
      name: `${cap.name.split(' ')[0]}业务评分器`,
      mappings,
      rubrics: rbs,
    }
  }

  const initData = getInitData(currentCap)

  const [scorerName, setScorerName] = useState(initData.name)
  // 【优化点】：默认不要勾选推荐评测维度，初始为空，完全由产品经理自主挑选！
  const [selectedDims, setSelectedDims] = useState<string[]>([])
  const [mappings, setMappings] = useState<Record<string, InputMapping>>(initData.mappings)
  const [rubrics, setRubrics] = useState<Record<string, Rubric>>(initData.rubrics)

  const patchMapping = (name: string, patch: Partial<InputMapping>) =>
    setMappings((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))

  const handleSelectCap = (cap: RegisteredCapability) => {
    setSelectedCapId(cap.id)
    const data = getInitData(cap)
    setScorerName(data.name)
    // 切换能力时，同样保持不强制默认勾选
    setSelectedDims([])
    setActiveInputFields([...cap.inputSchema])
    setMappings(data.mappings)
    setRubrics(data.rubrics)
    setCustomDims([])
    setActiveScale5DimKey(null)
  }

  const handleAddCustomDim = () => {
    if (!newDimKey.trim() || !newDimName.trim()) return
    const key = newDimKey.trim().toLowerCase().replace(/[^a-z0-9_.]+/g, '_')
    const added: CustomDim = {
      key,
      name: newDimName.trim(),
      scoreType: newDimType,
      rubricText:
        newDimType === 'scale_5'
          ? '1~5分连续打分制'
          : newDimRubric.trim() || '1分: 符合预期；0分: 不符合预期。',
      scale5Criteria: newDimType === 'scale_5' ? { ...newDimScale5 } : undefined,
    }
    setCustomDims((prev) => [...prev, added])
    setSelectedDims((prev) => (prev.includes(key) ? prev : [...prev, key]))
    setRubrics((prev) => ({
      ...prev,
      [key]: {
        scoreType: newDimType,
        threshold: newDimType === 'scale_5' ? 4.0 : 0.85,
        weight: 1.0,
        promptInstruction: `针对 ${added.name} 进行客观审核。`,
        criteriaText: added.rubricText,
        scale5Criteria: added.scale5Criteria,
      },
    }))
    setNewDimKey('')
    setNewDimName('')
    setNewDimRubric('')
    setIsAddingDim(false)
  }

  const handleFile = (field: CapabilityInputField, file: File | undefined) => {
    if (!file) return
    if (field.type === 'text' || field.type === 'json') {
      file.text().then((text) => patchMapping(field.name, { source: 'text', text }))
    } else {
      patchMapping(field.name, { fileName: file.name })
    }
  }

  // 切换维度选中状态（支持点击卡片任意大边框区域触发）
  const toggleDimension = (dimKey: string, isScale5: boolean) => {
    const isChecked = selectedDims.includes(dimKey)
    if (isChecked) {
      setSelectedDims(selectedDims.filter((k) => k !== dimKey))
      if (activeScale5DimKey === dimKey) setActiveScale5DimKey(null)
    } else {
      setSelectedDims([...selectedDims, dimKey])
      if (isScale5) setActiveScale5DimKey(dimKey)
    }
  }

  // 组装维度对象列表
  const assembleDimensions = (): Dimension[] => {
    const allDimTemplates = [
      ...currentCap.supportedDimensions,
      ...customDims.map((c) => ({
        key: c.key,
        name: c.name,
        defaultScoreType: c.scoreType,
        description: c.name,
        suggestedPrompt: '',
        defaultRubric: c.rubricText,
        requiredInputs: [],
      })),
    ]

    return selectedDims.map((dimKey) => {
      const dimTpl = allDimTemplates.find((d) => d.key === dimKey)
      return {
        key: dimKey,
        name: dimTpl?.name || dimKey,
        gtKey: `gt_${dimKey.replace(/[^a-z0-9]+/g, '_')}`,
        scoreType: rubrics[dimKey]?.scoreType || 'binary',
        thresholds: { release: rubrics[dimKey]?.threshold || 0.85, agreement: 0.85, minSamples: 10 },
        enabled: true,
      }
    })
  }

  // 【优化点】：只保存维度，跳过评分器配置！产品创建完维度后随时可以再配置评分器
  const handleSaveDimensionsOnly = () => {
    if (selectedDims.length === 0) return
    const newDims = assembleDimensions()
    onImportComplete(null, newDims)
    onClose()
  }

  const mappingReady = currentCap
    ? selectedDims.length > 0 && activeInputFields.length > 0
    : false

  // 完成全流程并生成评分器
  const handleFinishImport = () => {
    if (!currentCap || !mappingReady) return
    const newDims = assembleDimensions()

    const activeInputs = activeInputFields
    activeInputs.forEach((f) => {
      const fieldKey = mappings[f.name]?.field || f.name
      if (!dict.names.includes(fieldKey)) {
        dict.add({ logicalName: fieldKey, paths: [`sim_traj.turns[].${fieldKey}`], avgTokens: 0, description: f.label })
      }
    })

    const inputSection = activeInputs
      .map((f) => {
        const fieldKey = mappings[f.name]?.field || f.name
        return `## ${f.name}\n{{${fieldKey}}}`
      })
      .join('\n')

    const rubricSection = selectedDims
      .map((k) => {
        const rb = rubrics[k]
        if (rb?.scoreType === 'scale_5' && rb.scale5Criteria) {
          return `### ${k} (1~5分量表标准)\n5分: ${rb.scale5Criteria.score5}\n4分: ${rb.scale5Criteria.score4}\n3分: ${rb.scale5Criteria.score3}\n2分: ${rb.scale5Criteria.score2}\n1分: ${rb.scale5Criteria.score1}`
        }
        return `### ${k}\n${rb?.promptInstruction || ''}\n${rb?.criteriaText || ''}`
      })
      .join('\n\n')

    const newScorer: Scorer = {
      id: `sc_${currentCap.id.replace('cap_', '')}_${Date.now().toString().slice(-4)}`,
      name: scorerName.trim() || `${currentCap.name}评分器`,
      version: 'v1.0.0',
      status: 'draft',
      implType: currentCap.executionType === 'python_adapter' ? 'script' : 'llm_judge',
      inputFields: activeInputs.map((f) => mappings[f.name].field || f.name),
      outputs: selectedDims,
      promptTemplate: `${inputSection}\n\n# 评测判定准绳 (Rubrics)\n${rubricSection}`,
      background: currentCap.scenario || '',
      referenceCapabilityId: currentCap.id,
      updatedAt: '刚刚',
      author: '当前用户',
    }

    onImportComplete(newScorer, newDims)
    onClose()
  }

  const filteredCaps = capabilities.filter((c) => {
    if (catFilter === 'all') return true
    return c.category === catFilter
  })

  // 所有可用维度列表
  const allAvailableDims = [
    ...currentCap.supportedDimensions,
    ...customDims.map((c) => ({
      key: c.key,
      name: c.name,
      defaultScoreType: c.scoreType,
      description: '自定义业务维度',
      suggestedPrompt: '',
      defaultRubric: c.rubricText,
      requiredInputs: [],
    })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border bg-card shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b px-6 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-bold text-foreground">配置业务评测与评分器</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* 步骤条 */}
        <div className="grid grid-cols-4 border-b bg-muted/20 text-xs">
          {[
            { n: 1, label: '1. 选择评测能力' },
            { n: 2, label: '2. 选定/新增评测维度' },
            { n: 3, label: '3. 映射输入字段' },
            { n: 4, label: '4. 配置评分器标准' },
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
          {/* 步骤 1：选择能力（已彻底删除小字介绍式说明） */}
          {step === 1 && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-1.5">
                {categoryFilters.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCatFilter(cat.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      catFilter === cat.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredCaps.map((cap) => {
                  const isSelected = cap.id === currentCap?.id
                  return (
                    <button
                      key={cap.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => handleSelectCap(cap)}
                      className={cn(
                        'flex flex-col justify-between rounded-xl border p-4 text-left transition-all',
                        isSelected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs'
                          : 'hover:border-primary/40 bg-card',
                      )}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-sm text-foreground">{cap.name}</span>
                        <div className="flex items-center gap-1.5">
                          <Tag tone={isSelected ? 'primary' : 'neutral'}>{cap.executionType === 'llm_judge' ? 'LLM' : 'VLM'}</Tag>
                          <Tag tone="neutral">{cap.version}</Tag>
                        </div>
                      </div>

                      <div className="mt-4 border-t pt-2.5 flex w-full items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">点击选定此能力</span>
                        {isSelected ? (
                          <span className="flex items-center gap-1 font-semibold text-primary">
                            <Check className="size-3.5" aria-hidden="true" /> 已选择
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 步骤 2：选定与新增评测维度（默认不勾选 + 专属 1-5 分量表标准定义 + 可直接保存维度） */}
          {step === 2 && currentCap && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3 border">
                <div>
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" />
                    当前选用能力底座：{currentCap.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    请自主勾选需要的业务评测维度，或新增自定义维度（已选 {selectedDims.length} 项）
                  </div>
                </div>
                <Btn size="sm" variant="primary" onClick={() => setIsAddingDim(true)}>
                  <Plus className="size-3" />
                  新增自定义维度
                </Btn>
              </div>

              {/* 维度自主勾选清单 */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">可选业务评测维度（点击勾选需要启用的维度）：</span>
                  {selectedDims.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDims([])}
                      className="text-muted-foreground hover:text-foreground text-[11px]"
                    >
                      清空已选
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {allAvailableDims.map((dim) => {
                    const checked = selectedDims.includes(dim.key)
                    const isScale5 = dim.defaultScoreType === 'scale_5'
                    return (
                      <div
                        key={dim.key}
                        onClick={() => toggleDimension(dim.key, isScale5)}
                        className={cn(
                          'flex flex-col gap-2 rounded-lg border p-3.5 transition-all cursor-pointer select-none',
                          checked
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs'
                            : 'border-border bg-card hover:border-primary/50 hover:bg-muted/20',
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleDimension(dim.key, isScale5)}
                            className="mt-0.5 rounded border-input accent-primary cursor-pointer shrink-0 size-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-xs text-foreground">{dim.name}</span>
                              <Tag tone={isScale5 ? 'warn' : 'primary'} className="text-[10px]">
                                {isScale5 ? '1~5 分量表' : '0/1 通过率'}
                              </Tag>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{dim.description || '业务质量判定'}</div>
                          </div>
                        </div>

                        {/* 如果是 1~5 分量表，提供专属设计与配置标准的入口 */}
                        {isScale5 && checked && (
                          <div className="mt-1 pt-2 border-t flex items-center justify-between">
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Sliders className="size-3 text-primary" />
                              已启用 1-5 分量表规则
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveScale5DimKey(activeScale5DimKey === dim.key ? null : dim.key)
                              }}
                              className="text-primary font-medium text-[11px] hover:underline cursor-pointer"
                            >
                              {activeScale5DimKey === dim.key ? '收起标准定义' : '自定义 1~5 分档标准'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* 专属设计：1~5 分标准定义面板 */}
                {activeScale5DimKey && (
                  <div className="mt-2 rounded-xl border border-primary/40 bg-card p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Sliders className="size-4 text-primary" />
                        <span className="font-bold text-foreground text-xs">
                          【{allAvailableDims.find((d) => d.key === activeScale5DimKey)?.name}】1~5 分各档裁决标准定义
                        </span>
                      </div>
                      <Tag tone="warn">1~5 分量表</Tag>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      为大模型或裁判人员清晰定义每一档得分的判定标尺（Rubric），裁判将严格遵循此分档打分：
                    </p>

                    <div className="space-y-2">
                      {[
                        { score: '5分', key: 'score5' as const, label: '优秀 (满分)', tone: 'pass' as const },
                        { score: '4分', key: 'score4' as const, label: '良好 (达标)', tone: 'primary' as const },
                        { score: '3分', key: 'score3' as const, label: '及格 (基本可用)', tone: 'neutral' as const },
                        { score: '2分', key: 'score2' as const, label: '较差 (缺陷)', tone: 'warn' as const },
                        { score: '1分', key: 'score1' as const, label: '极差 (严重偏离)', tone: 'warn' as const },
                      ].map((item) => {
                        const curCriteria = rubrics[activeScale5DimKey]?.scale5Criteria || defaultScale5Template
                        return (
                          <div key={item.score} className="grid grid-cols-12 gap-2 items-center rounded border bg-muted/20 p-2">
                            <div className="col-span-3 flex items-center gap-1.5">
                              <span className="font-bold font-mono text-xs text-foreground">{item.score}</span>
                              <Tag tone={item.tone} className="text-[10px]">{item.label}</Tag>
                            </div>
                            <input
                              type="text"
                              value={curCriteria[item.key]}
                              onChange={(e) => {
                                const nextCriteria = { ...curCriteria, [item.key]: e.target.value }
                                setRubrics((prev) => ({
                                  ...prev,
                                  [activeScale5DimKey]: {
                                    ...prev[activeScale5DimKey],
                                    scale5Criteria: nextCriteria,
                                  },
                                }))
                              }}
                              placeholder={`定义 ${item.score} 的判定准绳...`}
                              className="col-span-9 h-7 rounded border border-input bg-card px-2 text-xs"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 新增自定义维度浮层表单 */}
                {isAddingDim && (
                  <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-accent/30 p-4 mt-2">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-bold text-foreground">新增自定义评测维度</span>
                      <button type="button" onClick={() => setIsAddingDim(false)} className="text-muted-foreground hover:text-foreground">
                        <X className="size-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[11px]">维度名称 (如: 逻辑严密性)</span>
                        <input
                          type="text"
                          placeholder="输入维度名称"
                          value={newDimName}
                          onChange={(e) => {
                            setNewDimName(e.target.value)
                            if (!newDimKey) {
                              setNewDimKey(`dim_${Date.now().toString().slice(-4)}`)
                            }
                          }}
                          className="h-8 rounded border border-input bg-card px-2.5 text-xs"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[11px]">维度标识 (自动生成)</span>
                        <input
                          type="text"
                          placeholder="dim.custom"
                          value={newDimKey}
                          onChange={(e) => setNewDimKey(e.target.value)}
                          className="h-8 rounded border border-input bg-card px-2.5 font-mono text-xs"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[11px]">打分制式</span>
                        <select
                          value={newDimType}
                          onChange={(e) => setNewDimType(e.target.value as ScorerRubricType)}
                          className="h-8 rounded border border-input bg-card px-2 text-xs"
                        >
                          <option value="binary">0/1 二元通过率 (推荐)</option>
                          <option value="scale_5">1~5 分量表连续打分</option>
                          <option value="scale_100">0~100 百分制</option>
                        </select>
                      </label>
                    </div>

                    {/* 自定义 1~5 分档标准 */}
                    {newDimType === 'scale_5' ? (
                      <div className="rounded-lg border bg-card p-3 space-y-2">
                        <span className="font-semibold text-foreground text-[11px] block">配置 1~5 分各档标准：</span>
                        <div className="space-y-1.5">
                          {[
                            { score: '5分', key: 'score5' as const },
                            { score: '4分', key: 'score4' as const },
                            { score: '3分', key: 'score3' as const },
                            { score: '2分', key: 'score2' as const },
                            { score: '1分', key: 'score1' as const },
                          ].map((item) => (
                            <div key={item.score} className="grid grid-cols-12 gap-2 items-center">
                              <span className="col-span-2 font-mono text-foreground font-semibold">{item.score}</span>
                              <input
                                type="text"
                                value={newDimScale5[item.key]}
                                onChange={(e) => setNewDimScale5({ ...newDimScale5, [item.key]: e.target.value })}
                                className="col-span-10 h-7 rounded border border-input px-2 text-xs bg-background"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="默认判定标准（例如：准确命中修改目标给 1 分，否则 0 分）"
                        value={newDimRubric}
                        onChange={(e) => setNewDimRubric(e.target.value)}
                        className="h-8 rounded border border-input bg-card px-2.5 text-xs"
                      />
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1 border-t">
                      <Btn size="sm" variant="ghost" onClick={() => setIsAddingDim(false)}>取消</Btn>
                      <Btn size="sm" variant="primary" onClick={handleAddCustomDim} disabled={!newDimName.trim()}>确定添加此维度</Btn>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 步骤 3：映射输入字段 (全面对齐外部界面的输入字段列展示，严格水平对齐) */}
          {step === 3 && currentCap && (
            <div className="flex flex-col gap-3.5">
              {/* 顶部控制栏：统计、恢复与增加操作 */}
              <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground text-xs">消费输入字段列表 ({activeInputFields.length})</span>
                      <Tag tone="primary">与评分器输入字段完全对齐</Tag>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      定义本次评测需从仿真日志中提取的字段。支持自由增删与按需组合，不限制字段数量。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveInputFields([...currentCap.inputSchema])}
                      className="text-muted-foreground hover:text-foreground text-[11px]"
                    >
                      恢复默认插槽
                    </button>
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => setIsAddingField(!isAddingField)}
                    >
                      <Plus className="size-3" />
                      增加输入字段
                    </Btn>
                  </div>
                </div>

                {/* 快捷一键追加仿真常用字段 */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t">
                  <span className="text-[11px] text-muted-foreground">快捷追加常用仿真字段：</span>
                  {[
                    { name: 'workspace_content', label: '工作区内容', type: 'text' as const },
                    { name: 'dialog_history', label: '多轮上下文历史', type: 'json' as const },
                    { name: 'action_sequence', label: '工具调用流水', type: 'json' as const },
                    { name: 'error_detail', label: '执行错误日志', type: 'text' as const },
                    { name: 'system_prompt', label: '系统提示词', type: 'text' as const },
                  ].map((preset) => {
                    const isAdded = activeInputFields.some((f) => f.name === preset.name)
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        disabled={isAdded}
                        onClick={() => handleAddField(preset.name, preset.label, preset.type)}
                        className={cn(
                          'rounded border px-2 py-0.5 text-[10px] transition-colors flex items-center gap-1',
                          isAdded
                            ? 'border-border bg-muted/40 text-muted-foreground opacity-50 cursor-not-allowed'
                            : 'border-primary/40 bg-card text-foreground hover:bg-primary/5 hover:border-primary cursor-pointer',
                        )}
                      >
                        <Plus className="size-2.5" />
                        {preset.label}
                      </button>
                    )
                  })}
                </div>

                {/* 增加自定义输入字段内联表单 */}
                {isAddingField && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card p-3 mt-1 shadow-xs">
                    <input
                      type="text"
                      placeholder="字段键名 (如: tool_call_result)"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      className="h-8 w-44 rounded border border-input px-2 font-mono text-xs bg-background"
                    />
                    <input
                      type="text"
                      placeholder="中文描述说明 (如: 工具返回内容)"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      className="h-8 w-48 rounded border border-input px-2 text-xs bg-background"
                    />
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as CapabilityInputField['type'])}
                      className="h-8 rounded border border-input px-2 text-xs bg-background font-mono"
                    >
                      <option value="text">text (文本)</option>
                      <option value="json">json (结构化)</option>
                      <option value="image">image (图片)</option>
                      <option value="number">number (数值)</option>
                    </select>
                    <Btn size="sm" variant="primary" onClick={() => handleAddField()} disabled={!newFieldName.trim()}>
                      确定添加
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setIsAddingField(false)}>
                      取消
                    </Btn>
                  </div>
                )}
              </div>

              {/* 输入字段卡片列 (复刻外部评分器输入字段展示，高度规整对齐) */}
              <div className="flex flex-col gap-2">
                {activeInputFields.map((field) => {
                  const m = mappings[field.name] || {
                    source: 'field',
                    field: field.name,
                    isNew: false,
                    text: '',
                    fileName: '',
                  }
                  return (
                    <div
                      key={field.name}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 shadow-xs"
                    >
                      {/* 左侧：字段名称、中文描述与类型标签（严格对齐） */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/30 font-mono text-primary font-bold text-xs">
                          {field.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <Mono className="font-bold text-xs text-foreground truncate">{field.name}</Mono>
                            <Tag tone="primary" className="font-mono text-[9px] shrink-0">
                              {field.type}
                            </Tag>
                          </div>
                          <span className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {field.label || '仿真输入字段'}
                          </span>
                        </div>
                      </div>

                      {/* 中间：映射到的仿真日志字段（下拉选择或直接映射） */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-muted-foreground">仿真提取键：</span>
                        <input
                          type="text"
                          value={m.field || field.name}
                          onChange={(e) => patchMapping(field.name, { field: e.target.value, source: 'field' })}
                          placeholder="仿真日志对应字段"
                          className="h-8 w-44 rounded border border-input bg-background px-2.5 font-mono text-xs text-foreground"
                        />
                      </div>

                      {/* 右侧操作：删除按钮 */}
                      <div className="shrink-0 pl-1 border-l flex items-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveField(field.name)}
                          title={`移除此输入字段 ${field.name}`}
                          className="flex size-7 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:border-fail/50 hover:bg-fail-soft hover:text-fail cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {activeInputFields.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center rounded-lg border border-dashed">
                    <p className="text-xs">当前未指定任何输入字段</p>
                    <button
                      type="button"
                      onClick={() => setIsAddingField(true)}
                      className="mt-2 text-primary font-medium text-xs hover:underline cursor-pointer"
                    >
                      + 点击增加输入字段
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 步骤 4：Rubric 评分标准配置 */}
          {step === 4 && currentCap && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3 border">
                <span className="font-semibold text-foreground">配置业务评分器名称：</span>
                <input
                  type="text"
                  placeholder="业务评分器名称"
                  value={scorerName}
                  onChange={(e) => setScorerName(e.target.value)}
                  className="h-8 w-72 rounded border border-input bg-card px-2.5 text-xs font-medium"
                />
              </div>

              {selectedDims.map((dimKey) => {
                const dimTpl = allAvailableDims.find((d) => d.key === dimKey)
                const rubric: Rubric = rubrics[dimKey] || {
                  scoreType: dimTpl?.defaultScoreType || 'binary',
                  threshold: 0.85,
                  weight: 1.0,
                  promptInstruction: dimTpl?.suggestedPrompt || '',
                  criteriaText: dimTpl?.defaultRubric || '',
                  scale5Criteria: defaultScale5Template,
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

                    {rubric.scoreType === 'scale_5' && rubric.scale5Criteria ? (
                      <div className="rounded border bg-muted/20 p-2.5 space-y-1.5">
                        <span className="text-[11px] font-semibold text-foreground">1~5 分打分标准：</span>
                        <div className="text-[11px] space-y-1 font-mono text-muted-foreground">
                          <div>5分: {rubric.scale5Criteria.score5}</div>
                          <div>4分: {rubric.scale5Criteria.score4}</div>
                          <div>3分: {rubric.scale5Criteria.score3}</div>
                          <div>2分: {rubric.scale5Criteria.score2}</div>
                          <div>1分: {rubric.scale5Criteria.score1}</div>
                        </div>
                      </div>
                    ) : (
                      <textarea
                        rows={2}
                        value={rubric.criteriaText}
                        onChange={(e) => setRubric({ criteriaText: e.target.value })}
                        placeholder="判定标准（例如：只要 Agent 没有调用非授权工具即视为通过）..."
                        className="w-full rounded border border-input bg-background p-2 text-xs"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部操作条：完美支持两阶段解耦 */}
        <div className="flex items-center justify-between border-t px-6 py-3.5">
          <Btn variant="outline" size="sm" onClick={onClose}>
            取消
          </Btn>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <Btn variant="outline" size="sm" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}>
                上一步
              </Btn>
            )}

            {/* 步骤 2 核心解耦交互：支持“仅保存维度” */}
            {step === 2 && (
              <Btn
                variant="outline"
                size="sm"
                onClick={handleSaveDimensionsOnly}
                disabled={selectedDims.length === 0}
                className="border-primary/40 text-primary hover:bg-primary/5"
              >
                <BookmarkCheck className="size-3.5" />
                仅保存选中的维度 (暂不配评分器)
              </Btn>
            )}

            {step < 4 ? (
              <Btn
                variant="primary"
                size="sm"
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                disabled={step === 2 && selectedDims.length === 0}
              >
                {step === 2 ? '继续配置评分器流水线' : '下一步'}
                <ArrowRight className="size-3" aria-hidden="true" />
              </Btn>
            ) : (
              <Btn variant="primary" size="sm" onClick={handleFinishImport} disabled={!mappingReady}>
                <Check className="size-3.5" aria-hidden="true" />
                完成配置并上线评分器
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
