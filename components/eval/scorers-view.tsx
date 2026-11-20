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
import { ScorerVersionHistory, configToScorerPatch } from './scorer-version-history'
import { useCapabilityRegistry } from '@/lib/eval-capability-store'

type Trial = 'idle' | 'running' | 'passed'

const implLabel = { llm_judge: 'LLM 裁判', script: '脚本', hybrid: '混合' }

const defaultScale5Criteria = {
  score5: '完全符合准绳，逻辑严密，无任何偏差或多余操作',
  score4: '符合核心诉求，略有微小表述或格式瑕疵，不影响使用',
  score3: '基本及格，满足基础功能，但存在部分细节疏漏或理解偏差',
  score2: '未达到预期，存在关键信息遗漏、工具调用错误或偏离主题',
  score1: '严重偏离，完全未解决问题，或产生越权风险与严重幻觉',
}

const emptyDim = {
  key: '',
  name: '',
  gtKey: '',
  release: '0.85',
  capabilityId: 'cap_llm_text',
  scoreType: 'binary' as 'binary' | 'scale_5',
}

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
  const { capabilities } = useCapabilityRegistry()
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

  // 调试台状态（快速单条模式 vs 详细门禁试跑模式）
  const [debugMode, setDebugMode] = useState<'quick' | 'detailed'>('quick')
  const [testCaseId, setTestCaseId] = useState<string>(goldenCases[0]?.id || '')
  const [isDebugging, setIsDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState<{
    score: number
    pass: boolean
    evidence: string
    reason?: string
    latencyMs: number
    timestamp: string
    error?: string
  } | null>(null)

  const s = list.find((x) => x.id === sel) || list[0]
  const currentDim = dims.find((d) => d.key === selectedDimKey)
  const locked = s?.status === 'published'
  const t = trial[s?.id || ''] ?? 'idle'
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(emptyDim)
  const editorRef = useRef<{ insert: (field: string) => void }>(null)

  // 评分标准口径状态（直接作为输入给裁判大模型的依据）
  const [scale5Rubrics, setScale5Rubrics] = useState<Record<string, typeof defaultScale5Criteria>>({})
  const [binaryRubrics, setBinaryRubrics] = useState<Record<string, string>>({})
  const [showAdvancedPrompt, setShowAdvancedPrompt] = useState(false)

  const currentCriteria = scale5Rubrics[selectedDimKey] || defaultScale5Criteria
  const currentBinaryText =
    binaryRubrics[selectedDimKey] ||
    '只要 Agent 回复准确命中核心诉求且未越权即判定为通过(1分)，否则判定为不通过(0分)。'

  const syncRubricToTemplate = (newRubricStr: string) => {
    const parts = (s?.promptTemplate || '').split(/# (?:评测裁判判定准绳|判定准绳|Rubrics)/i)
    const base = parts[0].trim()
    const nextTemplate = `${base}\n\n# 评测裁判判定准绳 (Rubrics)\n${newRubricStr}`
    update({ promptTemplate: nextTemplate })
  }

  // 评分器调试台「运行试跑」：走后端真实裁判 LLM（/api/judges/dry-run，不落库）
  const handleDryRun = async () => {
    setIsDebugging(true)
    setDebugResult(null)
    try {
      const { judgeDryRun } = await import('@/lib/api-client')
      const { caseTurns } = await import('@/lib/case-shape')

      const gc = goldenCases.find((c) => c.id === testCaseId)
      const turns = gc ? caseTurns(gc) : []
      const firstTurn = turns[0]
      const userQuery = firstTurn?.query || gc?.query?.[0] || ''
      // 参考答案：把该轮所有 GT 要点拼成文本
      const groundTruth = (firstTurn?.gt || [])
        .flatMap((g) => g.points)
        .filter(Boolean)
        .join('\n')
      // 调试台没有真实 Agent 回复，用参考答案自测：验证评分器在「回复正确」时能否判 pass
      const agentReply = groundTruth || userQuery

      // 当前评分器的评分标准口径
      const rubric =
        currentDim?.scoreType === 'scale_5'
          ? `# 评分准绳（1~5 分量表）\n5分: ${currentCriteria.score5}\n4分: ${currentCriteria.score4}\n3分: ${currentCriteria.score3}\n2分: ${currentCriteria.score2}\n1分: ${currentCriteria.score1}`
          : currentBinaryText

      const res = await judgeDryRun({
        userQuery,
        groundTruth,
        agentReply,
        rubric,
        dimension: selectedDimKey,
      })

      setDebugResult({
        score: res.score,
        pass: res.pass,
        evidence: res.evidenceAnalysis || res.reason || '（裁判未返回推导过程）',
        reason: res.reason,
        latencyMs: res.latencyMs,
        timestamp: '刚刚',
      })
    } catch (err: any) {
      setDebugResult({
        score: 0,
        pass: false,
        evidence: `试跑失败：${err?.message || String(err)}。请确认后端已启动且 LLM 渠道已配置。`,
        latencyMs: 0,
        timestamp: '刚刚',
        error: err?.message || String(err),
      })
    } finally {
      setIsDebugging(false)
    }
  }


  const usesPrompt = s ? s.implType !== 'script' : false
  const template = s?.promptTemplate ?? (s ? defaultPrompt(s.inputFields) : '')
  const background = s?.background ?? ''
  const refs = usesPrompt ? referencedVars(template) : []
  const keyTaken = dims.some((d) => d.key === draft.key.trim())
  const canAdd = draft.key.trim() && draft.name.trim() && !keyTaken

  const addDim = () => {
    if (!canAdd) return
    const newDimKey = draft.key.trim()
    const newDimName = draft.name.trim()
    const cap = capabilities.find((c) => c.id === draft.capabilityId) || capabilities[0]

    const dim: Dimension = {
      key: newDimKey,
      name: newDimName,
      gtKey: draft.gtKey.trim() || newDimKey,
      scoreType: draft.scoreType,
      thresholds: { release: Number(draft.release) || (draft.scoreType === 'scale_5' ? 4.0 : 0.85), agreement: 0.85, minSamples: 10 },
      enabled: true,
    }

    // 自动为该维度生成/关联对应的执行 Scorer (基于选定的能力底座)
    const newScorerId = `sc_${newDimKey.replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`
    const defaultFields = cap.inputSchema.map((f) => f.name)
    const initialRubric =
      draft.scoreType === 'scale_5'
        ? `# 评测裁判判定准绳 (${newDimName} - 1~5分量表)\n5分: ${defaultScale5Criteria.score5}\n4分: ${defaultScale5Criteria.score4}\n3分: ${defaultScale5Criteria.score3}\n2分: ${defaultScale5Criteria.score2}\n1分: ${defaultScale5Criteria.score1}`
        : `# 评测裁判判定准绳 (${newDimName} - 0/1通过率)\n只要 Agent 回复准确命中用户诉求且未越权即判定为通过(1分)，否则判定为不通过(0分)。`

    const newScorer: Scorer = {
      id: newScorerId,
      name: `${newDimName}评分器`,
      version: 1,
      status: 'draft',
      implType: cap.executionType === 'python_adapter' ? 'script' : 'llm_judge',
      inputFields: defaultFields,
      outputs: [newDimKey],
      promptTemplate: `${defaultPrompt(defaultFields)}\n\n${initialRubric}`,
      background: cap.scenario || '',
      referenceCapabilityId: cap.id,
      updatedAt: '刚刚',
      author: '当前用户',
    }

    setDims((ds) => [...ds, dim])
    setList((ls) => [newScorer, ...ls])
    setSel(newScorerId)
    setSelectedDimKey(newDimKey)
    setDraft(emptyDim)
    setAdding(false)
  }

  const update = (patch: Partial<Scorer>) => setList((l) => l.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))

  // 发布评分器：先把当前草稿固化到后端版本表（不可变、append-only），成功后本地置 published。
  // 后端不可用时降级为纯前端发布，不阻断个人开发联调。
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const handlePublish = async () => {
    if (!s) return
    setPublishing(true)
    setPublishMsg(null)
    try {
      const { publishScorerVersion } = await import('@/lib/api-client')
      const config: Record<string, any> = {
        name: s.name,
        implType: s.implType,
        inputFields: s.inputFields,
        outputs: s.outputs,
        promptTemplate: s.promptTemplate ?? '',
        background: s.background ?? '',
        judgeModel: s.judgeModel ?? '',
        scriptId: s.scriptId ?? '',
        evidenceScript: s.evidenceScript ?? '',
        referenceCapabilityId: s.referenceCapabilityId ?? '',
      }
      const published = await publishScorerVersion({
        scorerId: s.id,
        config,
        version: s.version,
        name: s.name,
        capabilityId: s.referenceCapabilityId ?? '',
        promptVersion: s.promptVersion ?? '',
        trialPassed: true, // 走到这里前端已要求 trial==='passed'
        createdBy: s.createdBy || s.author || '当前用户',
      })
      update({ status: 'published', version: published.version })
      setPublishMsg(`已发布 v${published.version}（已入库）`)
    } catch (err: any) {
      // 后端不可用或版本冲突：降级为本地发布，提示用户
      update({ status: 'published' })
      setPublishMsg(`本地已发布（后端未入库：${err?.message || String(err)}）`)
    } finally {
      setPublishing(false)
    }
  }

  // 从历史版本取回：把后端 config 反填为新草稿（版本号用后端给的 draftVersion），进入可编辑态。
  const handleRestore = (config: Record<string, any>, draftVersion: number) => {
    update({ ...configToScorerPatch(config), status: 'draft', version: draftVersion })
    setTrial((m) => ({ ...m, [s.id]: 'idle' }))
    setPublishMsg(`已取回内容，派生为 v${draftVersion} 草稿，请重新试跑后发布`)
  }



  // 三者强同步：字段勾选 ➔ 提示词自动插入变量并变蓝高亮 ➔ 取消自动清理
  const toggleInputField = (fieldName: string) => {
    if (locked || !s) return
    const isCurrentlyOn = s.inputFields.includes(fieldName)
    const nextFields = isCurrentlyOn
      ? s.inputFields.filter((x) => x !== fieldName)
      : [...s.inputFields, fieldName]

    // 同步更新提示词模版 (promptTemplate)
    let nextTemplate = s.promptTemplate || ''
    const desc = dict.entries.find((e) => e.logicalName === fieldName)?.description
    const snippet = desc ? `## ${fieldName} (${desc})\n{{${fieldName}}}\n` : `## ${fieldName}\n{{${fieldName}}}\n`

    if (isCurrentlyOn) {
      // 取消勾选：从提示词模板中自动清理该变量段落
      const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const reg = new RegExp(`(?:##\\s*${escaped}[^\\n]*\\n+)?\\{\\{\\s*${escaped}\\s*\\}\\}\\n*`, 'g')
      nextTemplate = nextTemplate.replace(reg, '').trim()
    } else {
      // 开启勾选：如果模板中尚未引用该变量，则自动插入
      if (!nextTemplate.includes(`{{${fieldName}}}`)) {
        const rubricMatch = nextTemplate.match(/(# (?:评测裁判判定准绳|判定准绳|Rubrics))/i)
        if (rubricMatch && rubricMatch.index !== undefined) {
          const before = nextTemplate.slice(0, rubricMatch.index).trimEnd()
          const after = nextTemplate.slice(rubricMatch.index)
          nextTemplate = `${before}\n\n${snippet}\n${after}`
        } else {
          nextTemplate = nextTemplate ? `${nextTemplate.trimEnd()}\n\n${snippet}` : snippet
        }
      }
    }

    update({
      inputFields: nextFields,
      promptTemplate: nextTemplate,
    })
  }
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

  const handleImportComplete = (newScorer: Scorer | null, newDims: Dimension[]) => {
    setDims((prevDims) => {
      const existingKeys = new Set(prevDims.map((d) => d.key))
      const toAdd = newDims.filter((d) => !existingKeys.has(d.key))
      return [...prevDims, ...toAdd]
    })
    if (newScorer) {
      setList((prevList) => [newScorer, ...prevList])
      setSel(newScorer.id)
      setSelectedDimKey(newScorer.outputs[0])
    } else if (newDims.length > 0) {
      setSelectedDimKey(newDims[0].key)
    }
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
        </div>

        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
            新建维度 (绑定能力)
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
              className="flex flex-col gap-2.5 border-b bg-accent/30 p-3.5 text-xs"
            >
              <div className="font-semibold text-foreground text-xs border-b pb-1.5 flex items-center justify-between">
                <span>新建评测维度</span>
              </div>

              {/* 绑定能力底座 */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-foreground">绑定评测能力底座</span>
                <select
                  value={draft.capabilityId}
                  onChange={(e) => setDraft({ ...draft, capabilityId: e.target.value })}
                  className="h-8 w-full rounded border border-input bg-card px-2 text-xs font-medium"
                >
                  {capabilities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.executionType === 'llm_judge' ? 'LLM 文本裁判' : c.executionType === 'vlm_judge' ? 'VLM 视觉裁判' : '规则审计'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniInput
                  label="维度名称"
                  value={draft.name}
                  placeholder="如: 意图识别准确率"
                  onChange={(v) => {
                    setDraft({
                      ...draft,
                      name: v,
                      key: draft.key || (v ? `dim_${Date.now().toString().slice(-4)}` : ''),
                    })
                  }}
                  autoFocus
                />
                <MiniInput
                  label="维度唯一标识 (Key)"
                  value={draft.key}
                  placeholder="dim_intent"
                  invalid={keyTaken}
                  onChange={(v) => setDraft({ ...draft, key: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground font-medium">打分制式</span>
                  <select
                    value={draft.scoreType}
                    onChange={(e) => setDraft({ ...draft, scoreType: e.target.value as 'binary' | 'scale_5' })}
                    className="h-7 w-full rounded border border-input bg-card px-2 text-xs font-medium"
                  >
                    <option value="binary">0/1 二元通过率</option>
                    <option value="scale_5">1~5 分量表连续打分</option>
                  </select>
                </div>
                <MiniInput
                  label="发布阈值"
                  value={draft.release}
                  type="number"
                  placeholder={draft.scoreType === 'scale_5' ? '4.0' : '0.85'}
                  onChange={(v) => setDraft({ ...draft, release: v })}
                />
              </div>

              <div className="flex justify-end pt-1 border-t">
                <Btn type="submit" size="sm" variant="primary" disabled={!canAdd}>
                  <Check className="size-3.5" aria-hidden="true" />
                  确认创建
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
                      hasScorer && 'cursor-pointer hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-ring',
                      !d.enabled && 'text-muted-foreground',
                      selected ? 'bg-transparent ring-2 ring-inset ring-primary/40 font-semibold' : 'bg-transparent',
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
              <div className="flex flex-col gap-4">
                {/* 顶部契约预览条 */}
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

                {/* 上半段：左侧标准口径 + 右侧调试台 (左右并排对齐) */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* 左上（6列）：绑定维度、实现方式与评分标准口径 */}
                  <div className="flex flex-col gap-3 lg:col-span-6">
                    <Field label="绑定维度">
                      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-transparent p-2.5">
                        {s.outputs.map((o) => {
                          const d = dims.find((x) => x.key === o)
                          return (
                            <span
                              key={o}
                              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs font-medium text-foreground"
                            >
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

                    {/* 裁判评分标准与判定口径 */}
                    <Field label="裁判评分标准与判定口径">
                      <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-foreground">
                              维度：{currentDim?.name || s.name}
                            </span>
                            <Tag tone={currentDim?.scoreType === 'scale_5' ? 'warn' : 'primary'}>
                              {currentDim?.scoreType === 'scale_5' ? '1~5 分量表' : '0/1 二元通过率'}
                            </Tag>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-[11px] text-muted-foreground">评分制式：</span>
                            <select
                              disabled={locked}
                              value={currentDim?.scoreType || 'binary'}
                              onChange={(e) => {
                                const newType = e.target.value as 'binary' | 'scale_5'
                                setDims((ds) =>
                                  ds.map((d) =>
                                    d.key === selectedDimKey
                                      ? {
                                          ...d,
                                          scoreType: newType,
                                          thresholds: {
                                            ...d.thresholds,
                                            release: newType === 'scale_5' ? 4.0 : 0.85,
                                          },
                                        }
                                      : d
                                  )
                                )
                                const initialStr =
                                  newType === 'scale_5'
                                    ? `5分: ${defaultScale5Criteria.score5}\n4分: ${defaultScale5Criteria.score4}\n3分: ${defaultScale5Criteria.score3}\n2分: ${defaultScale5Criteria.score2}\n1分: ${defaultScale5Criteria.score1}`
                                    : '只要 Agent 回复准确命中核心诉求且未越权即判定为通过(1分)，否则判定为不通过(0分)。'
                                syncRubricToTemplate(initialStr)
                              }}
                              className="h-7 rounded border border-input bg-card px-2 font-medium text-xs"
                            >
                              <option value="binary">0/1 二元通过率</option>
                              <option value="scale_5">1~5 分量表打分</option>
                            </select>
                          </div>
                        </div>

                        {currentDim?.scoreType === 'scale_5' ? (
                          <div className="space-y-1.5">
                            {[
                              { score: '5分', key: 'score5' as const, label: '优秀 (满分)', tone: 'pass' as const },
                              { score: '4分', key: 'score4' as const, label: '良好 (达标)', tone: 'primary' as const },
                              { score: '3分', key: 'score3' as const, label: '及格 (可用)', tone: 'neutral' as const },
                              { score: '2分', key: 'score2' as const, label: '较差 (缺陷)', tone: 'warn' as const },
                              { score: '1分', key: 'score1' as const, label: '极差 (偏离)', tone: 'warn' as const },
                            ].map((item) => (
                              <div
                                key={item.score}
                                className="grid grid-cols-12 gap-2 items-center rounded-lg border bg-card p-1.5 shadow-2xs"
                              >
                                <div className="col-span-3 flex items-center gap-1.5">
                                  <span className="font-bold font-mono text-xs text-foreground">{item.score}</span>
                                  <Tag tone={item.tone} className="text-[10px]">
                                    {item.label}
                                  </Tag>
                                </div>
                                <input
                                  type="text"
                                  disabled={locked}
                                  value={currentCriteria[item.key]}
                                  onChange={(e) => {
                                    const next = { ...currentCriteria, [item.key]: e.target.value }
                                    setScale5Rubrics((prev) => ({ ...prev, [selectedDimKey]: next }))
                                    const rubricStr = `5分: ${next.score5}\n4分: ${next.score4}\n3分: ${next.score3}\n2分: ${next.score2}\n1分: ${next.score1}`
                                    syncRubricToTemplate(rubricStr)
                                  }}
                                  className="col-span-9 h-7 rounded border border-input bg-background px-2 text-xs"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 shadow-2xs">
                            <span className="text-[11px] font-semibold text-foreground">
                              通过 (Pass / 1分) 的裁决口径标准：
                            </span>
                            <textarea
                              rows={3}
                              disabled={locked}
                              value={currentBinaryText}
                              onChange={(e) => {
                                setBinaryRubrics((prev) => ({ ...prev, [selectedDimKey]: e.target.value }))
                                syncRubricToTemplate(e.target.value)
                              }}
                              placeholder="输入裁判判定为 1 分的严格准绳..."
                              className="w-full rounded border border-input bg-background p-2 text-xs leading-relaxed font-mono"
                            />
                          </div>
                        )}
                      </div>
                    </Field>
                  </div>

                  {/* 右上（6列）：评分器调试台 */}
                  <div className="flex flex-col gap-3 lg:col-span-6">
                    <Field label="评分器调试台">
                      <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                        <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                          <div className="flex items-center gap-1 rounded-md border border-input bg-card p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setDebugMode('quick')}
                              className={cn(
                                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors',
                                debugMode === 'quick'
                                  ? 'bg-primary text-primary-foreground shadow-2xs'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              <Play className="size-3" />
                              快速单条模式
                            </button>
                            <button
                              type="button"
                              onClick={() => setDebugMode('detailed')}
                              className={cn(
                                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors',
                                debugMode === 'detailed'
                                  ? 'bg-primary text-primary-foreground shadow-2xs'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              <FlaskConical className="size-3" />
                              详细试跑模式
                            </button>
                          </div>

                          <Tag tone={t === 'passed' ? 'pass' : 'neutral'} className="font-mono text-[10px]">
                            {t === 'passed' ? '门禁校验通过 ✓' : '未完成门禁'}
                          </Tag>
                        </div>

                        {debugMode === 'quick' ? (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground shrink-0">Case:</span>
                              <select
                                value={testCaseId}
                                onChange={(e) => {
                                  setTestCaseId(e.target.value)
                                  setDebugResult(null)
                                }}
                                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 font-mono text-xs text-foreground font-semibold"
                              >
                                {goldenCases.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.id} · {c.query[0]?.slice(0, 20) || '测试样本'}...
                                  </option>
                                ))}
                              </select>

                              <Btn
                                size="sm"
                                variant="primary"
                                disabled={isDebugging}
                                className="shrink-0 h-8"
                                onClick={handleDryRun}
                              >
                                <Play className="size-3" />
                                {isDebugging ? '试跑中...' : '运行试跑'}
                              </Btn>
                            </div>

                            {debugResult && (
                              <div className={cn('flex flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-2xs', debugResult.error ? 'border-fail/40' : debugResult.pass ? 'border-pass/30' : 'border-warn/40')}>
                                <div className="flex items-center justify-between border-b pb-1">
                                  <span className={cn('flex items-center gap-1 font-bold text-xs', debugResult.error ? 'text-fail' : debugResult.pass ? 'text-pass' : 'text-warn')}>
                                    <CheckCircle2 className="size-3.5" />
                                    {debugResult.error ? '试跑失败' : debugResult.pass ? '试跑判定通过 (Pass)' : '试跑判定未通过 (Fail)'}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    耗时 {debugResult.latencyMs}ms
                                  </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded bg-muted/40 p-1">
                                    <span className="text-muted-foreground text-[10px]">score 判定分：</span>
                                    <span className="font-mono font-bold text-foreground ml-1">{debugResult.score}</span>
                                  </div>
                                  <div className="rounded bg-muted/40 p-1">
                                    <span className="text-muted-foreground text-[10px]">pass 状态：</span>
                                    <span className={cn('font-mono font-bold ml-1', debugResult.pass ? 'text-pass' : 'text-fail')}>{debugResult.pass ? 'TRUE' : 'FALSE'}</span>
                                  </div>
                                </div>

                                <div className="rounded bg-muted/30 p-2 text-[11px] leading-relaxed text-foreground">
                                  <span className="font-bold text-muted-foreground block mb-0.5">evidence (证据说明)：</span>
                                  <p>{debugResult.evidence}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                            <div className="flex items-center justify-between">
                              <div className="font-bold text-xs text-foreground flex items-center gap-1.5">
                                <FlaskConical className="size-3.5 text-primary" />
                                详细试跑实验室 (Trial Lab)
                              </div>

                              <Btn size="sm" variant="primary" onClick={() => setLab(true)}>
                                <FlaskConical className="size-3" />
                                开启详细试跑
                              </Btn>
                            </div>

                            {t === 'passed' ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t">
                                <Tag tone="pass" className="gap-1">
                                  <ShieldCheck className="size-3" aria-hidden="true" />
                                  AST 门禁已通过
                                </Tag>
                                <Tag tone="pass">import 语法合规 ✓</Tag>
                                <Tag tone="pass">output_schema 校验通过 ✓</Tag>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </Field>
                  </div>
                </div>

                {/* 下半段：通栏全宽卡片 (左半提示词 + 右半输入字段顶到最右侧) */}
                {usesPrompt ? (
                  <Field label="裁判系统提示词与输入变量">
                    <PromptEditor
                      insertRef={editorRef}
                      template={template}
                      background={background}
                      agentBackground={agentBackground}
                      agentBackgroundVersion={agent?.backgroundVersion ?? 0}
                      model={s.judgeModel ?? judgeModels[0]}
                      promptVersion={
                        s.promptVersion
                          ? s.promptVersion.includes('@')
                            ? s.promptVersion.split('@')[1]
                            : s.promptVersion
                          : `v${s.version}.0`
                      }
                      inputFields={s.inputFields}
                      allFields={dict.names}
                      locked={locked}
                      onChange={update}
                      onToggleField={toggleInputField}
                      onAddField={(f) => toggleInputField(f)}
                    />
                  </Field>
                ) : null}

                {s.implType !== 'llm_judge' ? (
                  <Field label="脚本">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag>
                        <Mono>{s.scriptId ?? 'scorers.new:score'}</Mono>
                      </Tag>
                      <Mono className="text-muted-foreground">#{s.scriptHash ?? '—'}</Mono>
                    </div>
                  </Field>
                ) : null}
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
                    <div className="ml-auto flex items-center gap-2">
                      {publishMsg ? <span className="text-xs text-muted-foreground">{publishMsg}</span> : null}
                      <Btn variant="primary" disabled={t !== 'passed' || publishing} onClick={handlePublish}>
                        <Upload className="size-4" aria-hidden="true" />
                        {publishing ? '发布中…' : '发布评分器'}
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            </Panel>
            <ScorerVersionHistory scorerId={s.id} currentVersion={s.version} onRestore={handleRestore} />
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
