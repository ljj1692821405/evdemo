'use client'

import { useMemo, useState } from 'react'
import { Download, FileJson, FileSpreadsheet, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { reviewTurns, runStats, dimensions } from '@/lib/mock-data'
import { Panel, Tag, Mono, Btn } from './primitives'

type Format = 'csv' | 'json' | 'md'

const exportName = 'golden_demo'

const columns = [
  { key: 'case_id', label: 'case_id', locked: true },
  { key: 'turn_no', label: 'turn_no', locked: true },
  { key: 'dimension', label: 'dimension', locked: true },
  { key: 'judge', label: 'judge 判定' },
  { key: 'human', label: 'human 判定' },
  { key: 'reason', label: '裁判理由' },
  { key: 'scorer', label: 'scorer 版本' },
  { key: 'user', label: '用户输入' },
]

export function ExportView() {
  const [format, setFormat] = useState<Format>('csv')
  const [cols, setCols] = useState<string[]>(['case_id', 'turn_no', 'dimension', 'judge', 'human', 'reason'])

  const rows = useMemo(
    () =>
      reviewTurns.flatMap((t) =>
        t.judgments.map((j) => ({
          case_id: t.caseId,
          turn_no: String(t.turnNo),
          dimension: j.dim,
          judge: j.verdict,
          human: '',
          reason: j.reason,
          scorer: j.scorerId,
          user: t.user,
        })),
      ),
    [],
  )

  const output = useMemo(() => {
    const picked = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c as keyof typeof r]])))
    if (format === 'json') return JSON.stringify({ export: exportName, rows: picked }, null, 2)
    if (format === 'csv') {
      const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
      return [cols.join(','), ...picked.map((r) => cols.map((c) => esc(String(r[c] ?? ''))).join(','))].join('\n')
    }
    const all = Object.values(runStats)
    const casePass = all.reduce((n, x) => n + x.caseRate[0], 0)
    const caseTotal = all.reduce((n, x) => n + x.caseRate[1], 0)
    const s = { dims: all.flatMap((x) => x.dims), failTop: all.flatMap((x) => x.failTop) }
    return [
      `# 评测报告 · ${exportName}`,
      '',
      `- 总通过率（case）：${caseTotal ? ((casePass / caseTotal) * 100).toFixed(1) : '—'}%（${casePass}/${caseTotal}）`,
      '- 裁判-人工一致率：—（尚无人工复核）',
      '',
      '| 维度 | 通过率 | na | error |',
      '| --- | --- | --- | --- |',
      ...s.dims.map((d) => `| ${d.key} ${dimensions.find((x) => x.key === d.key)?.name} | ${((d.caseRate[0] / d.caseRate[1]) * 100).toFixed(1)}% | ${d.na} | ${d.error} |`),
      '',
      '## 失败明细',
      ...s.failTop.map((f) => `- \`${f.caseId}\` ${f.dim}：${f.reason}`),
    ].join('\n')
  }, [rows, cols, format])

  const download = () => {
    const mime = { csv: 'text/csv', json: 'application/json', md: 'text/markdown' }[format]
    const blob = new Blob([format === 'csv' ? '\ufeff' + output : output], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportName}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formats: { id: Format; label: string; icon: React.ElementType }[] = [
    { id: 'csv', label: 'CSV 明细', icon: FileSpreadsheet },
    { id: 'json', label: 'JSON 明细', icon: FileJson },
    { id: 'md', label: 'Markdown 报告', icon: FileText },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Panel title="格式">
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="导出格式">
            {formats.map((f) => {
              const Icon = f.icon
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={format === f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm', format === f.id ? 'border-primary bg-accent' : 'bg-card hover:bg-muted')}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {f.label}
                </button>
              )
            })}
          </div>
        </Panel>
        <Panel title="列" className={cn(format === 'md' && 'opacity-50')}>
          <div className="flex flex-col gap-1">
            {columns.map((c) => (
              <label key={c.key} className={cn('flex items-center gap-2 rounded px-1 py-1 text-sm', c.locked || format === 'md' ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted')}>
                <input
                  type="checkbox"
                  className="accent-primary"
                  disabled={c.locked || format === 'md'}
                  checked={cols.includes(c.key)}
                  onChange={() => setCols((s) => (s.includes(c.key) ? s.filter((x) => x !== c.key) : columns.map((x) => x.key).filter((k) => s.includes(k) || k === c.key)))}
                />
                <Mono>{c.label}</Mono>
                {c.locked ? <Tag className="ml-auto">主键</Tag> : null}
              </label>
            ))}
          </div>
        </Panel>
        <Btn variant="primary" onClick={download}>
          <Download className="size-4" aria-hidden="true" />下载 {exportName}.{format}
        </Btn>
      </div>

      <Panel
        title="预览"
        actions={<span className="font-mono text-[11px] text-muted-foreground">{format === 'md' ? '汇总' : `${rows.length} 行 × ${cols.length} 列`} · 数值来自 B5</span>}
        bodyClassName="p-0"
      >
        <pre className="max-h-[calc(100dvh-220px)] overflow-auto p-4 font-mono text-[12px] leading-relaxed">{output}</pre>
      </Panel>
    </div>
  )
}
