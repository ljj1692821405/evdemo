import type { Evidence } from '@/lib/mock-data'

const KNOWN = ['diff', 'kv', 'table', 'pairs', 'text', 'json'] as const

function defaultSummary(view: string, data: unknown) {
  if (view === 'kv' && data && typeof data === 'object') return `${Object.keys(data).length} 项`
  if (view === 'pairs' && Array.isArray(data)) return `${data.length} 组对照`
  if (view === 'table' && data && typeof data === 'object' && 'rows' in data) return `${(data as { rows: unknown[] }).rows.length} 行`
  return null
}

export function EvidenceView({ evidence }: { evidence: Evidence }) {
  const view = (KNOWN as readonly string[]).includes(evidence.view) ? evidence.view : 'json'
  const degraded = view !== evidence.view
  const summary = evidence.summary ?? defaultSummary(view, evidence.data)

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{evidence.title}</span>
        {summary ? <span className="text-muted-foreground">· {summary}</span> : null}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {degraded ? `${evidence.view} → json` : view}
        </span>
      </div>
      <div className="p-3 text-xs">
        <Body view={view} data={evidence.data} />
      </div>
    </div>
  )
}

function Body({ view, data }: { view: string; data: unknown }) {
  try {
    if (view === 'kv' && data && typeof data === 'object') {
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )
    }
    if (view === 'pairs' && Array.isArray(data)) {
      return (
        <div className="flex flex-col gap-1">
          {(data as [string, string][]).map(([a, b]) => (
            <div key={a} className="flex gap-3">
              <span className="w-10 shrink-0 text-muted-foreground">{a}</span>
              <span className="font-mono">{b}</span>
            </div>
          ))}
        </div>
      )
    }
    if (view === 'table' && data && typeof data === 'object' && 'rows' in data) {
      const t = data as { columns: string[]; rows: string[][] }
      return (
        <table className="w-full">
          <thead>
            <tr>{t.columns.map((c) => <th key={c} className="pb-1 text-left font-medium text-muted-foreground">{c}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="py-1 font-mono">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
    }
    if (view === 'text') return <p className="whitespace-pre-wrap">{String(data)}</p>
  } catch {
    // fall through to json rendering; evidence must never blank the card
  }
  return <pre className="overflow-x-auto font-mono text-[11px]">{JSON.stringify(data, null, 2)}</pre>
}
