'use client'

import { useImperativeHandle, useRef, type Ref } from 'react'
import Link from 'next/link'
import { AlertTriangle, Braces, Pencil, Plus, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Mono, Tag } from './primitives'

export const judgeModels = ['openai/gpt-5-mini', 'openai/gpt-5', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash']

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function referencedVars(template: string) {
  return Array.from(new Set(Array.from(template.matchAll(VAR_RE), (m) => m[1])))
}

export const defaultBackground = '你是评测裁判。请根据以下信息判断 Agent 表现是否达标，输出 pass / fail 及理由。'

export function defaultPrompt(fields: string[]) {
  return fields.map((f) => `## ${f}\n{{${f}}}`).join('\n')
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

export function PromptEditor({ template, background, agentBackground, agentBackgroundVersion, model, promptVersion, inputFields, allFields, locked, onChange, onAddField, insertRef }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const refs = referencedVars(template)
  const undefinedVars = refs.filter((v) => !inputFields.includes(v))

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
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">裁判模型</span>
          <select
            value={model}
            disabled={locked}
            onChange={(e) => onChange({ judgeModel: e.target.value })}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {judgeModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">提示词版本</span>
          <input
            value={promptVersion}
            disabled={locked}
            onChange={(e) => onChange({ promptVersion: e.target.value })}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserRound className="size-3" aria-hidden="true" />
          业务背景
          <Tag className="font-mono">v{agentBackgroundVersion}</Tag>
          <Link href="/lines" aria-label="编辑业务背景" className="ml-auto flex size-6 items-center justify-center rounded hover:bg-card hover:text-foreground">
            <Pencil className="size-3" aria-hidden="true" />
          </Link>
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap rounded-md border border-dashed bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {agentBackground.trim() || '未填写'}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">追加背景</span>
        <textarea
          value={background}
          readOnly={locked}
          onChange={(e) => onChange({ background: e.target.value })}
          rows={2}
          className={cn('w-full resize-y rounded-md border bg-card p-2.5 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30', locked && 'cursor-not-allowed text-muted-foreground')}
        />
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Braces className="size-3" aria-hidden="true" />插入变量</span>
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
                used ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-dashed bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}
            >
              {`{{${f}}}`}
            </button>
          )
        })}
      </div>

      <label className="sr-only" htmlFor="prompt-template">提示词模板</label>
      <textarea
        id="prompt-template"
        ref={ref}
        value={template}
        readOnly={locked}
        onChange={(e) => onChange({ promptTemplate: e.target.value })}
        rows={9}
        spellCheck={false}
        className={cn('w-full resize-y rounded-md border bg-card p-2.5 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30', locked && 'cursor-not-allowed text-muted-foreground')}
      />

      {undefinedVars.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-2 py-1.5 text-[11px] text-warn">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          <span>未绑定</span>
          {undefinedVars.map((v) => {
            const known = allFields.includes(v)
            return known && !locked ? (
              <button key={v} type="button" onClick={() => onAddField(v)} className="flex items-center gap-0.5 rounded border border-warn/40 bg-card px-1.5 py-0.5 font-mono hover:bg-warn-soft">
                <Plus className="size-3" aria-hidden="true" />{v}
              </button>
            ) : (
              <Mono key={v} className={cn('rounded bg-card px-1.5 py-0.5', !known && 'text-fail line-through')}>{v}</Mono>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
