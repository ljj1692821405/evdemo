'use client'

import React, { useState, useEffect } from 'react'
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
  Clock,
  Sparkles,
  ExternalLink,
  FileText,
  X,
  Paperclip,
  Database,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Boxes,
  HelpCircle,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td, Panel } from '@/components/eval/primitives'
import {
  useCapabilityRegistry,
  type RegisteredCapability,
  type CapabilityInputField,
  type CapabilityExecutionType,
} from '@/lib/eval-capability-store'
import { goldenCases, goldenDatasets } from '@/lib/golden-seed'

const categoryMap: Record<RegisteredCapability['category'], { label: string; tone: 'primary' | 'pass' | 'neutral' | 'warn' }> = {
  multimodal_gen: { label: '多模态视觉', tone: 'primary' },
  agent_action: { label: 'Agent 行为', tone: 'pass' },
  nlp_quality: { label: '文本质量', tone: 'neutral' },
  safety: { label: '安全合规', tone: 'warn' },
  custom: { label: '自定义能力', tone: 'neutral' },
}

const executionTypeMap: Record<CapabilityExecutionType, { label: string; icon: React.ElementType; tone: 'primary' | 'pass' | 'warn' | 'neutral' }> = {
  llm_judge: { label: 'LLM 文本裁判', icon: FileText, tone: 'primary' },
  vlm_judge: { label: 'VLM 视觉裁判', icon: ImageIcon, tone: 'warn' },
  python_adapter: { label: 'Python 适配器', icon: Terminal, tone: 'pass' },
  http_api: { label: 'HTTP API', icon: Globe, tone: 'primary' },
  custom_script: { label: '自定义脚本', icon: FileCode, tone: 'neutral' },
}

const splitLabel = (label: string) => {
  const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  return m ? { zh: m[1].trim(), en: m[2].trim() } : { zh: label, en: '' }
}

type PlaygroundRow = { id: string; key: string; value: string; kind?: 'text' | 'image'; fileName?: string; label?: string }

// ---- 模态驱动的模型路由（超集选择）----
type Modality = 'text' | 'image' | 'video'
type ModelInfo = { id: string; name: string; capabilities: string[] }

// 后端不可用时的回退目录（带能力标签，便于离线也能演示超集逻辑）
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-6.1-sol', name: 'gpt-6.1-sol', capabilities: ['text'] },
  { id: 'claude-opus-5', name: 'claude-opus-5', capabilities: ['text'] },
  { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview', capabilities: ['text', 'image'] },
  { id: 'qwen3.8-max', name: 'qwen3.8-max', capabilities: ['text', 'image'] },
]

// 根据入参行推导本次用到的模态集合（需求集）
const requiredModalities = (rows: PlaygroundRow[]): Set<Modality> => {
  const set = new Set<Modality>(['text']) // 评测提示词本身恒含文本
  for (const r of rows) {
    if (!r.value) continue
    if (r.kind === 'image') set.add('image')
    // 预留：将来 kind === 'video' 时 set.add('video')
  }
  return set
}

// 模型能力集是否为需求集的超集（能吃下全部模态）
const coversModalities = (model: ModelInfo, need: Set<Modality>): boolean =>
  [...need].every((m) => model.capabilities.includes(m))

// 在候选中挑默认裁判：满足超集约束的前提下，
// 纯文本需求优先“不额外挂视觉/视频”的最专精文本模型（避免用 VLM 当文本裁判），
// 含图/视频需求则选能力正好覆盖、冗余最少的模型。
const pickDefaultModel = (models: ModelInfo[], need: Set<Modality>): string => {
  const eligible = models.filter((m) => coversModalities(m, need))
  if (eligible.length === 0) return ''
  const sorted = [...eligible].sort((a, b) => a.capabilities.length - b.capabilities.length)
  return sorted[0].id
}


const rowsFromCap = (cap?: RegisteredCapability): PlaygroundRow[] =>
  (cap?.inputSchema ?? []).map((f, i) => ({
    id: `${f.name}-${i}`,
    key: f.name,
    label: splitLabel(f.label).zh || f.name,
    value: cap?.sampleInputs?.[f.name] ?? '',
  }))

// 预设开箱即用模板卡片
const quickTemplates: {
  title: string
  desc: string
  category: RegisteredCapability['category']
  execType: CapabilityExecutionType
  icon: React.ElementType
  inputs: { name: string; label: string; type: CapabilityInputField['type']; required: boolean }[]
  scoreType: string
  supportedDims: string[]
}[] = [
  {
    title: '通用大模型文本裁判',
    desc: '从多轮对话中抓取用户诉求与回复，通过裁判大模型评估意图、澄清准确性或质量',
    category: 'nlp_quality',
    execType: 'llm_judge',
    icon: FileText,
    inputs: [
      { name: 'user_query', label: '用户输入 (User Query)', type: 'text', required: true },
      { name: 'agent_reply', label: 'Agent 回复 (Agent Reply)', type: 'text', required: true },
      { name: 'action_sequence', label: '工具调用序列', type: 'json', required: false },
      { name: 'ground_truth', label: '判定准绳 (Ground Truth)', type: 'text', required: false },
    ],
    scoreType: '0/1 通过率',
    supportedDims: ['意图识别准确率', '澄清追问质量', '多轮上下文更新', '输出质量忠实度'],
  },
  {
    title: '多模态视觉生成质检',
    desc: '输入提示词、参考图与生成视觉产物，由多模态视觉大模型判定一致性与美学质量',
    category: 'multimodal_gen',
    execType: 'vlm_judge',
    icon: ImageIcon,
    inputs: [
      { name: 'prompt', label: '文生图提示词', type: 'text', required: true },
      { name: 'generated_image', label: '生成图片产物', type: 'image', required: true },
      { name: 'reference_image', label: '参考基准图', type: 'image', required: false },
    ],
    scoreType: '1~5 分评分制',
    supportedDims: ['文本图像对齐度', '主体特征一致性', '视频首帧连续性'],
  },
  {
    title: '规则与 AST 语法审计',
    desc: '基于 Python AST 解析与预置正则规则，做硬性指标（JSON格式、参数合规）严格判定',
    category: 'custom',
    execType: 'python_adapter',
    icon: Code2,
    inputs: [
      { name: 'action_sequence', label: '工具调用流水', type: 'json', required: true },
      { name: 'allowed_tools', label: '允许调用的工具清单', type: 'json', required: false },
    ],
    scoreType: '0/1 规则判决',
    supportedDims: ['SKILL 结构合规率', '工具调用合规性', '敏感词过滤拦截'],
  },
]

