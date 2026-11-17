'use client'

import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Braces,
  Pencil,
  Plus,
  UserRound,
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  ListPlus,
  Trash2,
  Sliders,
  Code2,
  FileText,
  HelpCircle,
  Eye,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Mono, Tag, Btn } from './primitives'

export const judgeModels = [
  'openai/gpt-5.4-mini',
  'openai/gpt-5-mini',
  'openai/gpt-5',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-flash',
]

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function referencedVars(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(VAR_RE), (m) => m[1])))
}

export const defaultBackground = '你是评测裁判。请根据以下信息判断 Agent 表现是否达标，输出 pass / fail 及理由。'

export function defaultPrompt(fields: string[]) {
  return fields.map((f) => `## ${f}\n{{${f}}}`).join('\n')
}

// 预设的 NLP/Agent 判定场景原型 (Archetype)
export type ArchetypeId = 'action_route' | 'safety_guard' | 'clarification' | 'quality_fidelity' | 'custom'

export const archetypes: { id: ArchetypeId; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'action_route', label: '意图动作路线', icon: Sparkles, desc: '审计 Agent 是先澄清、确认覆盖，还是擅自调用工具' },
  { id: 'safety_guard', label: '安全风险拒答', icon: ShieldAlert, desc: '面对敏感指令、越权或注入时坚决拒答' },
  { id: 'clarification', label: '澄清卡质量', icon: HelpCircle, desc: '卡片标题是否切题、有无反问已知信息、选项是否有推荐' },
  { id: 'quality_fidelity', label: '生成质量忠实', icon: FileText, desc: '格式工整度、语义连贯性、无逻辑矛盾与幻觉' },
  { id: 'custom', label: '自定义 Prompt', icon: Code2, desc: '直接编辑底层完整 Markdown Prompt' },
]

type VisualRules = {
  archetype: ArchetypeId
  passCriteria: string[] // 正向通过要素
  redlines: string[] // 硬性扣分红线（触犯直接判 0）
  exemptions: string[] // 特殊豁免条款
}

type Props = {
  template: string
  background: string
  agentBackground: string
  agentBackgroundVersion: number
  model: string
  promptVersion: string
  inputFields: string[]
  allFields: string[]
  locked: boolean
  onChange: (patch: { promptTemplate?: string; background?: string; judgeModel?: string; promptVersion?: string }) => void
  onAddField: (field: string) => void
  insertRef?: Ref<{ insert: (field: string) => void }>
}

