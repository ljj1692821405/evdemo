'use client'

import { useState } from 'react'
import {
  Plus,
  Image as ImageIcon,
  Video,
  FileCode,
  ArrowRight,
  Sliders,
  CheckCircle2,
  Cpu,
  Layers,
  Search,
  Code2,
  Trash2,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td } from '@/components/eval/primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
} from '@/lib/eval-capability-store'

const categoryMap: Record<RegisteredCapability['category'], { label: string; tone: 'primary' | 'pass' | 'neutral' | 'warn' }> = {
  multimodal_gen: { label: '多模态生成', tone: 'primary' },
  agent_action: { label: 'Agent 行为', tone: 'pass' },
  nlp_quality: { label: '文本质量', tone: 'neutral' },
  safety: { label: '安全合规', tone: 'warn' },
  custom: { label: '自定义能力', tone: 'neutral' },
}

const typeIconMap: Record<string, typeof FileCode> = {
  text: FileCode,
  image: ImageIcon,
  video: Video,
  json: Code2,
  number: Sliders,
  boolean: CheckCircle2,
}

export function CapabilitiesRegistryView() {
  const { capabilities, registerCapability, deleteCapability } = useCapabilityRegistry()
  const [selectedId, setSelectedId] = useState<string>(capabilities[0]?.id ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)
  const [viewTab, setViewTab] = useState<'overview' | 'inputs' | 'dimensions' | 'execution'>('overview')

  const filteredCaps = capabilities.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.code.toLowerCase().includes(searchQuery.toLowerCase()) || c.intro.includes(searchQuery)
    const matchesCat = activeCategory === 'all' || c.category === activeCategory
    return matchesSearch && matchesCat
  })

  const currentCap = capabilities.find((c) => c.id === selectedId) || capabilities[0]

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部操作条：精简克制，只留核心操作 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Cpu className="size-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">通用评测能力注册库</h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>共 <strong className="font-mono text-foreground">{capabilities.length}</strong> 项能力</span>
              <span>·</span>
              <span>支持文生图、图生视频及自定义扩展</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Btn variant="primary" size="sm" onClick={() => setIsRegisterModalOpen(true)}>
            <Plus className="size-3.5" />
            注册能力
          </Btn>
          <a href="/scorers">
            <Btn variant="outline" size="sm">
              导入至评分器
              <ArrowRight className="size-3" />
            </Btn>
          </a>
        </div>
      </div>

      {/* 主工作区：左侧列表，右侧能力详情 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左侧筛选与列表 */}
        <div className="flex flex-col gap-2.5 lg:col-span-4 xl:col-span-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索能力或标识码"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {[
              { id: 'all', label: '全部' },
              { id: 'multimodal_gen', label: '多模态' },
              { id: 'agent_action', label: 'Agent 行为' },
              { id: 'safety', label: '安全' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id)}
                className={cn(
                  'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  activeCategory === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {filteredCaps.map((cap) => {
              const isSelected = cap.id === currentCap?.id
              const cat = categoryMap[cap.category] || categoryMap.custom
              const Icon = cap.id.includes('t2i') ? ImageIcon : cap.id.includes('i2v') ? Video : Cpu

              return (
                <div
                  key={cap.id}
                  onClick={() => setSelectedId(cap.id)}
                  className={cn(
                    'group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3.5 transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={cn('flex size-7 items-center justify-center rounded-md border', isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground')}>
                        <Icon className="size-3.5" />
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-foreground">
                          {cap.name}
                        </div>
                        <Mono className="text-[10px] text-muted-foreground">{cap.code}</Mono>
                      </div>
                    </div>
                    <Tag tone={cat.tone} className="text-[10px]">{cap.version}</Tag>
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground leading-snug">
                    {cap.intro}
                  </p>

                  <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                    <span>{cap.inputSchema.length} 输入 · {cap.supportedDimensions.length} 维度</span>
                    <span>{cap.author.split('·')[0]}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧能力详情与动态契约展示 */}
        {currentCap ? (
          <div className="flex flex-col gap-4 lg:col-span-8 xl:col-span-8">
            <div className="rounded-xl border bg-card p-5">
              {/* 头部元数据 */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold text-foreground">{currentCap.name}</h1>
                    <Tag tone={categoryMap[currentCap.category]?.tone}>{categoryMap[currentCap.category]?.label}</Tag>
                    <Tag tone="neutral"><Mono>{currentCap.version}</Mono></Tag>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span><Mono className="text-foreground">{currentCap.code}</Mono></span>
                    <span>·</span>
                    <span>{currentCap.author}</span>
                    <span>·</span>
                    <span>{currentCap.updatedAt}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a href={`/scorers?importCap=${currentCap.id}`}>
                    <Btn size="sm" variant="primary">
                      导入评分器
                    </Btn>
                  </a>
                  {currentCap.isCustom ? (
                    <Btn size="sm" variant="danger" onClick={() => deleteCapability(currentCap.id)}>
                      <Trash2 className="size-3.5" />
                      删除
                    </Btn>
                  ) : null}
                </div>
              </div>

              {/* 详情 Tab 切换 */}
              <div className="mt-4 flex border-b">
                {[
                  { id: 'overview', label: '契约概览' },
                  { id: 'inputs', label: `输入契约 (${currentCap.inputSchema.length})` },
                  { id: 'dimensions', label: `评分维度 (${currentCap.supportedDimensions.length})` },
                  { id: 'execution', label: '执行配置' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewTab(tab.id as any)}
                    className={cn(
                      'border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                      viewTab === tab.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab 内容：综合概览 */}
              {viewTab === 'overview' && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                    <div className="rounded-lg bg-muted/30 p-3">
                      <div className="font-semibold text-foreground mb-1">功能介绍</div>
                      <p className="text-muted-foreground leading-relaxed">{currentCap.intro}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <div className="font-semibold text-foreground mb-1">适用场景</div>
                      <p className="text-muted-foreground leading-relaxed">{currentCap.scenario}</p>
                    </div>
                  </div>

                  {/* 输入与输出契约两列对比 */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Layers className="size-3.5 text-primary" />
                          Input Schema
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">{currentCap.inputSchema.length} 字段</span>
                      </div>
                      <div className="mt-2.5 divide-y text-xs">
                        {currentCap.inputSchema.map((field) => (
                          <div key={field.name} className="py-1.5 flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <Mono className="font-semibold text-foreground">{field.name}</Mono>
                                {field.required ? (
                                  <Tag tone="warn" className="text-[9px] px-1 py-0">必填</Tag>
                                ) : (
                                  <Tag tone="neutral" className="text-[9px] px-1 py-0">可选</Tag>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground">{field.label}</div>
                            </div>
                            <Tag tone="primary" className="font-mono text-[10px]">{field.type}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-pass" />
                          Output Schema
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">{currentCap.outputSchema.metrics.length} 指标</span>
                      </div>
                      <div className="mt-2.5 divide-y text-xs">
                        {currentCap.outputSchema.metrics.map((m) => (
                          <div key={m.key} className="py-1.5 flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-foreground">{m.name}</span>
                                <Mono className="text-[10px] text-muted-foreground">({m.key})</Mono>
                              </div>
                              <div className="text-[11px] text-muted-foreground">{m.description}</div>
                            </div>
                            <Tag tone="pass" className="font-mono text-[10px]">{m.type}{m.range ? ` [${m.range[0]}-${m.range[1]}]` : ''}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 内容：输入契约详情 */}
              {viewTab === 'inputs' && (
                <div className="mt-4 overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <Th>字段 (name)</Th>
                        <Th>名称 (label)</Th>
                        <Th>类型</Th>
                        <Th>必填</Th>
                        <Th>默认映射</Th>
                        <Th>说明</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentCap.inputSchema.map((f) => (
                        <tr key={f.name} className="hover:bg-muted/20">
                          <Td><Mono className="font-semibold text-foreground">{f.name}</Mono></Td>
                          <Td><span className="font-medium">{f.label}</span></Td>
                          <Td><Tag tone="primary" className="font-mono text-[11px]">{f.type}</Tag></Td>
                          <Td>{f.required ? <Tag tone="warn">必填</Tag> : <Tag tone="neutral">可选</Tag>}</Td>
                          <Td><Mono className="text-muted-foreground">{f.defaultMapping || '—'}</Mono></Td>
                          <Td className="text-muted-foreground">{f.description}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 内容：维度配置 */}
              {viewTab === 'dimensions' && (
                <div className="mt-4 grid grid-cols-1 gap-3">
                  {currentCap.supportedDimensions.map((dim) => (
                    <div key={dim.key} className="rounded-lg border bg-card p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <Mono className="font-bold text-primary">{dim.key}</Mono>
                          <span className="font-semibold text-foreground">{dim.name}</span>
                        </div>
                        <Tag tone="pass">{dim.defaultScoreType === 'scale_5' ? '1~5分' : '0/1 通过率'}</Tag>
                      </div>
                      <p className="text-muted-foreground">{dim.description}</p>
                      <div className="rounded bg-muted/30 p-2.5 text-[11px] leading-relaxed text-foreground">
                        <span className="font-medium text-muted-foreground">标准: </span>
                        {dim.defaultRubric || '标准判定'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 内容：执行配置 */}
              {viewTab === 'execution' && (
                <div className="mt-4 space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-[11px]">调用协议</div>
                      <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.protocol}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-[11px]">默认裁判模型</div>
                      <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.defaultJudgeModel}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-[11px]">超时阈值</div>
                      <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.timeoutSec} 秒</div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-3.5">
                    <div className="font-semibold text-foreground mb-2">执行流水线 (Pipeline)</div>
                    <ol className="space-y-1.5">
                      {currentCap.executionConfig.samplePipeline.map((step, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-xs">
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">
                            {idx + 1}
                          </span>
                          <span className="text-foreground">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* 注册新能力弹窗 */}
      {isRegisterModalOpen && (
        <RegisterCapabilityModal
          onClose={() => setIsRegisterModalOpen(false)}
          onRegister={(newCap) => {
            registerCapability(newCap)
            setSelectedId(newCap.id)
            setIsRegisterModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function RegisterCapabilityModal({
  onClose,
  onRegister,
}: {
  onClose: () => void
  onRegister: (cap: RegisteredCapability) => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [category, setCategory] = useState<RegisteredCapability['category']>('multimodal_gen')
  const [intro, setIntro] = useState('')
  const [scenario, setScenario] = useState('')
  const [inputs, setInputs] = useState<CapabilityInputField[]>([
    { name: 'input_text', label: '输入文本', type: 'text', required: true, description: '提示词' },
    { name: 'output_media', label: '输出文件', type: 'image', required: true, description: '生成对象' },
  ])

  const handleAddInput = () => {
    setInputs([
      ...inputs,
      {
        name: `field_${inputs.length + 1}`,
        label: `字段 ${inputs.length + 1}`,
        type: 'text',
        required: false,
        description: '字段说明',
      },
    ])
  }

  const handleSave = () => {
    if (!name.trim() || !code.trim()) return
    const newCap: RegisteredCapability = {
      id: `cap_custom_${Date.now()}`,
      code: code.trim(),
      name: name.trim(),
      category,
      version: 'v1.0.0',
      author: '自定义',
      updatedAt: '2026-11-16',
      intro: intro.trim() || '通用评测能力',
      scenario: scenario.trim() || '定制场景评测',
      tags: ['自定义'],
      inputSchema: inputs,
      outputSchema: {
        metrics: [
          { key: 'overall_score', name: '综合分', type: 'score', range: [1, 5], description: '评测打分' },
        ],
        hasEvidenceChain: true,
        hasArtifactOutput: true,
      },
      executionConfig: {
        defaultJudgeModel: 'google/gemini-2.5-flash',
        supportedModels: ['google/gemini-2.5-flash', 'openai/gpt-5'],
        protocol: 'vlm_inspector',
        timeoutSec: 60,
        samplePipeline: ['输入校验', '多模态特征解析', '裁判评分', '输出报告'],
      },
      supportedDimensions: [
        {
          key: `${code}.overall`,
          name: `${name} 质量`,
          defaultScoreType: 'scale_5',
          description: `评估 ${name} 表现`,
          suggestedPrompt: `请打分。`,
          defaultRubric: '1~5 分评分',
          requiredInputs: inputs.map((i) => i.name),
        },
      ],
      isCustom: true,
    }
    onRegister(newCap)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-sm font-bold text-foreground">注册评测能力</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-medium text-foreground block mb-1">能力名称</label>
              <input
                type="text"
                placeholder="文生图评价"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              />
            </div>
            <div>
              <label className="font-medium text-foreground block mb-1">标识码 (Code)</label>
              <input
                type="text"
                placeholder="eval.t2i.universal"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs font-mono focus-visible:outline-2 focus-visible:outline-ring"
              />
            </div>
          </div>

          <div>
            <label className="font-medium text-foreground block mb-1">分类</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="h-8 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="multimodal_gen">多模态生成</option>
              <option value="agent_action">Agent 行为</option>
              <option value="nlp_quality">文本质量</option>
              <option value="safety">安全合规</option>
            </select>
          </div>

          <div>
            <label className="font-medium text-foreground block mb-1">功能介绍</label>
            <textarea
              rows={2}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              className="w-full rounded border border-input bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-medium text-foreground">输入字段 (Input Schema)</label>
              <Btn size="sm" variant="outline" onClick={handleAddInput}>
                <Plus className="size-3" />
                添加字段
              </Btn>
            </div>
            <div className="space-y-1.5 rounded-md border p-2 bg-muted/20">
              {inputs.map((field, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-1.5 items-center bg-card p-1.5 rounded border">
                  <input
                    type="text"
                    value={field.name}
                    placeholder="key"
                    onChange={(e) => {
                      const next = [...inputs]
                      next[idx].name = e.target.value
                      setInputs(next)
                    }}
                    className="col-span-3 h-7 rounded border border-input px-2 text-[11px] font-mono"
                  />
                  <input
                    type="text"
                    value={field.label}
                    placeholder="名称"
                    onChange={(e) => {
                      const next = [...inputs]
                      next[idx].label = e.target.value
                      setInputs(next)
                    }}
                    className="col-span-4 h-7 rounded border border-input px-2 text-[11px]"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const next = [...inputs]
                      next[idx].type = e.target.value as any
                      setInputs(next)
                    }}
                    className="col-span-3 h-7 rounded border border-input px-1 text-[11px]"
                  >
                    <option value="text">Text</option>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="json">JSON</option>
                  </select>
                  <label className="col-span-2 flex items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => {
                        const next = [...inputs]
                        next[idx].required = e.target.checked
                        setInputs(next)
                      }}
                    />
                    必填
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Btn size="sm" variant="outline" onClick={onClose}>
            取消
          </Btn>
          <Btn size="sm" variant="primary" onClick={handleSave} disabled={!name.trim() || !code.trim()}>
            <Check className="size-3.5" />
            注册
          </Btn>
        </div>
      </div>
    </div>
  )
}
