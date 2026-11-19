'use client'

import { useImperativeHandle, useRef, type Ref } from 'react'
import Link from 'next/link'
import { AlertTriangle, Pencil, Plus, UserRound, Sparkles, Check, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Mono, Tag } from './primitives'
import { useFieldDict } from '@/lib/field-dict-store'

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

export function defaultPrompt(fields: string[], dictEntries?: { logicalName: string; description: string }[]) {
  return fields
    .map((f) => {
      const desc = dictEntries?.find((e) => e.logicalName === f)?.description
      const header = desc ? `## ${f} (${desc})` : `## ${f}`
      return `${header}\n{{${f}}}`
    })
    .join('\n')
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
  onChange: (patch: {
    promptTemplate?: string
    background?: string
    judgeModel?: string
    promptVersion?: string
    inputFields?: string[]
  }) => void
  onToggleField?: (field: string) => void
  onAddField?: (field: string) => void
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
  onToggleField,
  onAddField,
  insertRef,
}: Props) {
  const dict = useFieldDict()
  const ref = useRef<HTMLTextAreaElement>(null)
  const refs = referencedVars(template)
  const undefinedVars = refs.filter((v) => !inputFields.includes(v))

  const insert = (field: string) => {
    const el = ref.current
    const desc = dict.entries.find((e) => e.logicalName === field)?.description
    const token = desc ? `## ${field} (${desc})\n{{${field}}}\n` : `## ${field}\n{{${field}}}\n`
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
    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-muted/20 p-4 lg:grid-cols-12 shadow-xs">
      {/* 左半区：裁判提示词模板、模型配置与变量状态 (占 7 列) */}
      <div className="flex flex-col gap-3 lg:col-span-7 xl:col-span-7">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground font-medium">裁判模型</span>
            <select
              value={model}
              disabled={locked}
              onChange={(e) => onChange({ judgeModel: e.target.value })}
              className="h-8 rounded-md border border-input bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              {judgeModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground font-medium">提示词版本</span>
            <input
              value={promptVersion}
              disabled={locked}
              onChange={(e) => onChange({ promptVersion: e.target.value })}
              className="h-8 rounded-md border border-input bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        {/* 变量药丸状态栏 */}
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            已引用的输入变量
          </span>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-card/60 p-2 min-h-8">
            {inputFields.map((f) => {
              const used = refs.includes(f)
              const desc = dict.entries.find((e) => e.logicalName === f)?.description
              return (
                <div
                  key={f}
                  className={cn(
                    'group relative inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-all shadow-2xs',
                    used
                      ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                      : 'border-dashed bg-card text-muted-foreground',
                  )}
                >
                  <span>{f}</span>
                  {desc ? <span className="font-normal text-[10px] text-muted-foreground/80">· {desc}</span> : null}

                  {/* 变量药丸一键删除 × 按钮 */}
                  {!locked && (
                    <button
                      type="button"
                      aria-label={`移除变量 ${f}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleField?.(f)
                      }}
                      className="ml-0.5 flex size-3.5 items-center justify-center rounded-full text-primary/70 transition-colors hover:bg-fail-soft hover:text-fail cursor-pointer"
                    >
                      <X className="size-2.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            })}
            {inputFields.length === 0 && (
              <span className="text-[11px] text-muted-foreground">暂无引用变量</span>
            )}
          </div>
        </div>

        {/* 提示词模板文本域 */}
        <div className="flex flex-col gap-1">
          <label
            className="text-[11px] font-semibold text-foreground"
            htmlFor="prompt-template"
          >
            <span>裁判提示词模板</span>
          </label>
          <textarea
            id="prompt-template"
            ref={ref}
            value={template}
            readOnly={locked}
            onChange={(e) => onChange({ promptTemplate: e.target.value })}
            rows={10}
            spellCheck={false}
            className={cn(
              'w-full resize-y rounded-md border border-input bg-card p-2.5 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              locked && 'cursor-not-allowed text-muted-foreground',
            )}
          />
        </div>

        {undefinedVars.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-2 py-1.5 text-[11px] text-warn">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            <span>模板中存在未绑定字段：</span>
            {undefinedVars.map((v) => {
              const known = allFields.includes(v)
              return known && !locked ? (
                <button
                  key={v}
                  type="button"
                  onClick={() => onAddField?.(v)}
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

      {/* 右半区：输入字段列表 (直接顶到最右侧，占 5 列) */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 lg:col-span-5 xl:col-span-5 shadow-2xs">
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-xs text-foreground">消费输入字段列表</span>
            <Tag tone="primary" className="text-[10px] font-mono">
              {inputFields.length} 已选
            </Tag>
          </div>
        </div>

        <ul className="flex flex-col gap-1 max-h-[380px] overflow-y-auto pr-0.5">
          {dict.entries.map((f) => {
            const on = inputFields.includes(f.logicalName)
            return (
              <li key={f.logicalName} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={on}
                  onClick={() => onToggleField?.(f.logicalName)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all cursor-pointer',
                    on
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-2xs font-semibold'
                      : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/50',
                    locked && 'cursor-not-allowed',
                  )}
                >
                  {on ? (
                    <Check className="size-3.5 text-primary shrink-0" />
                  ) : (
                    <Plus className="size-3 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Mono className={cn('font-bold text-xs', on ? 'text-primary' : 'text-foreground')}>
                        {f.logicalName}
                      </Mono>
                      {f.source === 'derived' ? (
                        <Tag tone="pass" className="px-1 text-[9px]">
                          评测派生
                        </Tag>
                      ) : null}
                      {on ? (
                        <Tag tone="primary" className="px-1 text-[9px]">
                          已引用
                        </Tag>
                      ) : null}
                    </div>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">{f.description}</span>
                  </div>
                  <Mono className="text-[10px] text-muted-foreground shrink-0 font-mono">~{f.avgTokens} tok</Mono>
                </button>
              </li>
            )
          })}
        </ul>

        {/* 超长工作区智能替换建议 */}
        {inputFields.some((f) => f.includes('workspace')) && !inputFields.includes('diff_stats') ? (
          <div className="mt-1 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
            <span className="text-[10px] text-muted-foreground">
              工作区较大，建议选用已派生的 <Mono className="font-semibold text-foreground">diff_stats</Mono>。
            </span>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                const next = [...inputFields.filter((x) => !x.includes('workspace')), 'diff_stats']
                onChange({ inputFields: next })
              }}
              className="shrink-0 rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:opacity-50"
            >
              替换为 diff_stats
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
