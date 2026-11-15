'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type Line = { type: 'same' | 'add' | 'del'; text: string }

function diffLines(a: string, b: string): Line[] {
  const x = a.split('\n')
  const y = b.split('\n')
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ type: 'same', text: x[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: x[i] }); i++ }
    else { out.push({ type: 'add', text: y[j] }); j++ }
  }
  while (i < x.length) out.push({ type: 'del', text: x[i++] })
  while (j < y.length) out.push({ type: 'add', text: y[j++] })
  return out
}

type Block = { kind: 'lines'; lines: Line[] } | { kind: 'fold'; lines: Line[]; id: number }

export function WorkspaceDiff({
  meta,
  before,
  after,
}: {
  meta: { key: string; before: string; after: string }[]
  before: string
  after: string
}) {
  const [mode, setMode] = useState<'diff' | 'full'>('diff')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const lines = useMemo(() => diffLines(before, after), [before, after])
  const changed = lines.some((l) => l.type !== 'same')

  const blocks = useMemo(() => {
    const res: Block[] = []
    let id = 0
    let i = 0
    while (i < lines.length) {
      if (lines[i].type !== 'same') {
        res.push({ kind: 'lines', lines: [lines[i]] })
        i++
        continue
      }
      let j = i
      while (j < lines.length && lines[j].type === 'same') j++
      const run = lines.slice(i, j)
      const head = i === 0 ? 0 : 1
      const tail = j === lines.length ? 0 : 1
      if (run.length - head - tail > 1) {
        if (head) res.push({ kind: 'lines', lines: run.slice(0, head) })
        res.push({ kind: 'fold', lines: run.slice(head, run.length - tail), id: id++ })
        if (tail) res.push({ kind: 'lines', lines: run.slice(-tail) })
      } else {
        res.push({ kind: 'lines', lines: run })
      }
      i = j
    }
    return res
  }, [lines])

  return (
    <div className="flex flex-col gap-2">
      {meta.length ? (
        <div className="flex flex-wrap gap-2">
          {meta.map((m) => (
            <div key={m.key} className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px]">
              <span className="text-muted-foreground">{m.key}</span> {m.before} <span className="text-primary">→</span> {m.after}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        {(['diff', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn('rounded px-2 py-0.5 text-xs', mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}
          >
            {m === 'diff' ? '行级 diff' : '全文'}
          </button>
        ))}
        {!changed ? <span className="ml-2 text-xs text-muted-foreground">无改动</span> : null}
      </div>
      {mode === 'full' ? (
        <div className="grid grid-cols-2 gap-2">
          {[['前', before], ['后', after]].map(([k, v]) => (
            <div key={k} className="rounded-md border">
              <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">{k}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px] leading-relaxed">{v}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border font-mono text-[11px] leading-relaxed">
          {blocks.map((b, bi) =>
            b.kind === 'fold' && !open.has(b.id) ? (
              <button
                key={bi}
                type="button"
                onClick={() => setOpen((s) => new Set(s).add(b.id))}
                className="block w-full bg-muted/50 px-3 py-0.5 text-left text-muted-foreground hover:bg-muted"
              >
                ⋯ {b.lines.length} 行未改动
              </button>
            ) : (
              b.lines.map((l, li) => (
                <div
                  key={`${bi}-${li}`}
                  className={cn(
                    'flex whitespace-pre-wrap px-3',
                    l.type === 'add' && 'bg-pass-soft text-pass',
                    l.type === 'del' && 'bg-fail-soft text-fail line-through decoration-fail/40',
                  )}
                >
                  <span className="w-4 shrink-0 select-none opacity-60">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                  <span>{l.text || ' '}</span>
                </div>
              ))
            ),
          )}
        </div>
      )}
    </div>
  )
}