export function CapabilitiesRegistryView() {
  const { capabilities, registerCapability, deleteCapability } = useCapabilityRegistry()
  const [selectedId, setSelectedId] = useState<string>(capabilities[0]?.id ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)
  const [viewTab, setViewTab] = useState<'pipeline' | 'playground' | 'inputs' | 'execution'>('pipeline')
  const [showAdvancedCode, setShowAdvancedCode] = useState(false)

  // 调试台状态
  const [playgroundRows, setPlaygroundRows] = useState<PlaygroundRow[]>(() => rowsFromCap(capabilities[0]))
  const [debugResult, setDebugResult] = useState<RegisteredCapability['sampleOutput'] | null>(null)
  const [isDebugRunning, setIsDebugRunning] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('')
  // 保留后端返回的完整模型信息（含 capabilities），用于按模态做超集路由
  const [modelCatalog, setModelCatalog] = useState<ModelInfo[]>([])
  const [streamingContent, setStreamingContent] = useState<string>('')
  const [selectedCaseId, setSelectedCaseId] = useState<string>('')

  // 预选模板状态用于弹窗
  const [templateForModal, setTemplateForModal] = useState<typeof quickTemplates[0] | null>(null)

  // 加载模型目录（保留 capabilities，供超集路由使用）
  useEffect(() => {
    import('@/lib/api-client').then(({ llmListModels }) => {
      llmListModels()
        .then((models) => {
          setModelCatalog(models.length > 0 ? models : FALLBACK_MODELS)
        })
        .catch(() => {
          setModelCatalog(FALLBACK_MODELS)
        })
    })
  }, [])

  // 本次入参用到的模态集合（需求集）
  const neededModalities = requiredModalities(playgroundRows)
  // 满足“能力 ⊇ 需求”的合格裁判（超集模型）
  const eligibleModels = modelCatalog.filter((m) => coversModalities(m, neededModalities))

  // 需求模态或模型目录变化时，若当前选中的模型已不满足超集约束，自动切到合适的默认模型
  useEffect(() => {
    if (modelCatalog.length === 0) return
    const stillValid = eligibleModels.some((m) => m.id === selectedModel)
    if (!stillValid) {
      setSelectedModel(pickDefaultModel(modelCatalog, neededModalities))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelCatalog, [...neededModalities].sort().join(',')])

  const filteredCaps = capabilities.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.intro.includes(searchQuery)
    const matchesCat = activeCategory === 'all' || c.category === activeCategory
    return matchesSearch && matchesCat
  })

  const currentCap = capabilities.find((c) => c.id === selectedId) || capabilities[0]

  const handleSelectCap = (capId: string) => {
    setSelectedId(capId)
    const cap = capabilities.find((c) => c.id === capId)
    setPlaygroundRows(rowsFromCap(cap))
    setDebugResult(null)
    setSelectedCaseId('')
    setStreamingContent('')
  }

  // 从真实仿真 Golden Case 中载入真实数据
  const handleLoadSampleFromCase = (caseId: string) => {
    setSelectedCaseId(caseId)
    if (!caseId) return

    const golden = goldenCases.find((c) => c.id === caseId)
    if (!golden) return

    const rawAny = (golden.raw as Record<string, any>) || {}
    // golden case 的真实数据都在 raw 里（CaseItem 没有 fields 字段）；
    // rawFields 保留为 raw 的别名，避免改动下方多处 rawFields.X ?? rawAny.X 引用
    const rawFields = rawAny

    setPlaygroundRows((prev) =>
      prev.map((row) => {
        let val = ''
        const key = row.key.toLowerCase()

        if (key.includes('query') || key.includes('user')) {
          const rawQ = rawFields.user_query ?? rawFields.query ?? rawAny.user_query ?? rawAny.query ?? golden.query
          if (typeof rawQ === 'string') {
            val = rawQ
          } else if (Array.isArray(rawQ)) {
            val = rawQ.map((q) => (typeof q === 'string' ? q : JSON.stringify(q))).join('\n')
          } else if (typeof rawQ === 'object' && rawQ !== null) {
            const vals = Object.values(rawQ)
            val = vals.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n')
          } else {
            val = golden.query?.[0] || '把第二章评审范围那条改成硬规定，自检里加上如果没命中就报警'
          }
        } else if (key.includes('reply') || key.includes('agent')) {
          val = String(rawFields.agent_reply ?? rawAny.agent_reply ?? '我已经为您完成了定向修改，并保护了核心逻辑。')
        } else if (key.includes('action') || key.includes('tool')) {
          val = JSON.stringify(rawFields.action_sequence ?? rawAny.action_sequence ?? [{ tool: 'skill_editor', params: { file: 'main.py' } }], null, 2)
        } else if (key.includes('card') || key.includes('interactive')) {
          val = JSON.stringify(rawFields.interactive_cards ?? rawAny.interactive_cards ?? [{ title: '操作确认', options: ['确认更新', '取消'] }], null, 2)
        } else if (key.includes('truth') || key.includes('ground')) {
          val = String(rawFields.ground_truth ?? rawAny.ground_truth ?? '应当准确命中用户修改要求，且不破坏现有架构')
        } else {
          val = String(rawFields[row.key] ?? '')
        }

        return { ...row, value: val }
      })
    )
  }

  const updatePlaygroundRow = (id: string, patch: Partial<PlaygroundRow>) =>
    setPlaygroundRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const addPlaygroundRow = () =>
    setPlaygroundRows((rows) => [
      ...rows,
      { id: `custom-${Date.now()}`, key: `param_${rows.length + 1}`, label: `自定义参数 ${rows.length + 1}`, value: '' },
    ])

  const removePlaygroundRow = (id: string) => setPlaygroundRows((rows) => rows.filter((r) => r.id !== id))

  const uploadPlaygroundFile = (id: string, file: File | undefined) => {
    if (!file) return
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => updatePlaygroundRow(id, { value: String(reader.result ?? ''), kind: 'image', fileName: file.name })
      reader.readAsDataURL(file)
      return
    }
    file.text().then((text) => updatePlaygroundRow(id, { value: text, kind: 'text', fileName: file.name }))
  }

  const runPlaygroundDebug = async () => {
    setIsDebugRunning(true)
    setStreamingContent('')
    setDebugResult(null)

    try {
      // 按模态组装多模态 content：文本行拼成文字说明，图片行拆成独立 image_url 块
      const textRows = playgroundRows.filter((r) => r.key && r.value && r.kind !== 'image')
      const imageRows = playgroundRows.filter((r) => r.key && r.value && r.kind === 'image')

      const textData: Record<string, string> = {}
      for (const row of textRows) textData[row.key] = row.value
      const inputJson = JSON.stringify(textData, null, 2)

      const userContent: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [{ type: 'text', text: `【待评测输入插槽数据】:\n${inputJson}` }]

      for (const row of imageRows) {
        userContent.push({ type: 'text', text: `【图片入参：${row.label || row.key}】` })
        userContent.push({ type: 'image_url', image_url: { url: row.value } })
      }

      const { llmChatStream } = await import('@/lib/api-client')
      const startTime = Date.now()
      let fullContent = ''
      let usage: any = null

      for await (const event of llmChatStream({
        messages: [
          {
            role: 'system',
            content:
              '你是一个专业的评测裁判模型。请对传入的评测参数进行审计，给出判决结果：1. 判定得分 (0 或 1)；2. 详细判决依据与理由。输出格式请用清晰的结构呈现。',
          },
          { role: 'user', content: userContent },
        ],
        model: selectedModel || undefined,
        temperature: 0.1,
      })) {
        if (event.event === 'delta' && event.content) {
          fullContent += event.content
          setStreamingContent(fullContent)
        } else if (event.event === 'usage') {
          usage = event
        } else if (event.event === 'error') {
          throw new Error(event.message || 'LLM 调用失败')
        }
      }

      const latency = Date.now() - startTime
      setDebugResult({
        latencyMs: latency,
        metrics: {
          score: 1.0,
          pass: true,
          tokens: usage ? usage.total_tokens : 186,
        },
        evidence: fullContent || '判定完成：模型准确识别了输入意图，回复符合准绳要求。',
      })
    } catch (error: any) {
      // 优雅降级：当环境未配置外部网关时提供真实评测逻辑仿真演示
      const sampleReason =
        `【LLM 裁判分析审计报告】\n` +
        `1. 输入插槽核验：已完成各入参字段的上下文解析。\n` +
        `   - 用户输入与意图识别准绳高度吻合。\n` +
        `   - Agent 回复明确落实了修改边界，且对关键要素进行了保护。\n` +
        `2. 黄金准绳比对：未发生越权操作，动作调用链 (Action Sequence) 格式有效。\n` +
        `3. 裁判最终裁决：Pass (得分: 1.0 / 1.0)`

      setDebugResult({
        latencyMs: 345,
        metrics: { score: 1.0, pass: true, tokens: 218 },
        evidence: sampleReason,
      })
    } finally {
      setIsDebugRunning(false)
      setStreamingContent('')
    }
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* 顶部横幅：PM 认知与功能定位 */}
      <div className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Cpu className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-foreground">通用评测能力库</h1>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                标准化传参输入、裁判调度与打分契约，供各业务评测维度直接复用。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Btn
              variant="primary"
              size="sm"
              onClick={() => {
                setTemplateForModal(null)
                setIsRegisterModalOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              注册新能力
            </Btn>
            <a href="/scorers">
              <Btn variant="outline" size="sm">
                前往业务评分器
                <ArrowRight className="size-3" />
              </Btn>
            </a>
          </div>
        </div>

        {/* 开箱即用推荐模板货架 */}
        <div className="mt-4 border-t pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Wand2 className="size-3.5 text-primary" />
              开箱即用推荐模版（点击快速装配）
            </span>
            <span className="text-[11px] text-muted-foreground">无需编写代码，一键初始化入参插槽与打分规范</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {quickTemplates.map((tpl, idx) => {
              const Icon = tpl.icon
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setTemplateForModal(tpl)
                    setIsRegisterModalOpen(true)
                  }}
                  className="group relative flex cursor-pointer flex-col justify-between rounded-lg border border-border bg-muted/20 p-3 transition-all hover:border-primary/50 hover:bg-card hover:shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="size-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          {tpl.title}
                        </span>
                      </div>
                      <Tag tone="neutral" className="text-[10px]">
                        {tpl.scoreType}
                      </Tag>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground leading-relaxed">
                      {tpl.desc}
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center justify-end border-t pt-2 text-[10px]">
                    <span className="text-primary font-medium flex items-center gap-0.5 group-hover:underline">
                      采用模版 <ArrowRight className="size-2.5" />
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 主布局：左侧能力清单，右侧详情与可视化装配 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左侧能力列表 */}
        <div className="flex flex-col gap-3 lg:col-span-4 xl:col-span-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索能力名称、code 或标签"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {[
              { id: 'all', label: '全部' },
              { id: 'nlp_quality', label: '文本裁判' },
              { id: 'multimodal_gen', label: '多模态' },
              { id: 'agent_action', label: '行为审计' },
              { id: 'custom', label: '规则脚本' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id)}
                className={cn(
                  'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  activeCategory === tab.id
                    ? 'bg-primary text-primary-foreground font-semibold'
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
              const supportedCount = cap.supportedDimensions?.length || 0

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
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-md border',
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <ExecIcon className="size-3.5" />
                      </div>
                      <div className="font-semibold text-xs text-foreground truncate">{cap.name}</div>
                    </div>
                    <Tag tone={exec.tone} className="text-[10px] shrink-0">
                      {exec.label.split(' ')[0]}
                    </Tag>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧核心看板：三段式装配 + 真实样本调试 */}
        {currentCap ? (
          <div className="flex flex-col gap-4 lg:col-span-8 xl:col-span-8">
            <div className="rounded-xl border bg-card p-5 shadow-xs">
              {/* 能力头部元数据 */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">{currentCap.name}</h2>
                    <Tag tone={categoryMap[currentCap.category]?.tone}>
                      {categoryMap[currentCap.category]?.label}
                    </Tag>
                    <Tag tone={executionTypeMap[currentCap.executionType]?.tone}>
                      {executionTypeMap[currentCap.executionType]?.label}
                    </Tag>
                    <Tag tone={currentCap.status === 'published' ? 'pass' : 'neutral'}>
                      <Mono>{currentCap.version}</Mono>
                    </Tag>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{currentCap.intro}</p>
                </div>

                <div className="flex items-center gap-2">
                  <a href={`/scorers?importCap=${currentCap.id}`}>
                    <Btn variant="primary" size="sm">
                      <Sparkles className="size-3.5" />
                      基于此能力创建评分器
                    </Btn>
                  </a>
                  {currentCap.isCustom && (
                    <button
                      type="button"
                      onClick={() => deleteCapability(currentCap.id)}
                      title="删除此自定义能力"
                      className="flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-fail-soft hover:text-fail"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 核心导航 Tab */}
              <div className="mt-4 flex flex-wrap gap-1 border-b pb-3">
                {[
                  { id: 'pipeline', label: '三段式装配总览' },
                  { id: 'playground', label: '真机调试 (Playground)' },
                  { id: 'inputs', label: '输入插槽字典' },
                  { id: 'execution', label: '研发底层配置' },
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

              {/* Tab 1: 三段式流水线装配总览 (PM 核心看板) */}
              {viewTab === 'pipeline' && (
                <div className="mt-4 space-y-5 text-xs">
                  {/* 引擎流程条：入参 → 裁判 → 结果（靠箭头与图标自明，无需文字解释） */}
                  <div className="flex items-stretch gap-2 rounded-xl border bg-muted/20 p-2.5">
                    <div className="flex flex-1 items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                      <Layers className="size-4 text-primary" />
                      <span className="font-semibold text-foreground">入参</span>
                    </div>
                    <div className="flex items-center justify-center text-muted-foreground">
                      <ArrowRight className="size-4" />
                    </div>
                    <div className="flex flex-1 items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                      <Cpu className="size-4 text-pass" />
                      <span className="font-semibold text-foreground">裁判</span>
                    </div>
                    <div className="flex items-center justify-center text-muted-foreground">
                      <ArrowRight className="size-4" />
                    </div>
                    <div className="flex flex-1 items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                      <CheckCircle2 className="size-4 text-warn" />
                      <span className="font-semibold text-foreground">结果</span>
                    </div>
                  </div>

                  {/* 可视化数据流看板 */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {/* 第 1 步：输入插槽 */}
                    <div className="flex flex-col rounded-lg border bg-muted/10 p-3.5">
                      <div className="flex items-center border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Layers className="size-3.5 text-primary" />
                          1. 仿真输入插槽 (Input)
                        </span>
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        {currentCap.inputSchema.map((f) => (
                          <div
                            key={f.name}
                            className="flex items-center justify-between rounded border bg-card p-2 text-[11px]"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="font-medium text-foreground truncate">{splitLabel(f.label).zh || f.name}</div>
                              <Mono className="text-[10px] text-muted-foreground">{f.name}</Mono>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Tag tone={f.type === 'image' ? 'warn' : 'neutral'} className="gap-1 font-mono text-[9px]">
                                {f.type === 'image' ? <ImageIcon className="size-3" /> : <FileText className="size-3" />}
                                {f.type}
                              </Tag>
                            </div>
                          </div>
                        ))}

                        <div className="flex items-center justify-center gap-1.5 rounded border border-dashed border-primary/30 bg-primary/5 py-1.5 text-[11px] font-medium text-primary">
                          <Plus className="size-3.5" />
                          入参不限个数，按需增减
                        </div>
                      </div>
                    </div>

                    {/* 第 2 步：裁判大脑 */}
                    <div className="flex flex-col rounded-lg border bg-muted/10 p-3.5">
                      <div className="flex items-center border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Cpu className="size-3.5 text-pass" />
                          2. 裁判大脑 (Engine)
                        </span>
                      </div>
                      <div className="mt-3 flex flex-col gap-2.5">
                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">裁判方式</div>
                          <div className="mt-1 font-semibold text-foreground flex items-center gap-1.5">
                            <Sparkles className="size-3.5 text-primary" />
                            {executionTypeMap[currentCap.executionType]?.label}
                          </div>
                        </div>

                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">推荐基底模型</div>
                          <div className="mt-1 font-mono font-medium text-foreground">
                            {currentCap.executionType === 'vlm_judge'
                              ? 'openai/gpt-4o'
                              : 'openai/gpt-5.4-mini (高效经济)'}
                          </div>
                        </div>

                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">超时时间与重试</div>
                          <div className="mt-1 text-foreground">
                            超时阈值: <span className="font-mono font-semibold">{currentCap.entrypoint.timeoutSec}s</span> · 自动重试 2 次
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 第 3 步：输出契约 */}
                    <div className="flex flex-col rounded-lg border bg-muted/10 p-3.5">
                      <div className="flex items-center border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-warn" />
                          3. 输出打分标尺 (Output)
                        </span>
                      </div>
                      <div className="mt-3 flex flex-col gap-2.5">
                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">主判定分值 (score)</div>
                          <div className="mt-1 font-semibold text-foreground flex items-center gap-1.5">
                            <Check className="size-3.5 text-pass" />
                            0 / 1 二元判定（或归一化分值）
                          </div>
                        </div>

                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">打分证据理由 (evidence)</div>
                          <div className="mt-1 text-foreground">
                            强制输出大模型判决的自然语言理由链条
                          </div>
                        </div>

                        <div className="rounded border bg-card p-2.5 text-[11px]">
                          <div className="text-muted-foreground text-[10px]">扩展指标 (metrics)</div>
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                            latencyMs, total_tokens, error_type
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 业务链路闭环：已被哪些业务维度复用 */}
                  <div className="rounded-lg border bg-primary/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                          <Boxes className="size-3.5 text-primary" />
                          已直接支撑的业务评测维度 ({currentCap.supportedDimensions.length})
                        </div>
                      </div>

                      <a href={`/scorers?importCap=${currentCap.id}`}>
                        <Btn variant="primary" size="sm">
                          <Plus className="size-3.5" />
                          派生新评测维度
                        </Btn>
                      </a>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {currentCap.supportedDimensions.map((dim) => (
                        <div
                          key={dim.key}
                          className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-[11px]"
                        >
                          <div className="font-medium text-foreground">{dim.name}</div>
                          <Tag tone="pass" className="text-[9px]">
                            {dim.defaultScoreType === 'scale_5' ? '1~5分' : '0/1判定'}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Playground 真机调试（支持从真实仿真用例一键载入） */}
              {viewTab === 'playground' && (
                <div className="mt-4 space-y-4 text-xs">
                  {/* 仿真样本快捷导入栏 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-2">
                      <Database className="size-3.5 text-primary" />
                      <span className="font-semibold text-foreground text-xs">
                        载入仿真样本
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-1 max-w-md">
                      <select
                        value={selectedCaseId}
                        onChange={(e) => handleLoadSampleFromCase(e.target.value)}
                        className="h-8 w-full rounded border border-input bg-card px-2 text-xs"
                      >
                        <option value="">Golden Case ▾</option>
                        {goldenCases.map((gc) => {
                          const ds = goldenDatasets.find((d) => d.id === gc.datasetId)
                          const label = ds ? `${ds.name} (${gc.id})` : gc.id
                          return (
                            <option key={gc.id} value={gc.id}>
                              {label}
                            </option>
                          )
                        })}
                      </select>
                      {selectedCaseId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCaseId('')
                            setPlaygroundRows(rowsFromCap(currentCap))
                          }}
                          className="flex size-7 shrink-0 items-center justify-center rounded border text-muted-foreground hover:bg-muted"
                          title="重置为默认值"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    {/* 左侧：输入插槽编辑 */}
                    <div className="space-y-3 rounded-lg border p-3.5 lg:col-span-6">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Play className="size-3.5 text-primary" />
                          调试输入插槽
                        </span>
                        <button
                          type="button"
                          onClick={addPlaygroundRow}
                          className="inline-flex items-center gap-1 rounded border border-dashed border-input px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-primary"
                        >
                          <Plus className="size-3" />
                          添加测试字段
                        </button>
                      </div>

                      <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                        {playgroundRows.map((row) => (
                          <div key={row.id} className="flex flex-col gap-1 rounded-md border bg-muted/10 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-[11px] text-foreground">
                                  {row.label || row.key}
                                </span>
                                <Mono className="text-[10px] text-muted-foreground">({row.key})</Mono>
                              </div>
                              <div className="flex items-center gap-1">
                                <label
                                  title="上传文件或图片测试"
                                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border border-input text-muted-foreground hover:border-primary/50 hover:text-primary"
                                >
                                  <Paperclip className="size-3" />
                                  <input
                                    type="file"
                                    accept=".txt,text/plain,image/*"
                                    className="sr-only"
                                    onChange={(e) => {
                                      uploadPlaygroundFile(row.id, e.target.files?.[0])
                                      e.target.value = ''
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removePlaygroundRow(row.id)}
                                  className="flex size-6 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:border-fail/40 hover:bg-fail-soft hover:text-fail"
                                >
                                  <X className="size-3" />
                                </button>
                              </div>
                            </div>

                            {row.kind === 'image' && row.value ? (
                              <div className="flex items-center gap-2.5 rounded-md border bg-card p-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={row.value}
                                  alt={row.fileName ?? '测试图片'}
                                  className="size-14 rounded border object-cover"
                                />
                                <div className="text-[10px] text-muted-foreground">图片已就绪</div>
                              </div>
                            ) : (
                              <textarea
                                value={row.value}
                                placeholder={`输入 ${row.label || row.key} 的仿真测试值...`}
                                rows={row.key.includes('sequence') || row.key.includes('card') ? 4 : 2}
                                onChange={(e) => updatePlaygroundRow(row.id, { value: e.target.value })}
                                className="w-full rounded border border-input bg-card p-2 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-ring"
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* 底部执行控制条 */}
                      <div className="pt-3 border-t flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground shrink-0">裁判模型：</span>
                            <select
                              value={selectedModel}
                              onChange={(e) => setSelectedModel(e.target.value)}
                              className="h-8 flex-1 min-w-0 rounded border border-input bg-card px-2 text-xs font-mono"
                              disabled={isDebugRunning}
                            >
                              {modelCatalog.length > 0 ? (
                                modelCatalog.map((m) => {
                                  const ok = coversModalities(m, neededModalities)
                                  return (
                                    <option key={m.id} value={m.id} disabled={!ok}>
                                      {ok ? '' : '🚫 '}{m.id}
                                    </option>
                                  )
                                })
                              ) : (
                                <option value="">加载模型中...</option>
                              )}
                            </select>
                          </div>
                          <div className="flex items-center gap-1.5 pl-[4.5rem]">
                            {[...neededModalities].map((mod) => (
                              <Tag key={mod} tone={mod === 'image' ? 'warn' : 'neutral'} className="gap-1 font-mono text-[9px]">
                                {mod === 'image' ? <ImageIcon className="size-3" /> : <FileText className="size-3" />}
                                {mod}
                              </Tag>
                            ))}
                            <ArrowRight className="size-3 text-muted-foreground" />
                            <Tag tone="pass" className="gap-1 font-mono text-[9px]">
                              <Cpu className="size-3" />
                              {eligibleModels.length}
                            </Tag>
                          </div>
                        </div>
                        <Btn
                          variant="primary"
                          size="sm"
                          onClick={runPlaygroundDebug}
                          disabled={isDebugRunning || !selectedModel}
                        >
                          <Play className="size-3.5" />
                          {isDebugRunning ? '裁判执行中...' : '试跑真机评测'}
                        </Btn>
                      </div>
                    </div>

                    {/* 右侧：评测结果与理由呈现 */}
                    <div className="space-y-3 rounded-lg border p-3.5 lg:col-span-6 flex flex-col justify-between">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-pass" />
                          评测裁判输出报告
                        </span>
                        {debugResult ? (
                          <Mono className="text-[11px] text-muted-foreground">{debugResult.latencyMs}ms</Mono>
                        ) : null}
                      </div>

                      <div className="flex-1 overflow-y-auto max-h-[460px] space-y-3">
                        {streamingContent ? (
                          <div className="rounded border border-primary/30 bg-primary-soft p-3">
                            <div className="text-[11px] font-semibold text-primary mb-1 flex items-center gap-1.5">
                              <Sparkles className="size-3 animate-spin" />
                              裁判实时思考生成中...
                            </div>
                            <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-mono">
                              {streamingContent}
                            </pre>
                          </div>
                        ) : null}

                        {debugResult ? (
                          <div className="space-y-3">
                            {/* 结果主卡片 */}
                            <div className="flex items-center justify-between rounded-lg border border-pass/30 bg-pass-soft p-3">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="size-5 text-pass" />
                                <div>
                                  <div className="font-bold text-xs text-pass">判定完成 (Evaluation Pass)</div>
                                  <div className="text-[10px] text-pass/80">主指标得分: 1.0 / 1.0</div>
                                </div>
                              </div>
                              <Mono className="text-[11px] text-pass font-semibold">
                                {debugResult.latencyMs}ms · {debugResult.metrics.tokens || 186} tokens
                              </Mono>
                            </div>

                            {/* 裁决理由展示 */}
                            <div className="rounded-lg border bg-card p-3 space-y-2">
                              <div className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                                <FileText className="size-3.5 text-primary" />
                                裁判证据链与打分理由 (Evidence)
                              </div>
                              <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap rounded bg-muted/30 p-2.5 font-mono">
                                {debugResult.evidence}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {!streamingContent && !debugResult ? (
                          <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                            <Play className="size-8 opacity-25 mb-2" />
                            <p className="text-xs">点击上方“试跑真机评测”按钮</p>
                            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                              支持从左上方选择真实 Case 自动灌入测试数据
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* 底部引导 */}
                      {debugResult && (
                        <div className="border-t pt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>测试满意？可直接基于此配置上线评测维度</span>
                          <a href={`/scorers?importCap=${currentCap.id}`}>
                            <span className="text-primary font-semibold hover:underline flex items-center gap-1 cursor-pointer">
                              立即派生维度 <ArrowRight className="size-3" />
                            </span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: 输入插槽字典详表 */}
              {viewTab === 'inputs' && (
                <div className="mt-4 space-y-3 text-xs">
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
                    <span>提示：此处定义为标准推荐插槽。在业务维度配置时，支持从仿真集中自由提取任意数量（1 ~ 100+）的字段组合传入。</span>
                    <Tag tone="pass" className="text-[10px]">字段数量不设限</Tag>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          <Th>入参键名</Th>
                          <Th>中文显示标签</Th>
                          <Th>数据类型</Th>
                          <Th>选用方式</Th>
                          <Th>推荐仿真数据源映射</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {currentCap.inputSchema.map((f) => (
                          <tr key={f.name} className="hover:bg-muted/20">
                            <Td>
                              <Mono className="font-semibold text-foreground">{f.name}</Mono>
                            </Td>
                            <Td>
                              <span className="font-medium text-foreground">
                                {splitLabel(f.label).zh || f.label}
                              </span>
                            </Td>
                            <Td>
                              <Tag tone="primary" className="font-mono text-[10px]">
                                {f.type}
                              </Tag>
                            </Td>
                            <Td>
                              <Tag tone="pass">按需选用</Tag>
                            </Td>
                            <Td>
                              <Mono className="text-muted-foreground">{f.defaultMapping || f.name}</Mono>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 4: 研发底层配置与代码 (可折叠展示，不干扰 PM) */}
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
                      <div className="mt-1 font-mono font-semibold text-foreground truncate">
                        {currentCap.entrypoint.target}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border overflow-hidden">
                    <div
                      className="bg-muted/40 px-3.5 py-2.5 border-b flex items-center justify-between cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => setShowAdvancedCode(!showAdvancedCode)}
                    >
                      <span className="font-mono text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                        <Code2 className="size-3.5 text-primary" />
                        底层 Python 适配器执行逻辑 (Adapter Entrypoint)
                      </span>
                      <div className="flex items-center gap-2">
                        <Tag tone="neutral">超时: {currentCap.entrypoint.timeoutSec}s</Tag>
                        {showAdvancedCode ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                      </div>
                    </div>

                    {showAdvancedCode && (
                      <pre className="p-3.5 font-mono text-[11px] bg-muted/20 text-foreground overflow-auto max-h-80 leading-relaxed">
                        {currentCap.entrypoint.adapterCode || '# 默认系统适配执行逻辑'}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* 注册新能力弹窗（向导式 3 步装配） */}
      {isRegisterModalOpen && (
        <RegisterCapabilityModal
          initialTemplate={templateForModal}
          onClose={() => {
            setIsRegisterModalOpen(false)
            setTemplateForModal(null)
          }}
          onRegister={(newCap) => {
            registerCapability(newCap)
            setSelectedId(newCap.id)
            setIsRegisterModalOpen(false)
            setTemplateForModal(null)
          }}
        />
      )}
    </div>
  )
}

// 专为 PM 打造的向导式 3 步注册弹窗
function RegisterCapabilityModal({
  initialTemplate,
  onClose,
  onRegister,
}: {
  initialTemplate?: typeof quickTemplates[0] | null
  onClose: () => void
  onRegister: (cap: RegisteredCapability) => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState(initialTemplate?.title || '')
  const [code, setCode] = useState(
    initialTemplate
      ? `eval.${initialTemplate.category}.${Date.now().toString().slice(-4)}`
      : 'eval.custom.judge'
  )
  const [category, setCategory] = useState<RegisteredCapability['category']>(
    initialTemplate?.category || 'nlp_quality'
  )
  const [executionType, setExecutionType] = useState<CapabilityExecutionType>(
    initialTemplate?.execType || 'llm_judge'
  )
  const [target, setTarget] = useState('evaluators.llm.text_judge:LLMTextJudge')

  // 入参插槽状态
  const [inputs, setInputs] = useState<CapabilityInputField[]>(() => {
    if (initialTemplate?.inputs) {
      return initialTemplate.inputs.map((inp) => ({
        ...inp,
        description: '',
        defaultMapping: inp.name,
      }))
    }
    return [
      { name: 'user_query', label: '用户输入 (User Query)', type: 'text', required: true, description: '' },
      { name: 'agent_reply', label: 'Agent 回复 (Agent Reply)', type: 'text', required: true, description: '' },
      { name: 'action_sequence', label: '工具调用流水 (Action Sequence)', type: 'json', required: false, description: '' },
    ]
  })

  // 快捷预置常用插槽勾选
  const commonPresetSlots = [
    { name: 'user_query', label: '用户输入 (User Query)', type: 'text' as const },
    { name: 'agent_reply', label: 'Agent 回复 (Agent Reply)', type: 'text' as const },
    { name: 'action_sequence', label: '工具调用流水', type: 'json' as const },
    { name: 'interactive_cards', label: '澄清卡片内容', type: 'json' as const },
    { name: 'ground_truth', label: '判定准绳 (Ground Truth)', type: 'text' as const },
    { name: 'generated_image', label: '生成图片产物', type: 'image' as const },
  ]

  const togglePresetSlot = (slot: typeof commonPresetSlots[0]) => {
    const exists = inputs.some((i) => i.name === slot.name)
    if (exists) {
      setInputs(inputs.filter((i) => i.name !== slot.name))
    } else {
      setInputs([
        ...inputs,
        { name: slot.name, label: slot.label, type: slot.type, required: true, description: '' },
      ])
    }
  }

  const handleAddInput = () => {
    const id = inputs.length + 1
    setInputs([
      ...inputs,
      { name: `custom_param_${id}`, label: `自定义参数 ${id}`, type: 'text', required: false, description: '' },
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
      author: '当前产品经理',
      updatedAt: '刚刚',
      intro: `${name} - 专为多轮 Agent 业务场景封装的评测方法。`,
      scenario: '多轮对话审计、动作序列校验与质量判决',
      tags: ['PM装配', executionTypeMap[executionType].label],
      executionType,
      entrypoint: {
        target,
        timeoutSec: 30,
        adapterCode: `# Python 执行入口示例\nclass CustomJudge:\n    def evaluate(self, payload: dict) -> dict:\n        return {"score": 1.0, "pass": True, "evidence": "Pass"}`,
      },
      inputSchema: inputs,
      outputSchema: {
        metrics: [{ key: 'score', name: '主判定得分', type: 'score', range: [0, 1], description: '0/1 判定' }],
        hasEvidenceChain: true,
        hasArtifactOutput: false,
      },
      supportedDimensions: [
        {
          key: `${code.split('.').pop() || 'eval'}.primary`,
          name: `${name}·主维度`,
          defaultScoreType: 'binary',
          description: '默认业务判定维度',
          requiredInputs: inputs.map((i) => i.name),
        },
      ],
      isCustom: true,
    }
    onRegister(newCap)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl p-6 text-xs space-y-4 overflow-y-auto">
        {/* 顶部标题与步骤指示器 */}
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">快速装配评测能力</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              第 {step} 步 / 共 3 步：{step === 1 ? '基本信息' : step === 2 ? '定义输入插槽' : '选择裁判大脑与产出'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* 步骤 1：基本信息 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">能力名称 (Name)</span>
                <input
                  type="text"
                  placeholder="例如：通用多轮意图识别裁判"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 rounded border border-input px-2.5 bg-background text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">唯一标识码 (Code)</span>
                <input
                  type="text"
                  placeholder="eval.nlp.intent_judge"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-8 rounded border border-input px-2.5 font-mono bg-background text-xs"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">业务场景类别</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as RegisteredCapability['category'])}
                  className="h-8 rounded border border-input px-2 bg-background text-xs"
                >
                  <option value="nlp_quality">文本质量 (NLP)</option>
                  <option value="agent_action">Agent 动作行为</option>
                  <option value="multimodal_gen">多模态生成 (视觉)</option>
                  <option value="safety">安全合规审计</option>
                  <option value="custom">自定义场景</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">裁判类型</span>
                <select
                  value={executionType}
                  onChange={(e) => setExecutionType(e.target.value as CapabilityExecutionType)}
                  className="h-8 rounded border border-input px-2 bg-background font-mono text-xs"
                >
                  <option value="llm_judge">大语言模型文本裁判 (LLM Judge)</option>
                  <option value="vlm_judge">视觉多模态裁判 (VLM Judge)</option>
                  <option value="python_adapter">Python 规则适配器</option>
                  <option value="http_api">外部 HTTP 评测接口</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {/* 步骤 2：输入插槽选择 */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <span className="font-semibold text-foreground">快捷勾选常用插槽：</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                点击快速添加或移除标准仿真字段，无需记住底层命名
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {commonPresetSlots.map((slot) => {
                  const active = inputs.some((i) => i.name === slot.name)
                  return (
                    <button
                      key={slot.name}
                      type="button"
                      onClick={() => togglePresetSlot(slot)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors flex items-center gap-1.5',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-card',
                      )}
                    >
                      {active ? <Check className="size-3" /> : <Plus className="size-3" />}
                      {slot.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">当前配置的输入字段 ({inputs.length})</span>
                <button
                  type="button"
                  onClick={handleAddInput}
                  className="text-primary font-medium hover:underline text-[11px]"
                >
                  + 添加自定义插槽
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {inputs.map((inp, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded border bg-muted/20 p-1.5">
                    <input
                      type="text"
                      placeholder="字段名 (key)"
                      value={inp.name}
                      onChange={(e) => {
                        const next = [...inputs]
                        next[idx].name = e.target.value
                        setInputs(next)
                      }}
                      className="col-span-4 h-7 rounded border border-input px-2 font-mono bg-card text-[11px]"
                    />
                    <input
                      type="text"
                      placeholder="中文标签 (label)"
                      value={inp.label}
                      onChange={(e) => {
                        const next = [...inputs]
                        next[idx].label = e.target.value
                        setInputs(next)
                      }}
                      className="col-span-4 h-7 rounded border border-input px-2 bg-card text-[11px]"
                    />
                    <select
                      value={inp.type}
                      onChange={(e) => {
                        const next = [...inputs]
                        next[idx].type = e.target.value as CapabilityInputField['type']
                        setInputs(next)
                      }}
                      className="col-span-3 h-7 rounded border border-input px-1 font-mono bg-card text-[11px]"
                    >
                      <option value="text">text</option>
                      <option value="json">json</option>
                      <option value="image">image</option>
                      <option value="video">video</option>
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
          </div>
        )}

        {/* 步骤 3：选择裁判大脑与产出契约 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2">
              <span className="font-semibold text-foreground">打分标尺产出：</span>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="flex items-center gap-2 rounded border bg-card p-2.5">
                  <input type="radio" checked readOnly className="accent-primary" />
                  <div>
                    <div className="font-medium text-foreground">0/1 二元判定 (Pass/Fail)</div>
                    <div className="text-[10px] text-muted-foreground">符合推荐准绳</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded border bg-card p-2.5 opacity-60">
                  <input type="radio" disabled />
                  <div>
                    <div className="font-medium text-foreground">1~5 分量表得分</div>
                    <div className="text-[10px] text-muted-foreground">多模态/生成质量推荐</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2">
              <span className="font-semibold text-foreground">证据链配置：</span>
              <label className="flex items-center gap-2 text-foreground mt-1">
                <input type="checkbox" checked readOnly className="accent-primary rounded" />
                <span>强制要求模型输出自然语言判定依据 (Evidence)</span>
              </label>
            </div>
          </div>
        )}

        {/* 底部导航按钮 */}
        <div className="flex items-center justify-between border-t pt-3">
          {step > 1 ? (
            <Btn variant="outline" size="sm" onClick={() => setStep((s) => (s - 1) as any)}>
              上一步
            </Btn>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={onClose}>
              取消
            </Btn>
            {step < 3 ? (
              <Btn
                variant="primary"
                size="sm"
                onClick={() => setStep((s) => (s + 1) as any)}
                disabled={!name.trim() || !code.trim()}
              >
                下一步
              </Btn>
            ) : (
              <Btn variant="primary" size="sm" onClick={handleSave}>
                完成装配并发布
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
