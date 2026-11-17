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
  Play,
  Terminal,
  Globe,
  FileSpreadsheet,
  Clock,
  Sparkles,
  ExternalLink,
  FileText,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td, Panel } from '@/components/eval/primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
  type CapabilityExecutionType,
} from '@/lib/eval-capability-store'

const categoryMap: Record<RegisteredCapability['category'], { label: string; tone: 'primary' | 'pass' | 'neutral' | 'warn' }> = {
  multimodal_gen: { label: '多模态生成', tone: 'primary' },
  agent_action: { label: 'Agent 行为', tone: 'pass' },
  nlp_quality: { label: '文本质量', tone: 'neutral' },
  safety: { label: '安全合规', tone: 'warn' },
  custom: { label: '自定义能力', tone: 'neutral' },
}

const executionTypeMap: Record<CapabilityExecutionType, { label: string; icon: React.ElementType; tone: 'primary' | 'pass' | 'warn' | 'neutral' }> = {
  python_adapter: { label: 'Python 适配器', icon: Terminal, tone: 'pass' },
  http_api: { label: 'HTTP API', icon: Globe, tone: 'primary' },
  vlm_judge: { label: 'VLM 视觉裁判', icon: ImageIcon, tone: 'warn' },
  llm_judge: { label: 'LLM 文本裁判', icon: FileText, tone: 'primary' },
  custom_script: { label: '自定义脚本', icon: FileCode, tone: 'neutral' },
}

const splitLabel = (label: string) => {
  const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  return m ? { zh: m[1].trim(), en: m[2].trim() } : { zh: label, en: '' }
}

type PlaygroundRow = { id: string; key: string; value: string }

const rowsFromCap = (cap?: RegisteredCapability): PlaygroundRow[] =>
  (cap?.inputSchema ?? []).map((f, i) => ({
    id: `${f.name}-${i}`,
    key: splitLabel(f.label).en || f.name,
    value: cap?.sampleInputs?.[f.name] ?? '',
  }))

