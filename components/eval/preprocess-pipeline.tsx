'use client'

import { useState } from 'react'
import { ArrowRight, Check, Code2, FileText, Loader2, Play, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, Tag, Mono } from './primitives'

type FieldNode = { id: string; name: string; tokens: number; sample: string }

const inputs: FieldNode[] = [
  {
    id: 'before',
    name: 'workspace_before',
    tokens: 7800,
    sample: '# 周报 W46\n## 本周进展\n当前进度 65%，预计周五完成联调。\n## 下周计划\n…（共 42 段）',
  },
  {
    id: 'after',
    name: 'workspace_after',
    tokens: 8100,
    sample: '# 周报 W46\n## 本周进展\n当前进度 80%，联调提前完成。\n## 风险\n依赖方接口延期 1 天。\n## 下周计划\n…（共 44 段）',
  },
]

const outputs: FieldNode[] = [
  {
    id: 'diff',
    name: 'workspace_diff',
    tokens: 540,
    sample: '@@ 本周进展 @@\n- 当前进度 65%，预计周五完成联调。\n+ 当前进度 80%，联调提前完成。\n@@ 风险（新增） @@\n+ 依赖方接口延期 1 天。',
  },
  {
    id: 'unchanged',
    name: 'workspace_unchanged',
    tokens: 120,
    sample: '未变动：# 标题 · ## 下周计划 · ## 附录 · 表格 ×2',
  },
]

const versions = [
  { v: 'v4', status: 'draft' as const },
  { v: 'v3', status: 'published' as const },
  { v: 'v2', status: 'published' as const },
]

const scriptCode = `def extract(before: str, after: str) -> dict:
    a, b = split_sections(before), split_sections(after)
    diff = unified_diff(a, b, context=0)
    unchanged = [s.title for s in a if s in b]
    return {
        "workspace_diff": diff,
        "workspace_unchanged": "未变动：" + " · ".join(unchanged),
    }`

type RunState = 'idle' | 'running' | 'done'

export function PreprocessPipeline() {
  const [selected, setSelected] = useState<string>('script')
  const [version, setVersion] = useState('v4')
  const [run, setRun] = useState<RunState>('idle')

  const inTok = inputs.reduce((s, n) => s + n.tokens, 0)
  const outTok = outputs.reduce((s, n) => s + n.tokens, 0)
  const ratio = Math.round((1 - outTok / inTok) * 100)
  const field = [...inputs, ...outputs].find((n) => n.id === selected)
  const isDraft = versions.find((x) => x.v === version)?.status === 'draft'

  const startRun = () => {
    setRun('running')
    setTimeout(() => setRun('done'), 900)
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Code2 className="size-4 text-primary" aria-hidden="true" />前置脚本</span>}
      actions={
        <div className="flex items-center gap-2">
          <select
            aria-label="脚本版本"
            value={version}
            onChange={(e) => { setVersion(e.target.value); setRun('idle') }}
            className="h-8 rounded-md border bg-card px-2 font-mono text-xs"
          >
            {versions.map((x) => (
              <option key={x.v} value={x.v}>ws_diff_extract@{x.v} · {x.status}</option>
            ))}
          </select>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted">
            <Upload className="size-3.5" aria-hidden="true" />上传
          </button>
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-col gap-4 overflow-x-auto p-4 lg:flex-row lg:items-center">
        <NodeColumn nodes={inputs} selected={selected} onSelect={setSelected} />
        <Flow />
        <button
          type="button"
          onClick={() => setSelected('script')}
          aria-pressed={selected === 'script'}
          className={cn(
            'flex min-w-56 flex-col gap-2 rounded-lg border-2 bg-card p-3 text-left transition-colors',
            selected === 'script' ? 'border-primary' : 'border-dashed hover:border-primary/50',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <Mono className="font-semibold">ws_diff_extract</Mono>
            <Tag tone={isDraft ? 'neutral' : 'pass'}>{version}</Tag>
          </span>
          <Mono className="text-xs text-muted-foreground">extract(before, after)</Mono>
          <span className="flex items-center gap-1.5">
            <Tag className="font-mono">python 3.11</Tag>
            <Tag className="font-mono">10s</Tag>
          </span>
        </button>
        <Flow />
        <NodeColumn nodes={outputs} selected={selected} onSelect={setSelected} derived />
        <div className="flex min-w-36 flex-col items-start gap-1 rounded-lg bg-muted/50 p-3 lg:ml-auto">
          <span className="font-mono text-xs text-muted-foreground">
            {inTok.toLocaleString()} → {outTok.toLocaleString()} tok
          </span>
          <span className="font-mono text-2xl font-semibold text-pass">-{ratio}%</span>
        </div>
      </div>

      <div className="border-t">
        {selected === 'script' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]">
            <pre className="overflow-auto bg-muted/30 p-4 font-mono text-[12px] leading-relaxed">{scriptCode}</pre>
            <div className="flex flex-col gap-3 border-t p-4 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between">
                <Mono className="text-xs">case_0001#1</Mono>
                <button
                  type="button"
                  onClick={startRun}
                  disabled={run === 'running'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {run === 'running' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                  试跑
                </button>
              </div>
              {run === 'done' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <Tag tone="pass"><Check className="size-3" aria-hidden="true" />exit 0</Tag>
                    <Tag className="font-mono">0.21s</Tag>
                    <Tag tone="pass" className="font-mono">{outTok} tok</Tag>
                  </div>
                  {outputs.map((o) => (
                    <div key={o.id} className="rounded-md border">
                      <div className="border-b bg-muted/40 px-2.5 py-1.5"><Mono className="text-xs">{o.name}</Mono></div>
                      <pre className="whitespace-pre-wrap p-2.5 font-mono text-[11px] leading-relaxed">{o.sample}</pre>
                    </div>
                  ))}
                  {isDraft ? (
                    <button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-primary px-3 text-xs text-primary hover:bg-accent">
                      发布 {version}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center py-8 text-muted-foreground">
                  <Play className="size-6 opacity-30" aria-hidden="true" />
                </div>
              )}
            </div>
          </div>
        ) : field ? (
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Mono className="font-semibold">{field.name}</Mono>
              <Tag tone={field.tokens > 2000 ? 'warn' : 'pass'} className="font-mono">~{field.tokens.toLocaleString()} tok</Tag>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[12px] leading-relaxed">{field.sample}</pre>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

function NodeColumn({
  nodes,
  selected,
  onSelect,
  derived,
}: {
  nodes: FieldNode[]
  selected: string
  onSelect: (id: string) => void
  derived?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => onSelect(n.id)}
          aria-pressed={selected === n.id}
          className={cn(
            'flex min-w-52 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
            selected === n.id ? 'border-primary bg-accent/60' : 'hover:bg-muted/50',
            derived && 'border-pass/40 bg-pass-soft/40',
          )}
        >
          <span className="flex items-center gap-2">
            <FileText className={cn('size-3.5', derived ? 'text-pass' : 'text-muted-foreground')} aria-hidden="true" />
            <Mono className="text-xs">{n.name}</Mono>
          </span>
          <Mono className={cn('text-xs', n.tokens > 2000 ? 'text-warn' : 'text-muted-foreground')}>
            {n.tokens.toLocaleString()}
          </Mono>
        </button>
      ))}
    </div>
  )
}

function Flow() {
  return <ArrowRight className="size-4 shrink-0 rotate-90 self-center text-muted-foreground lg:rotate-0" aria-hidden="true" />
}