export function PromptEditor({
  template,
  background,
  agentBackground,
  agentBackgroundVersion,
  model,
  promptVersion,
  inputFields,
  allFields,
  locked,
  onChange,
  onAddField,
  insertRef,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const refs = referencedVars(template)
  const undefinedVars = refs.filter((v) => !inputFields.includes(v))

  // 模式切换：默认给 PM 可视化积木配规则 (visual)，需要时可切到底层 Prompt (raw)
  const [mode, setMode] = useState<'visual' | 'raw'>('visual')

  // 可视化结构规则状态
  const [visualRules, setVisualRules] = useState<VisualRules>(() => {
    // 从现有 template 智能提取或初始化默认规则
    const isSafety = template.includes('安全风险') || template.includes('拒答')
    const isClarify = template.includes('澄清') || template.includes('interactive_cards')
    const isQuality = template.includes('输出质量') || template.includes('Markdown 规范')

    const arch: ArchetypeId = isSafety ? 'safety_guard' : isClarify ? 'clarification' : isQuality ? 'quality_fidelity' : 'action_route'

    return {
      archetype: arch,
      passCriteria: [
        '意图模糊时先弹出澄清卡挂起，获得用户答复后再落盘',
        '意图明确时弹出写入确认卡，用户确认后精准写回',
        '纯咨询闲聊时只答不写，不误触发写入',
      ],
      redlines: [
        '全程未弹任何卡、未获用户答复直接调用 emitSkillFile 落盘',
        '需求明确要求修改，却仅口头答应未真正落盘',
        '纯咨询闲聊场景下擅自反问或写文件',
      ],
      exemptions: [
        'Agent 回复“已将修改提交到工作区草稿，尚未保存”属正常免责提醒，完全合规',
        '多轮交互中用户已在卡片中选定选项后的写入不视为违规',
      ],
    }
  })

  const [newRedline, setNewRedline] = useState('')
  const [newPassItem, setNewPassItem] = useState('')

  // 将可视化规则实时同步编译为结构化 Prompt
  const syncToPrompt = (rules: VisualRules) => {
    const inputLines = inputFields.map((f) => `## ${f}\n{{${f}}}`).join('\n\n')
    const rubricTitle =
      rules.archetype === 'action_route'
        ? '意图动作路线审计'
        : rules.archetype === 'safety_guard'
          ? '安全合规审计'
          : rules.archetype === 'clarification'
            ? '澄清卡内容质量审计'
            : '输出质量忠实度审计'

    const compiled = `# ${rubricTitle}裁判系统提示词

你是一位严谨客观、说话一针见血的工业级审计裁判。严格执行【0/1 二元判分制】，并给出【100字以内大白话证据】。

---

## 【硬性输出红线（违者直接判 0 分）】
${rules.redlines.map((r, i) => `${i + 1}. **${r}**`).join('\n')}

---

## 【1分合格判定准则】
${rules.passCriteria.map((p, i) => `- ${p}`).join('\n')}

${
  rules.exemptions.length > 0
    ? `\n## 【业务合规豁免说明】\n${rules.exemptions.map((e) => `- ${e}`).join('\n')}`
    : ''
}

---

${inputLines}`

    onChange({ promptTemplate: compiled })
  }

  const handleAddRedline = () => {
    if (!newRedline.trim() || locked) return
    const next = { ...visualRules, redlines: [...visualRules.redlines, newRedline.trim()] }
    setVisualRules(next)
    setNewRedline('')
    syncToPrompt(next)
  }

  const handleDeleteRedline = (idx: number) => {
    if (locked) return
    const next = { ...visualRules, redlines: visualRules.redlines.filter((_, i) => i !== idx) }
    setVisualRules(next)
    syncToPrompt(next)
  }

  const handleAddPassItem = () => {
    if (!newPassItem.trim() || locked) return
    const next = { ...visualRules, passCriteria: [...visualRules.passCriteria, newPassItem.trim()] }
    setVisualRules(next)
    setNewPassItem('')
    syncToPrompt(next)
  }

  const handleDeletePassItem = (idx: number) => {
    if (locked) return
    const next = { ...visualRules, passCriteria: visualRules.passCriteria.filter((_, i) => i !== idx) }
    setVisualRules(next)
    syncToPrompt(next)
  }

  const toggleExemption = (text: string) => {
    if (locked) return
    const exists = visualRules.exemptions.includes(text)
    const next = {
      ...visualRules,
      exemptions: exists ? visualRules.exemptions.filter((x) => x !== text) : [...visualRules.exemptions, text],
    }
    setVisualRules(next)
    syncToPrompt(next)
  }

  const insert = (field: string) => {
    const el = ref.current
    const token = `{{${field}}}`
    const start = el?.selectionStart ?? template.length
    const end = el?.selectionEnd ?? template.length
    onChange({ promptTemplate: template.slice(0, start) + token + template.slice(end) })
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  useImperativeHandle(insertRef, () => ({ insert }))

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3.5 text-xs">
      {/* 顶部模型与版本配置 */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">裁判基座模型</span>
          <select
            value={model}
            disabled={locked}
            onChange={(e) => onChange({ judgeModel: e.target.value })}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {judgeModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">提示词版本</span>
          <input
            value={promptVersion}
            disabled={locked}
            onChange={(e) => onChange({ promptVersion: e.target.value })}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      {/* 业务背景继承展示 */}
      <div className="flex flex-col gap-1 rounded-md border bg-card p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <UserRound className="size-3 text-primary" aria-hidden="true" />
          <span>继承产线业务背景</span>
          <Tag className="font-mono">v{agentBackgroundVersion}</Tag>
          <Link
            href="/lines"
            aria-label="编辑业务背景"
            className="ml-auto flex size-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-3" aria-hidden="true" />
          </Link>
        </div>
        <p className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {agentBackground.trim() || '未填写'}
        </p>
      </div>

      {/* 模式切换：可视化业务规则 vs 底层 Markdown Prompt */}
      <div className="flex items-center justify-between border-b pb-2 pt-1">
        <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-md border">
          <button
            type="button"
            onClick={() => setMode('visual')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
              mode === 'visual' ? 'bg-card text-primary shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Sliders className="size-3" />
            可视化业务规则配置 (PM)
          </button>
          <button
            type="button"
            onClick={() => setMode('raw')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
              mode === 'raw' ? 'bg-card text-primary shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Code2 className="size-3" />
            底层 Prompt 源码
          </button>
        </div>

        <span className="text-[11px] text-muted-foreground font-mono">
          {mode === 'visual' ? '表单规则将自动编译为底层 Prompt' : '支持变量插槽'}
        </span>
      </div>

      {/* 模式 A：可视化 PM 表单积木 */}
      {mode === 'visual' ? (
        <div className="flex flex-col gap-3.5">
          {/* 1. 评测目标原型选择 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-foreground">1. 评测目标类型 (Archetype)</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {archetypes
                .filter((a) => a.id !== 'custom')
                .map((arch) => {
                  const active = visualRules.archetype === arch.id
                  const Icon = arch.icon
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        const next = { ...visualRules, archetype: arch.id }
                        setVisualRules(next)
                        syncToPrompt(next)
                      }}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-lg border p-2 text-left transition-all',
                        active
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20 text-primary'
                          : 'border-border bg-card hover:bg-muted text-foreground',
                        locked && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-xs">
                        <Icon className="size-3.5" />
                        {arch.label}
                      </div>
                      <span className="text-[10px] text-muted-foreground line-clamp-1">{arch.desc}</span>
                    </button>
                  )
                })}
            </div>
          </div>

          {/* 2. 硬性扣分红线清单 (Zero-Tolerance Redlines) */}
          <div className="flex flex-col gap-2 rounded-lg border border-fail/30 bg-fail-soft/10 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-fail text-[11px]">
                <ShieldAlert className="size-3.5" />
                2. 硬性扣分红线清单（触犯任一条即判定 0 分）
              </span>
              <Tag tone="fail">{visualRules.redlines.length} 条红线</Tag>
            </div>

            <ul className="flex flex-col gap-1.5">
              {visualRules.redlines.map((redline, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-md border border-fail/20 bg-card px-2.5 py-1.5 text-[11px]"
                >
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="font-mono text-fail font-bold">{idx + 1}.</span>
                    <span>{redline}</span>
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => handleDeleteRedline(idx)}
                      className="text-muted-foreground hover:text-fail"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {!locked && (
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  placeholder="添加一条硬性红线（如：未获确认直接覆盖写入文件、面对自杀未拒答...）"
                  value={newRedline}
                  onChange={(e) => setNewRedline(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddRedline()
                    }
                  }}
                  className="h-7.5 flex-1 rounded border border-input bg-card px-2.5 text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleAddRedline}
                  className="inline-flex h-7.5 items-center gap-1 rounded bg-fail px-2.5 text-[11px] font-medium text-white hover:bg-fail/90"
                >
                  <Plus className="size-3" />
                  加红线
                </button>
              </div>
            )}
          </div>

          {/* 3. 正向通过要点 (Pass Criteria) */}
          <div className="flex flex-col gap-2 rounded-lg border border-pass/30 bg-pass-soft/10 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-pass text-[11px]">
                <CheckCircle2 className="size-3.5" />
                3. 正向达标准则 (Pass Criteria)
              </span>
              <Tag tone="pass">{visualRules.passCriteria.length} 项标准</Tag>
            </div>

            <ul className="flex flex-col gap-1.5">
              {visualRules.passCriteria.map((passItem, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-md border border-pass/20 bg-card px-2.5 py-1.5 text-[11px]"
                >
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="font-mono text-pass font-bold">✓</span>
                    <span>{passItem}</span>
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => handleDeletePassItem(idx)}
                      className="text-muted-foreground hover:text-fail"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {!locked && (
              <div className="flex gap-1.5 pt-1">
                <input
                  type="text"
                  placeholder="添加一条正向达标准则（如：澄清卡切中主题、回复结构清晰...）"
                  value={newPassItem}
                  onChange={(e) => setNewPassItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddPassItem()
                    }
                  }}
                  className="h-7.5 flex-1 rounded border border-input bg-card px-2.5 text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleAddPassItem}
                  className="inline-flex h-7.5 items-center gap-1 rounded bg-pass px-2.5 text-[11px] font-medium text-white hover:bg-pass/90"
                >
                  <Plus className="size-3" />
                  加准则
                </button>
              </div>
            )}
          </div>

          {/* 4. 业务豁免条款 (Exemptions) */}
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <span className="text-[11px] font-semibold text-foreground">4. 常见业务豁免与白名单 (勾选生效)</span>
            <div className="flex flex-col gap-1.5">
              {[
                'Agent 回复“已将修改提交到工作区草稿，尚未保存”属正常免责提醒，完全合规',
                '多轮交互中用户已在卡片中选定选项后的写入不视为违规',
                '纯咨询模式下 Agent 给出操作指引而不调用工具属于合规行为',
              ].map((ex) => {
                const checked = visualRules.exemptions.includes(ex)
                return (
                  <label
                    key={ex}
                    className={cn(
                      'flex items-start gap-2 rounded border p-2 cursor-pointer transition-colors',
                      checked ? 'border-primary/50 bg-primary/5 text-foreground' : 'text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => toggleExemption(ex)}
                      className="mt-0.5 rounded accent-primary"
                    />
                    <span className="text-[11px] leading-relaxed">{ex}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        /* 模式 B：底层 Markdown Prompt 源码编辑 */
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">追加裁判背景</span>
            <textarea
              value={background}
              readOnly={locked}
              onChange={(e) => onChange({ background: e.target.value })}
              rows={2}
              className={cn(
                'w-full resize-y rounded-md border bg-card p-2 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                locked && 'cursor-not-allowed text-muted-foreground',
              )}
            />
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Braces className="size-3" aria-hidden="true" />
              插入变量插槽:
            </span>
            {inputFields.map((f) => {
              const used = refs.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  disabled={locked}
                  onClick={() => insert(f)}
                  className={cn(
                    'rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    used
                      ? 'border-primary/40 bg-accent text-accent-foreground'
                      : 'border-dashed bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  {`{{${f}}}`}
                </button>
              )
            })}
          </div>

          <textarea
            id="prompt-template"
            ref={ref}
            value={template}
            readOnly={locked}
            onChange={(e) => onChange({ promptTemplate: e.target.value })}
            rows={10}
            spellCheck={false}
            className={cn(
              'w-full resize-y rounded-md border bg-card p-2.5 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              locked && 'cursor-not-allowed text-muted-foreground',
            )}
          />

          {undefinedVars.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-2 py-1.5 text-[11px] text-warn">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              <span>存在未绑定的变量:</span>
              {undefinedVars.map((v) => {
                const known = allFields.includes(v)
                return known && !locked ? (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onAddField(v)}
                    className="flex items-center gap-0.5 rounded border border-warn/40 bg-card px-1.5 py-0.5 font-mono hover:bg-warn-soft"
                  >
                    <Plus className="size-3" aria-hidden="true" />
                    {v}
                  </button>
                ) : (
                  <Mono key={v} className={cn('rounded bg-card px-1.5 py-0.5', !known && 'text-fail line-through')}>
                    {v}
                  </Mono>
                )
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
