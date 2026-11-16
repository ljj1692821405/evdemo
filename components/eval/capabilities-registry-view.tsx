'use client'

import { useState } from 'react'
import {
  Boxes,
  Plus,
  Sparkles,
  Image as ImageIcon,
  Video,
  FileCode,
  ArrowRight,
  CheckCircle2,
  Sliders,
  ShieldAlert,
  Cpu,
  Layers,
  Search,
  ExternalLink,
  Code2,
  Trash2,
  Eye,
  Check,
  ChevronRight,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, Tag, Mono, Btn, Th, Td } from '@/components/eval/primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
  type DimensionTemplate,
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
  audio: Boxes,
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
    <div className="flex flex-col gap-6 p-6">
      {/* 头部介绍与快捷操作卡片 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-card to-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-4" />
            能力抽象与插件化架构
          </div>
          <h2 className="mt-2 text-lg font-bold text-foreground">
            通用评测能力注册中心 (Capability Registry)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            将文生图、图生视频、多模态时空分析、代码评审等评测逻辑高度抽象为可复用组件。开发人员定义输入契约 (Input Schema) 与执行流程，业务与产品人员可直接在「维度与评分器」中零代码导入、映射字段与配置评分规则。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Btn variant="primary" size="sm" onClick={() => setIsRegisterModalOpen(true)}>
              <Plus className="size-3.5" />
              注册新评测能力
            </Btn>
            <a
              href="/scorers"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              前往「维度与评分器」导入能力
              <ArrowRight className="size-3" />
            </a>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border bg-card p-5">
          <div>
            <div className="text-xs font-medium text-muted-foreground">已注册能力库统计</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold tracking-tight text-foreground">{capabilities.length}</span>
              <span className="text-xs text-muted-foreground">项评测能力</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Tag tone="primary">文生图 T2I</Tag>
              <Tag tone="primary">图生视频 I2V</Tag>
              <Tag tone="pass">VLM 裁判支持</Tag>
            </div>
          </div>
          <div className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
            标准协议：JSON-RPC / REST / VLM Pipeline
          </div>
        </div>
      </div>

      {/* 主工作区：左侧列表，右侧能力详情 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 左侧筛选与列表 */}
        <div className="flex flex-col gap-3 lg:col-span-4 xl:col-span-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索能力名称、code、关键词..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              />
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {[
              { id: 'all', label: '全部' },
              { id: 'multimodal_gen', label: '多模态生成' },
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
                    'group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={cn('flex size-8 items-center justify-center rounded-md border', isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground')}>
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <div className="font-medium text-sm text-foreground flex items-center gap-1.5">
                          {cap.name}
                        </div>
                        <Mono className="text-[11px] text-muted-foreground">{cap.code}</Mono>
                      </div>
                    </div>
                    <Tag tone={cat.tone} className="text-[10px]">{cap.version}</Tag>
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                    {cap.intro}
                  </p>

                  <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>输入: {cap.inputSchema.length} 项</span>
                      <span>·</span>
                      <span>维度: {cap.supportedDimensions.length} 项</span>
                    </div>
                    <span className="text-muted-foreground">{cap.author.split('·')[0]}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧能力详情与动态契约展示 */}
        {currentCap ? (
          <div className="flex flex-col gap-4 lg:col-span-8 xl:col-span-8">
            <div className="rounded-xl border bg-card p-6">
              {/* 头部元数据 */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight text-foreground">{currentCap.name}</h1>
                    <Tag tone={categoryMap[currentCap.category]?.tone}>{categoryMap[currentCap.category]?.label}</Tag>
                    <Tag tone="neutral"><Mono>{currentCap.version}</Mono></Tag>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>标识码: <Mono className="text-foreground">{currentCap.code}</Mono></span>
                    <span>·</span>
                    <span>维护人: {currentCap.author}</span>
                    <span>·</span>
                    <span>更新时间: {currentCap.updatedAt}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <LinkToScorerButton capId={currentCap.id} />
                  {currentCap.isCustom ? (
                    <Btn size="sm" variant="danger" onClick={() => deleteCapability(currentCap.id)}>
                      <Trash2 className="size-3.5" />
                      删除能力
                    </Btn>
                  ) : null}
                </div>
              </div>

              {/* 标签与适用场景 */}
              <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3.5">
                  <div className="text-xs font-semibold text-muted-foreground">功能与核心原理</div>
                  <p className="mt-1 text-xs text-foreground leading-relaxed">{currentCap.intro}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3.5">
                  <div className="text-xs font-semibold text-muted-foreground">推荐适用场景</div>
                  <p className="mt-1 text-xs text-foreground leading-relaxed">{currentCap.scenario}</p>
                </div>
              </div>

              {/* 详情 Tab 切换 */}
              <div className="mt-6 flex border-b">
                {[
                  { id: 'overview', label: '综合概览与契约' },
                  { id: 'inputs', label: `输入契约 (Input Schema · ${currentCap.inputSchema.length})` },
                  { id: 'dimensions', label: `推荐评分维度 (${currentCap.supportedDimensions.length})` },
                  { id: 'execution', label: '执行流水线与裁判配置' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewTab(tab.id as any)}
                    className={cn(
                      'border-b-2 px-4 py-2 text-xs font-medium transition-colors',
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
                <div className="mt-5 space-y-6">
                  {/* 输入与输出契约两列对比 */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Layers className="size-3.5 text-primary" />
                          输入字段规范 (Input Spec)
                        </span>
                        <Mono className="text-[11px] text-muted-foreground">{currentCap.inputSchema.length} 字段</Mono>
                      </div>
                      <div className="mt-3 divide-y text-xs">
                        {currentCap.inputSchema.map((field) => (
                          <div key={field.name} className="py-2 flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <Mono className="font-semibold text-foreground">{field.name}</Mono>
                                {field.required ? (
                                  <Tag tone="warn" className="text-[9px] px-1 py-0">必填</Tag>
                                ) : (
                                  <Tag tone="neutral" className="text-[9px] px-1 py-0">可选</Tag>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">{field.label}</div>
                            </div>
                            <Tag tone="primary" className="font-mono text-[10px]">{field.type}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-pass" />
                          输出指标契约 (Output Spec)
                        </span>
                        <Mono className="text-[11px] text-muted-foreground">{currentCap.outputSchema.metrics.length} 项指标</Mono>
                      </div>
                      <div className="mt-3 divide-y text-xs">
                        {currentCap.outputSchema.metrics.map((m) => (
                          <div key={m.key} className="py-2 flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-foreground">{m.name}</span>
                                <Mono className="text-[10px] text-muted-foreground">({m.key})</Mono>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">{m.description}</div>
                            </div>
                            <Tag tone="pass" className="font-mono text-[10px]">{m.type}{m.range ? ` [${m.range[0]}-${m.range[1]}]` : ''}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 快速演示：动态输入表单渲染样例 */}
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        动态输入界面预览 (根据 Input Schema 自动渲染)
                      </span>
                      <span className="text-[11px] text-muted-foreground">开发无需编写前端页面，配置即界面</span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {currentCap.inputSchema.map((field) => {
                        const Icon = typeIconMap[field.type] || FileCode
                        return (
                          <div key={field.name} className="flex flex-col gap-1 rounded-md border bg-card p-3">
                            <label className="flex items-center justify-between text-xs">
                              <span className="font-medium text-foreground flex items-center gap-1.5">
                                <Icon className="size-3.5 text-muted-foreground" />
                                {field.label}
                                {field.required && <span className="text-fail">*</span>}
                              </span>
                              <Mono className="text-[10px] text-muted-foreground">{field.type}</Mono>
                            </label>
                            <input
                              type="text"
                              disabled
                              placeholder={field.placeholder || `请输入或绑定 ${field.name}...`}
                              className="h-8 rounded border border-input bg-muted/30 px-2.5 text-xs text-muted-foreground cursor-not-allowed"
                            />
                            <span className="text-[10px] text-muted-foreground">{field.description}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 内容：输入契约详情 */}
              {viewTab === 'inputs' && (
                <div className="mt-5 space-y-4">
                  <div className="text-xs text-muted-foreground">
                    开发人员在此定义该评测能力所需的所有输入。评测执行引擎会严格校验输入结构，并自动与数据集字段进行绑定与转换。
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          <Th>字段标识 (name)</Th>
                          <Th>显示名称 (label)</Th>
                          <Th>类型 (type)</Th>
                          <Th>必填</Th>
                          <Th>默认映射字段</Th>
                          <Th>说明与样例</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {currentCap.inputSchema.map((f) => (
                          <tr key={f.name} className="hover:bg-muted/20">
                            <Td><Mono className="font-semibold text-foreground">{f.name}</Mono></Td>
                            <Td><span className="font-medium">{f.label}</span></Td>
                            <Td><Tag tone="primary" className="font-mono text-[11px]">{f.type}</Tag></Td>
                            <Td>
                              {f.required ? (
                                <Tag tone="warn" className="text-[10px]">是 (Required)</Tag>
                              ) : (
                                <Tag tone="neutral" className="text-[10px]">否 (Optional)</Tag>
                              )}
                            </Td>
                            <Td><Mono className="text-muted-foreground">{f.defaultMapping || '-'}</Mono></Td>
                            <Td>
                              <div className="text-xs text-foreground">{f.description}</div>
                              {f.placeholder ? <div className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate max-w-xs">{f.placeholder}</div> : null}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 内容：维度配置 */}
              {viewTab === 'dimensions' && (
                <div className="mt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      该能力预设的标准评测维度。导入到评分器后，产品经理可在此基础上自定义调整评分标准（0/1、1~5 分、A/B/C）与 Prompt。
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {currentCap.supportedDimensions.map((dim) => (
                      <div key={dim.key} className="rounded-lg border bg-card p-4 space-y-3">
                        <div className="flex items-center justify-between border-b pb-2">
                          <div className="flex items-center gap-2">
                            <Mono className="text-xs font-bold text-primary">{dim.key}</Mono>
                            <span className="font-semibold text-sm text-foreground">{dim.name}</span>
                          </div>
                          <Tag tone="pass">默认制式: {dim.defaultScoreType === 'scale_5' ? '1~5分' : '0/1 通过率'}</Tag>
                        </div>
                        <p className="text-xs text-muted-foreground">{dim.description}</p>
                        
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 rounded-md bg-muted/30 p-3 text-xs">
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">推荐评分规则 (Rubric)</div>
                            <div className="text-foreground text-[11px] leading-relaxed bg-background p-2 rounded border border-border/60">
                              {dim.defaultRubric || '标准二元判定'}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">关联输入字段</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {dim.requiredInputs.map((inputKey) => (
                                <Tag key={inputKey} tone="primary" className="font-mono text-[10px]">{inputKey}</Tag>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 内容：执行链路 */}
              {viewTab === 'execution' && (
                <div className="mt-5 space-y-4">
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="text-xs font-semibold text-foreground">执行架构与协议</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                      <div className="rounded bg-muted/40 p-2.5">
                        <div className="text-muted-foreground text-[11px]">调用协议</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.protocol}</div>
                      </div>
                      <div className="rounded bg-muted/40 p-2.5">
                        <div className="text-muted-foreground text-[11px]">默认裁判模型</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.defaultJudgeModel}</div>
                      </div>
                      <div className="rounded bg-muted/40 p-2.5">
                        <div className="text-muted-foreground text-[11px]">超时阈值</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">{currentCap.executionConfig.timeoutSec} 秒</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="text-xs font-semibold text-foreground">标准评测执行流水线 (Pipeline)</div>
                    <ol className="space-y-2">
                      {currentCap.executionConfig.samplePipeline.map((step, idx) => (
                        <li key={idx} className="flex items-center gap-2.5 text-xs">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">
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

      {/* 注册新能力弹窗 (开发者注册机制) */}
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

function LinkToScorerButton({ capId }: { capId: string }) {
  return (
    <a href={`/scorers?importCap=${capId}`}>
      <Btn size="sm" variant="primary">
        <Sparkles className="size-3.5" />
        导入至评分器
      </Btn>
    </a>
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
    { name: 'input_text', label: '输入文本', type: 'text', required: true, description: '主提示词或指令' },
    { name: 'output_media', label: '输出媒体文件', type: 'image', required: true, description: '生成的目标图片/视频' },
  ])

  const handleAddInput = () => {
    setInputs([
      ...inputs,
      {
        name: `field_${inputs.length + 1}`,
        label: `自定义字段 ${inputs.length + 1}`,
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
      author: '开发者 · 自定义',
      updatedAt: '2026-11-16',
      intro: intro.trim() || '通用自定义评测能力',
      scenario: scenario.trim() || '业务定制场景评测',
      tags: ['自定义', '扩展能力'],
      inputSchema: inputs,
      outputSchema: {
        metrics: [
          { key: 'overall_score', name: '综合达标分', type: 'score', range: [1, 5], description: '综合评测打分' },
        ],
        hasEvidenceChain: true,
        hasArtifactOutput: true,
      },
      executionConfig: {
        defaultJudgeModel: 'google/gemini-2.5-flash',
        supportedModels: ['google/gemini-2.5-flash', 'openai/gpt-5'],
        protocol: 'vlm_inspector',
        timeoutSec: 60,
        samplePipeline: ['输入载入与校验', '多模态特征解析', '裁判模型评分', '输出结构化证据与指标'],
      },
      supportedDimensions: [
        {
          key: `${code}.overall`,
          name: `${name} 综合质量`,
          defaultScoreType: 'scale_5',
          description: `评估 ${name} 的综合表现与指令遵从`,
          suggestedPrompt: `请基于输入对评测对象进行质量分析与打分。`,
          defaultRubric: '1~5 分阶梯评分',
          requiredInputs: inputs.map((i) => i.name),
        },
      ],
      isCustom: true,
    }
    onRegister(newCap)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Cpu className="size-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">注册通用评测能力 (Developer API)</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-medium text-foreground block mb-1">能力名称</label>
              <input
                type="text"
                placeholder="e.g. 3D资产网格生成评价"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              />
            </div>
            <div>
              <label className="font-medium text-foreground block mb-1">能力 Code 标识</label>
              <input
                type="text"
                placeholder="e.g. eval.gen3d.mesh"
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
              <option value="multimodal_gen">多模态生成 (文生图/图生视频/生音视频)</option>
              <option value="agent_action">Agent 行为 (工具调用/多轮交互)</option>
              <option value="nlp_quality">文本质量 (指令遵从/摘要/改写)</option>
              <option value="safety">安全合规 (有害检测/违规拦截)</option>
            </select>
          </div>

          <div>
            <label className="font-medium text-foreground block mb-1">能力简介与原理</label>
            <textarea
              rows={2}
              placeholder="简要描述该评测能力的评测目标、所用模型及核心指标..."
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              className="w-full rounded border border-input bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-foreground">输入字段契约 (Input Schema)</label>
              <Btn size="sm" variant="outline" onClick={handleAddInput}>
                <Plus className="size-3" />
                添加输入字段
              </Btn>
            </div>
            <div className="space-y-2 border rounded-md p-2 bg-muted/20">
              {inputs.map((field, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-card p-2 rounded border">
                  <input
                    type="text"
                    value={field.name}
                    placeholder="字段名 (key)"
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
                    placeholder="显示名称"
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
                    <option value="text">Text (文本)</option>
                    <option value="image">Image (图片)</option>
                    <option value="video">Video (视频)</option>
                    <option value="json">JSON (参数字典)</option>
                    <option value="audio">Audio (音频)</option>
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
            确认注册
          </Btn>
        </div>
      </div>
    </div>
  )
}
