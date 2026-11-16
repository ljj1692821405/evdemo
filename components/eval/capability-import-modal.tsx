'use client'

import { useState } from 'react'
import {
  Sparkles,
  Layers,
  ArrowRight,
  Check,
  X,
  Sliders,
  SlidersHorizontal,
  Info,
  CheckCircle2,
  FileCode,
  Image as ImageIcon,
  Video,
  Plus,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, Tag, Mono, Btn, Th, Td } from './primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type ScorerRubricType,
  type RubricOption,
  type ScorerCapabilityBinding,
} from '@/lib/eval-capability-store'
import { useFieldDict } from '@/lib/field-dict-store'
import type { Dimension, Scorer } from '@/lib/mock-data'

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

  const [step, setStep] = useState<1 | 2 | 3>(1) // 1: 选择能力, 2: 字段映射与维度勾选, 3: 评分规则(Rubric)配置
  const [selectedCapId, setSelectedCapId] = useState<string>(() => defaultSelectedCapId || capabilities[0]?.id || '')

  const currentCap = capabilities.find((c) => c.id === selectedCapId) || capabilities[0]

  // 初始化辅助函数
  const getInitData = (cap?: RegisteredCapability) => {
    if (!cap) return { name: '', dims: [], mappings: {}, rubrics: {} }
    const mappings: Record<string, string> = {}
    cap.inputSchema.forEach((f) => {
      mappings[f.name] = f.defaultMapping || (dict.names.includes(f.name) ? f.name : '')
    })
    const rbs: Record<
      string,
      {
        scoreType: ScorerRubricType
        customOptions?: RubricOption[]
        threshold: number
        weight: number
        promptInstruction?: string
        criteriaText?: string
      }
    > = {}
    cap.supportedDimensions.forEach((d) => {
      rbs[d.key] = {
        scoreType: d.defaultScoreType,
        threshold: d.defaultScoreType === 'scale_5' ? 4.0 : 0.85,
        weight: 1.0,
        promptInstruction: d.suggestedPrompt,
        criteriaText: d.defaultRubric,
        customOptions: [
          { key: 'A', label: '极佳 (Excellent)', score: 5, tone: 'pass', description: '完全达到预期' },
          { key: 'B', label: '合格 (Good)', score: 4, tone: 'pass', description: '有微小瑕疵但不影响使用' },
          { key: 'C', label: '不合格 (Poor)', score: 1, tone: 'fail', description: '严重失真或错误' },
        ],
      }
    })
    return {
      name: `${cap.name.split(' ')[0]}综合评分器`,
      dims: cap.supportedDimensions.map((d) => d.key),
      mappings,
      rubrics: rbs,
    }
  }

  const initData = getInitData(currentCap)

  // Step 2 & 3 状态
  const [scorerName, setScorerName] = useState(initData.name)
  const [selectedDims, setSelectedDims] = useState<string[]>(initData.dims)
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>(initData.mappings)
  const [rubrics, setRubrics] = useState(initData.rubrics)

  // 切换选择能力
  const handleSelectCap = (cap: RegisteredCapability) => {
    setSelectedCapId(cap.id)
    const data = getInitData(cap)
    setScorerName(data.name)
    setSelectedDims(data.dims)
    setFieldMappings(data.mappings)
    setRubrics(data.rubrics)
  }

  // 最终提交导入
  const handleFinishImport = () => {
    if (!currentCap || selectedDims.length === 0) return

    // 1. 生成新维度
    const newDims: Dimension[] = selectedDims.map((dimKey) => {
      const dimTpl = currentCap.supportedDimensions.find((d) => d.key === dimKey)!
      const rubric = rubrics[dimKey]
      return {
        key: dimKey,
        name: dimTpl?.name || dimKey,
        gtKey: dimKey.replace('.', '_'),
        scoreType: 'binary',
        thresholds: {
          release: rubric?.threshold || 0.85,
          agreement: 0.85,
          minSamples: 10,
        },
        enabled: true,
      }
    })

    // 2. 收集需要的 inputFields
    const neededInputs = Array.from(
      new Set(
        selectedDims.flatMap((dimKey) => {
          const dimTpl = currentCap.supportedDimensions.find((d) => d.key === dimKey)
          return (dimTpl?.requiredInputs || []).map((inputName) => fieldMappings[inputName] || inputName)
        }),
      ),
    )

    // 3. 构建新评分器对象
    const newScorer: Scorer = {
      id: `sc_${currentCap.id.replace('cap_', '')}_${Date.now().toString().slice(-4)}`,
      name: scorerName || `${currentCap.name}评分器`,
      outputs: selectedDims,
      implType: 'llm_judge',
      inputFields: neededInputs,
      judgeModel: currentCap.executionConfig.defaultJudgeModel,
      promptVersion: `pt_${currentCap.id}@v1`,
      promptTemplate: selectedDims
        .map((k) => `### 维度 ${k} 判定要求:\n${rubrics[k]?.promptInstruction || ''}\n标准: ${rubrics[k]?.criteriaText || ''}`)
        .join('\n\n'),
      status: 'draft',
      version: 1,
      createdBy: '产品经理 · 导入配置',
    }

    onImportComplete(newScorer, newDims)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border bg-card shadow-2xl">
        {/* 顶部标题与步骤指示 */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">导入评测能力向导 (Import Evaluation Capability)</h2>
              <p className="text-xs text-muted-foreground">从通用能力库挑选预封装组件，可视化配置评分标准与字段映射</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {/* 步骤条 */}
        <div className="grid grid-cols-3 border-b bg-muted/20 text-xs">
          {[
            { n: 1, label: '1. 选择评测能力' },
            { n: 2, label: '2. 输入字段映射与维度' },
            { n: 3, label: '3. 产品标准与评分规则 (Rubric)' },
          ].map((st) => (
            <div
              key={st.n}
              className={cn(
                'flex items-center justify-center gap-2 py-3 font-medium transition-colors border-r last:border-r-0',
                step === st.n ? 'bg-card text-primary font-bold border-b-2 border-b-primary' : 'text-muted-foreground',
              )}
            >
              <span className={cn('flex size-5 items-center justify-center rounded-full text-[11px]', step === st.n ? 'bg-primary text-primary-foreground font-mono' : 'bg-muted')}>
                {st.n}
              </span>
              <span>{st.label}</span>
            </div>
          ))}
        </div>

        {/* 步骤主体内容 */}
        <div className="flex-1 overflow-y-auto p-6 text-xs">
          {/* STEP 1: 选择能力 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-muted-foreground">请从已注册能力库中挑选要导入的评测能力组件：</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {capabilities.map((cap) => {
                  const isSelected = cap.id === currentCap?.id
                  return (
                    <div
                      key={cap.id}
                      onClick={() => handleSelectCap(cap)}
                      className={cn(
                        'flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all',
                        isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'hover:border-primary/40 bg-card',
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-foreground">{cap.name}</span>
                          <Tag tone="primary">{cap.version}</Tag>
                        </div>
                        <Mono className="text-[11px] text-muted-foreground mt-0.5">{cap.code}</Mono>
                        <p className="mt-2 text-muted-foreground leading-relaxed text-xs">{cap.intro}</p>
                      </div>

                      <div className="mt-4 border-t pt-3 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{cap.inputSchema.length} 输入字段 · {cap.supportedDimensions.length} 维度</span>
                        {isSelected ? (
                          <span className="flex items-center gap-1 font-semibold text-primary"><Check className="size-3.5" /> 已选择</span>
                        ) : (
                          <span className="text-muted-foreground">点击选择</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* STEP 2: 字段映射与维度 */}
          {step === 2 && currentCap && (
            <div className="space-y-5">
              <div>
                <label className="font-semibold text-foreground block mb-1">评分器名称</label>
                <input
                  type="text"
                  value={scorerName}
                  onChange={(e) => setScorerName(e.target.value)}
                  className="h-8 w-full max-w-md rounded border border-input bg-background px-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>

              {/* 输入字段映射表格 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">输入字段映射 (Capability Input → 数据集/字典字段)</span>
                  <span className="text-[11px] text-muted-foreground">能力定义了所需输入，请指定其数据来源</span>
                </div>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <Th>能力输入字段</Th>
                        <Th>类型</Th>
                        <Th>约束</Th>
                        <Th>映射字段 (Dataset/Dict Field)</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentCap.inputSchema.map((field) => (
                        <tr key={field.name}>
                          <Td>
                            <Mono className="font-semibold">{field.name}</Mono>
                            <div className="text-[10px] text-muted-foreground">{field.label}</div>
                          </Td>
                          <Td><Tag tone="primary">{field.type}</Tag></Td>
                          <Td>{field.required ? <Tag tone="warn">必填</Tag> : <Tag tone="neutral">可选</Tag>}</Td>
                          <Td>
                            <input
                              type="text"
                              value={fieldMappings[field.name] || ''}
                              onChange={(e) => setFieldMappings({ ...fieldMappings, [field.name]: e.target.value })}
                              placeholder={field.defaultMapping || '输入或选择字典字段...'}
                              className="h-7 w-full rounded border border-input bg-background px-2 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-ring"
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 勾选需要激活的维度 */}
              <div className="space-y-2">
                <span className="font-semibold text-foreground">勾选导入的评分维度</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {currentCap.supportedDimensions.map((dim) => {
                    const checked = selectedDims.includes(dim.key)
                    return (
                      <label
                        key={dim.key}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                          checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/20',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDims([...selectedDims, dim.key])
                            } else {
                              setSelectedDims(selectedDims.filter((k) => k !== dim.key))
                            }
                          }}
                          className="mt-0.5 rounded border-input"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Mono className="font-semibold">{dim.key}</Mono>
                            <span className="font-medium text-foreground">{dim.name}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{dim.description}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: 产品标准与评分规则 (Rubric) */}
          {step === 3 && currentCap && (
            <div className="space-y-5">
              <div className="rounded-lg bg-muted/30 p-3 text-muted-foreground text-[11px]">
                产品经理可针对每个维度自由定制评分制式（0/1 通过率、1~5 分量表、自定义 ABC 选项）与判定规则，自动生成 Prompt 指令。
              </div>

              <div className="space-y-4">
                {selectedDims.map((dimKey) => {
                  const dimTpl = currentCap.supportedDimensions.find((d) => d.key === dimKey)!
                  const rubric = rubrics[dimKey] || {
                    scoreType: 'scale_5',
                    threshold: 4.0,
                    weight: 1.0,
                    promptInstruction: dimTpl?.suggestedPrompt || '',
                    criteriaText: dimTpl?.defaultRubric || '',
                  }

                  return (
                    <div key={dimKey} className="rounded-xl border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between border-b pb-2.5">
                        <div className="flex items-center gap-2">
                          <Mono className="font-bold text-primary">{dimKey}</Mono>
                          <span className="font-bold text-foreground text-sm">{dimTpl?.name}</span>
                        </div>

                        {/* 打分制式选择 */}
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">评分制式:</span>
                          <select
                            value={rubric.scoreType}
                            onChange={(e) => {
                              const newType = e.target.value as ScorerRubricType
                              setRubrics({
                                ...rubrics,
                                [dimKey]: {
                                  ...rubric,
                                  scoreType: newType,
                                  threshold: newType === 'scale_5' ? 4 : newType === 'scale_100' ? 85 : 0.85,
                                },
                              })
                            }}
                            className="h-7 rounded border border-input bg-background px-2 text-xs font-medium"
                          >
                            <option value="binary">0/1 二元判定 (Pass/Fail)</option>
                            <option value="scale_5">1~5 分量表打分</option>
                            <option value="scale_100">0~100 分制</option>
                            <option value="custom_options">自定义选项 (如 A/B/C 档)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {/* 判定标准描述 */}
                        <div>
                          <label className="font-medium text-foreground block mb-1">评分标准与阶梯定义 (Rubric Criteria)</label>
                          <textarea
                            rows={3}
                            value={rubric.criteriaText || ''}
                            onChange={(e) =>
                              setRubrics({
                                ...rubrics,
                                [dimKey]: { ...rubric, criteriaText: e.target.value },
                              })
                            }
                            className="w-full rounded border border-input bg-background p-2 text-[11px] leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
                          />
                        </div>

                        {/* 裁判 Prompt 约束指令 */}
                        <div>
                          <label className="font-medium text-foreground block mb-1">裁判 Prompt 判定指令 (Prompt Instruction)</label>
                          <textarea
                            rows={3}
                            value={rubric.promptInstruction || ''}
                            onChange={(e) =>
                              setRubrics({
                                ...rubrics,
                                [dimKey]: { ...rubric, promptInstruction: e.target.value },
                              })
                            }
                            className="w-full rounded border border-input bg-background p-2 text-[11px] leading-relaxed font-mono focus-visible:outline-2 focus-visible:outline-ring"
                          />
                        </div>
                      </div>

                      {/* 阈值与权重 */}
                      <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted/20 p-2.5 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">合格阈值:</span>
                          <input
                            type="number"
                            step="0.1"
                            value={rubric.threshold}
                            onChange={(e) =>
                              setRubrics({
                                ...rubrics,
                                [dimKey]: { ...rubric, threshold: Number(e.target.value) },
                              })
                            }
                            className="h-6 w-16 rounded border border-input bg-background px-1.5 font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">维度权重:</span>
                          <input
                            type="number"
                            step="0.1"
                            value={rubric.weight}
                            onChange={(e) =>
                              setRubrics({
                                ...rubrics,
                                [dimKey]: { ...rubric, weight: Number(e.target.value) },
                              })
                            }
                            className="h-6 w-16 rounded border border-input bg-background px-1.5 font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <Btn variant="outline" size="sm" onClick={onClose}>
            取消
          </Btn>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <Btn size="sm" variant="outline" onClick={() => setStep((s) => (s - 1) as any)}>
                上一步
              </Btn>
            )}
            {step < 3 ? (
              <Btn size="sm" variant="primary" onClick={() => setStep((s) => (s + 1) as any)}>
                下一步
                <ArrowRight className="size-3.5" />
              </Btn>
            ) : (
              <Btn size="sm" variant="primary" onClick={handleFinishImport} disabled={selectedDims.length === 0}>
                <Check className="size-3.5" />
                完成导入并生成评分器
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