export function CapabilitiesRegistryView() {
  const { capabilities, registerCapability, deleteCapability } = useCapabilityRegistry()
  const [selectedId, setSelectedId] = useState<string>(capabilities[0]?.id ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)
  const [viewTab, setViewTab] = useState<'overview' | 'inputs' | 'dimensions' | 'execution' | 'playground'>('overview')

  // Playground 状态
  const [playgroundRows, setPlaygroundRows] = useState<PlaygroundRow[]>(() => rowsFromCap(capabilities[0]))
  const [debugResult, setDebugResult] = useState<RegisteredCapability['sampleOutput'] | null>(null)
  const [isDebugRunning, setIsDebugRunning] = useState(false)

  const filteredCaps = capabilities.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.code.toLowerCase().includes(searchQuery.toLowerCase()) || c.intro.includes(searchQuery)
    const matchesCat = activeCategory === 'all' || c.category === activeCategory
    return matchesSearch && matchesCat
  })

  const currentCap = capabilities.find((c) => c.id === selectedId) || capabilities[0]

  const handleSelectCap = (capId: string) => {
    setSelectedId(capId)
    const cap = capabilities.find((c) => c.id === capId)
    setPlaygroundRows(rowsFromCap(cap))
    setDebugResult(cap?.sampleOutput ?? null)
  }

  const addPlaygroundRow = () =>
    setPlaygroundRows((rows) => [...rows, { id: `custom-${Date.now()}`, key: '', value: '' }])

  const removePlaygroundRow = (id: string) => setPlaygroundRows((rows) => rows.filter((r) => r.id !== id))

  const updatePlaygroundRow = (id: string, patch: Partial<PlaygroundRow>) =>
    setPlaygroundRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const runPlaygroundDebug = () => {
    setIsDebugRunning(true)
    setTimeout(() => {
      setIsDebugRunning(false)
      setDebugResult(
        currentCap?.sampleOutput ?? {
          latencyMs: 1250,
          metrics: { score: 4.8, pass: true },
          evidence: 'Playground 模拟执行完成：字段解析与契约匹配正常。',
        },
      )
    }, 600)
  }

  const handlePublish = () => {
    if (!currentCap) return
    registerCapability({
      ...currentCap,
      status: 'published',
      updatedAt: '刚刚',
    })
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部操作条 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Cpu className="size-5" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">通用评测能力注册库</h2>
            <Tag tone="primary">{capabilities.length} 项已接入</Tag>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Btn variant="primary" size="sm" onClick={() => setIsRegisterModalOpen(true)}>
            <Plus className="size-3.5" />
            注册能力
          </Btn>
          <a href="/scorers">
            <Btn variant="outline" size="sm">
              前往评分器引用
              <ArrowRight className="size-3" />
            </Btn>
          </a>
        </div>
      </div>

      {/* 主工作区：左侧列表，右侧能力详情 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左侧列表 */}
        <div className="flex flex-col gap-2.5 lg:col-span-4 xl:col-span-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索能力名称、code 或关键字"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {[
              { id: 'all', label: '全部' },
              { id: 'multimodal_gen', label: '多模态' },
              { id: 'custom', label: '代码/脚本' },
              { id: 'agent_action', label: 'Agent 行为' },
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
              const exec = executionTypeMap[cap.executionType] || executionTypeMap.python_adapter
              const ExecIcon = exec.icon

              return (
                <div
                  key={cap.id}
                  onClick={() => handleSelectCap(cap.id)}
                  className={cn(
                    'group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3.5 transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={cn('flex size-7 items-center justify-center rounded-md border', isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground')}>
                        <ExecIcon className="size-3.5" />
                      </div>
                      <div className="font-semibold text-xs text-foreground">
                        {cap.name}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tag tone={exec.tone} className="text-[10px]">{exec.label.split(' ')[0]}</Tag>
                      <Tag tone={cap.status === 'published' ? 'pass' : 'neutral'} className="text-[10px]">{cap.version}</Tag>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧能力详情与调试台 */}
        {currentCap ? (
          <div className="flex flex-col gap-4 lg:col-span-8 xl:col-span-8">
            <div className="rounded-xl border bg-card p-5">
              {/* 头部元数据 */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base font-bold text-foreground">{currentCap.name}</h1>
                  <Tag tone={categoryMap[currentCap.category]?.tone}>{categoryMap[currentCap.category]?.label}</Tag>
                  <Tag tone={executionTypeMap[currentCap.executionType]?.tone}>{executionTypeMap[currentCap.executionType]?.label}</Tag>
                  <Tag tone={currentCap.status === 'published' ? 'pass' : 'neutral'}><Mono>{currentCap.version}</Mono></Tag>
                </div>

                <div className="flex items-center gap-2">
                  <a href={`/scorers?importCap=${currentCap.id}`}>
                    <Btn variant="primary" size="sm">
                      <Sparkles className="size-3.5" />
                      引用为评分器
                    </Btn>
                  </a>
                  {currentCap.isCustom && (
                    <button
                      type="button"
                      onClick={() => deleteCapability(currentCap.id)}
                      className="flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-fail-soft hover:text-fail"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 导航 Tabs */}
              <div className="mt-4 flex flex-wrap gap-1 border-b pb-3">
                {[
                  { id: 'overview', label: '概览' },
                  { id: 'inputs', label: 'Input' },
                  { id: 'dimensions', label: '适用评测维度' },
                  { id: 'execution', label: '执行入口' },
                  { id: 'playground', label: 'Playground' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setViewTab(tab.id as typeof viewTab)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      viewTab === tab.id
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab 1: 概览与契约 */}
              {viewTab === 'overview' && (
                <div className="mt-4 space-y-4 text-xs">
                  {/* 动态 Input 与适用评测维度 */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Layers className="size-3.5 text-primary" />
                          Input
                        </span>
                        <Tag tone="primary">按需映射</Tag>
                      </div>
                      <div className="mt-2.5 divide-y text-xs">
                        {currentCap.inputSchema.map((field) => (
                          <div key={field.name} className="py-2 flex items-center justify-between gap-2">
                            <Mono className="font-semibold text-foreground">{splitLabel(field.label).en || field.name}</Mono>
                            <Tag tone="primary" className="font-mono text-[10px]">{field.type}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-pass" />
                          适用评测维度
                        </span>
                        <Tag tone="pass">可复用</Tag>
                      </div>
                      <div className="mt-2.5 divide-y text-xs">
                        {currentCap.supportedDimensions.map((dim) => (
                          <div key={dim.key} className="py-2 flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{dim.name}</span>
                            <Tag tone="pass" className="font-mono text-[10px]">{dim.defaultScoreType === 'scale_5' ? '1~5分' : '0/1'}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Input Schema 详表 */}
              {viewTab === 'inputs' && (
                <div className="mt-4 overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <Th>入参键名</Th>
                        <Th>中文名称</Th>
                        <Th>数据类型</Th>
                        <Th>必填</Th>
                        <Th>默认推荐映射</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentCap.inputSchema.map((f) => (
                        <tr key={f.name} className="hover:bg-muted/20">
                          <Td><Mono className="font-semibold text-foreground">{splitLabel(f.label).en || f.name}</Mono></Td>
                          <Td><span className="font-medium">{splitLabel(f.label).zh}</span></Td>
                          <Td><Tag tone="primary" className="font-mono text-[11px]">{f.type}</Tag></Td>
                          <Td>{f.required ? <Tag tone="warn">必填</Tag> : <Tag tone="neutral">可选</Tag>}</Td>
                          <Td><Mono className="text-muted-foreground">{f.defaultMapping || '—'}</Mono></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: 输出维度模板 */}
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
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 4: 执行入口与真实适配器代码 */}
              {viewTab === 'execution' && (
                <div className="mt-4 space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border p-3">
                      <div className="text-muted-foreground text-[11px]">调用协议类型</div>
                      <div className="mt-1 font-mono font-semibold text-foreground flex items-center gap-1.5">
                        <Terminal className="size-3.5 text-primary" />
                        {executionTypeMap[currentCap.executionType]?.label}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3 md:col-span-2">
                      <div className="text-muted-foreground text-[11px]">执行入口 (Target / Endpoint)</div>
                      <div className="mt-1 font-mono font-semibold text-foreground truncate">{currentCap.entrypoint.target}</div>
                    </div>
                  </div>

                  {currentCap.entrypoint.adapterCode ? (
                    <div className="rounded-lg border overflow-hidden">
                      <div className="bg-muted/40 px-3.5 py-2 border-b flex items-center justify-between">
                        <span className="font-mono text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                          <Code2 className="size-3.5 text-primary" />
                          适配器执行逻辑 (Adapter Entrypoint)
                        </span>
                        <Tag tone="neutral">超时: {currentCap.entrypoint.timeoutSec}s</Tag>
                      </div>
                      <pre className="p-3.5 font-mono text-[11px] bg-muted/20 text-foreground overflow-auto max-h-72 leading-relaxed">
                        {currentCap.entrypoint.adapterCode}
                      </pre>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Tab 5: Playground 在线调试 */}
              {viewTab === 'playground' && (
                <div className="mt-4 space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 输入区 */}
                    <div className="space-y-3 rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Play className="size-3.5 text-primary" />
                          调试输入
                        </span>
                        <button
                          type="button"
                          onClick={addPlaygroundRow}
                          className="inline-flex items-center gap-1 rounded border border-dashed border-input px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-primary"
                        >
                          <Plus className="size-3" />
                          添加字段
                        </button>
                      </div>

                      <div className="space-y-2">
                        {playgroundRows.map((row) => (
                          <div key={row.id} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={row.key}
                              placeholder="字段名"
                              onChange={(e) => updatePlaygroundRow(row.id, { key: e.target.value })}
                              className="h-8 w-32 shrink-0 rounded border border-input bg-background px-2 font-mono text-[11px]"
                            />
                            <input
                              type="text"
                              value={row.value}
                              placeholder="值"
                              onChange={(e) => updatePlaygroundRow(row.id, { value: e.target.value })}
                              className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-[11px]"
                            />
                            <button
                              type="button"
                              onClick={() => removePlaygroundRow(row.id)}
                              aria-label={`删除 ${row.key || '字段'}`}
                              className="flex size-8 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:border-fail/40 hover:bg-fail-soft hover:text-fail"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                        {playgroundRows.length === 0 ? (
                          <div className="flex items-center justify-center rounded border border-dashed py-6 text-muted-foreground">
                            <Plus className="size-4 opacity-40" />
                          </div>
                        ) : null}
                      </div>

                      <div className="pt-2 border-t flex justify-end">
                        <Btn variant="primary" size="sm" onClick={runPlaygroundDebug} disabled={isDebugRunning}>
                          <Play className="size-3.5" />
                          {isDebugRunning ? '正在执行...' : '运行调试'}
                        </Btn>
                      </div>
                    </div>

                    {/* 输出响应区 */}
                    <div className="space-y-3 rounded-lg border p-3.5">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-pass" />
                          响应
                        </span>
                        {debugResult ? (
                          <Mono className="text-[11px] text-muted-foreground">{debugResult.latencyMs}ms</Mono>
                        ) : null}
                      </div>

                      {debugResult ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 rounded border border-pass/30 bg-pass-soft px-3 py-2">
                            <CheckCircle2 className="size-4 text-pass" />
                            <span className="text-xs font-semibold text-pass">能力已打通</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(debugResult.metrics).map(([key, val]) => (
                              <div key={key} className="rounded border bg-muted/30 p-2.5">
                                <div className="text-[10px] text-muted-foreground font-mono">{key}</div>
                                <div className="text-base font-bold font-mono text-foreground mt-0.5">
                                  {typeof val === 'boolean' ? (val ? 'TRUE' : 'FALSE') : val}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="rounded bg-muted/40 p-3 space-y-1">
                            <div className="text-[11px] font-semibold text-primary">证据链</div>
                            <p className="text-xs text-foreground leading-relaxed">{debugResult.evidence}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center p-8 text-muted-foreground">
                          <Play className="size-6 opacity-30" />
                        </div>
                      )}
                    </div>
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
  const [code, setCode] = useState('eval.custom.')
  const [category, setCategory] = useState<RegisteredCapability['category']>('custom')
  const [executionType, setExecutionType] = useState<CapabilityExecutionType>('python_adapter')
  const [target, setTarget] = useState('evaluators.custom.adapter:CustomEvaluator')

  const [inputs, setInputs] = useState<CapabilityInputField[]>([
    { name: 'input_text', label: '输入文本', type: 'text', required: true, description: '评测目标文本' },
    { name: 'reference_text', label: '参考标准', type: 'text', required: false, description: '期望对标内容' },
  ])

  const handleAddInput = () => {
    setInputs((prev) => [
      ...prev,
      { name: `param_${prev.length + 1}`, label: `参数 ${prev.length + 1}`, type: 'text', required: true, description: '' },
    ])
  }

  const handleSave = () => {
    if (!name.trim() || !code.trim()) return
    const id = `cap_${Date.now()}`
    const newCap: RegisteredCapability = {
      id,
      code,
      name,
      category,
      version: 'v1.0.0',
      status: 'published',
      author: '当前用户',
      updatedAt: '刚刚',
      intro: name,
      scenario: '',
      tags: ['自定义', executionTypeMap[executionType].label],
      executionType,
      entrypoint: {
        target,
        timeoutSec: 30,
        adapterCode: `# Python 执行入口示例\nclass CustomEvaluator:\n    def evaluate(self, payload: dict) -> dict:\n        return {"score": 5.0, "pass": True}`,
      },
      inputSchema: inputs,
      outputSchema: {
        metrics: [{ key: 'score', name: '综合得分', type: 'score', range: [1, 5], description: '综合质量分' }],
        hasEvidenceChain: true,
        hasArtifactOutput: false,
      },
      supportedDimensions: [
        {
          key: `${code.split('.').pop() || 'custom'}.score`,
          name: `${name}主指标`,
          defaultScoreType: 'scale_5',
          description: '评测主指标',
          requiredInputs: [inputs[0]?.name || 'input_text'],
        },
      ],
      isCustom: true,
    }
    onRegister(newCap)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl p-5 text-xs space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-sm font-bold text-foreground">注册新评测能力</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">能力名称</span>
            <input
              type="text"
              placeholder="例如：长文摘要对齐度评测"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 rounded border px-2.5 bg-background"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">唯一标识码 (Code)</span>
            <input
              type="text"
              placeholder="eval.nlp.summary_check"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-8 rounded border px-2.5 font-mono bg-background"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">执行类型</span>
            <select
              value={executionType}
              onChange={(e) => setExecutionType(e.target.value as CapabilityExecutionType)}
              className="h-8 rounded border px-2 bg-background font-mono"
            >
              <option value="python_adapter">Python 适配器 (Class)</option>
              <option value="http_api">HTTP API Endpoint</option>
              <option value="vlm_judge">VLM 视觉裁判</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">执行入口 (Target / URL)</span>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded border px-2.5 font-mono bg-background"
            />
          </label>
        </div>

        {/* Input Schema 动态添加 */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Input Schema (所需入参字段)</span>
            <button type="button" onClick={handleAddInput} className="text-primary font-medium hover:underline text-[11px]">
              + 添加入参
            </button>
          </div>

          <div className="space-y-2">
            {inputs.map((inp, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  placeholder="入参名 (name)"
                  value={inp.name}
                  onChange={(e) => {
                    const next = [...inputs]
                    next[idx].name = e.target.value
                    setInputs(next)
                  }}
                  className="col-span-4 h-7 rounded border px-2 font-mono bg-background text-[11px]"
                />
                <input
                  type="text"
                  placeholder="中文说明 (label)"
                  value={inp.label}
                  onChange={(e) => {
                    const next = [...inputs]
                    next[idx].label = e.target.value
                    setInputs(next)
                  }}
                  className="col-span-4 h-7 rounded border px-2 bg-background text-[11px]"
                />
                <select
                  value={inp.type}
                  onChange={(e) => {
                    const next = [...inputs]
                    next[idx].type = e.target.value as CapabilityInputField['type']
                    setInputs(next)
                  }}
                  className="col-span-3 h-7 rounded border px-1.5 font-mono bg-background text-[11px]"
                >
                  <option value="text">text</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="json">json</option>
                  <option value="number">number</option>
                </select>
                <button
                  type="button"
                  onClick={() => setInputs(inputs.filter((_, i) => i !== idx))}
                  className="col-span-1 text-muted-foreground hover:text-fail text-center"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Btn variant="outline" size="sm" onClick={onClose}>取消</Btn>
          <Btn variant="primary" size="sm" onClick={handleSave} disabled={!name || !code}>完成注册</Btn>
        </div>
      </div>
    </div>
  )
}
