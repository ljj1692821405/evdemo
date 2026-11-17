import type { CaseItem } from './mock-data'

export type CaseGt = { key: string; points: string[] }
export type CaseTurn = { no: number; query: string; gt: CaseGt[] }
export type CaseWorkspace = { name: string; description: string; files: { path: string; content: string }[] }

type Raw = Record<string, unknown>

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const turnNo = (key: string) => Number(key.replace(/\D/g, '')) || 0

const structuralKeys = new Set(['id', 'case_id', 'legacy_id', 'query', 'user_query', 'gt', 'turns_gt', 'initial_workspace', 'activated_dimensions', 'tags'])

function toPoints(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.map(String)
  if (isRecord(value)) return Object.values(value).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
  return [String(value)]
}

function queriesOf(raw: Raw): string[] {
  const q = raw.user_query ?? raw.query
  if (typeof q === 'string') return [q]
  if (Array.isArray(q)) return q.map(String)
  if (isRecord(q)) {
    return Object.keys(q)
      .sort((a, b) => turnNo(a) - turnNo(b))
      .map((k) => String(q[k] ?? ''))
  }
  return []
}

function gtByTurn(raw: Raw, turnCount: number): CaseGt[][] {
  const out: CaseGt[][] = Array.from({ length: turnCount }, () => [])
  if (isRecord(raw.turns_gt)) {
    const turnsGt = raw.turns_gt
    Object.keys(turnsGt)
      .sort((a, b) => turnNo(a) - turnNo(b))
      .forEach((k, i) => {
        const perTurn = turnsGt[k]
        if (!isRecord(perTurn) || i >= turnCount) return
        out[i] = Object.entries(perTurn).map(([key, value]) => ({ key, points: toPoints(value) }))
      })
  } else if (isRecord(raw.gt) && turnCount > 0) {
    out[0] = Object.entries(raw.gt).map(([key, value]) => ({ key, points: toPoints(value) }))
  }
  return out
}

export function caseTurns(c: CaseItem): CaseTurn[] {
  if (!c.raw) return c.query.map((query, i) => ({ no: i + 1, query, gt: [] }))
  const queries = queriesOf(c.raw)
  const list = queries.length ? queries : c.query
  const gt = gtByTurn(c.raw, list.length)
  return list.map((query, i) => ({ no: i + 1, query, gt: gt[i] }))
}

export function caseWorkspace(c: CaseItem): CaseWorkspace | null {
  const ws = c.raw?.initial_workspace
  if (!isRecord(ws)) return null
  const files = Array.isArray(ws.files)
    ? ws.files.filter(isRecord).map((f) => ({ path: String(f.path ?? ''), content: typeof f.content === 'string' ? f.content : JSON.stringify(f.content, null, 2) }))
    : []
  return {
    name: String(ws.displayName ?? ws.skillName ?? ''),
    description: typeof ws.description === 'string' ? ws.description : '',
    files: files.length ? files : [{ path: 'initial_workspace', content: JSON.stringify(ws, null, 2) }],
  }
}

export function caseLabels(c: CaseItem): [string, string][] {
  if (!c.raw) return []
  return Object.entries(c.raw).flatMap(([key, value]): [string, string][] =>
    structuralKeys.has(key) || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ? [] : [[key, String(value)]],
  )
}

export function caseDimensions(c: CaseItem): string[] {
  const dims = c.raw?.activated_dimensions
  return Array.isArray(dims) ? dims.map(String) : []
}

export function caseExtraFields(c: CaseItem): [string, unknown][] {
  if (!c.raw) return []
  return Object.entries(c.raw).filter(([key, value]) => !structuralKeys.has(key) && typeof value === 'object' && value !== null)
}

function workspaceSize(raw: Raw): string {
  const ws = raw.initial_workspace
  if (!isRecord(ws)) return '—'
  const files = Array.isArray(ws.files) ? ws.files.filter(isRecord) : []
  const chars = files.length ? files.reduce((sum, f) => sum + (typeof f.content === 'string' ? f.content.length : 0), 0) : JSON.stringify(ws).length
  return `${(chars / 1024).toFixed(1)} KB`
}

export function parseCaseRecords(rows: unknown[], datasetId: string, startIndex: number): CaseItem[] {
  return rows.map((row, i) => {
    const raw = isRecord(row) ? row : {}
    const bad = !isRecord(row) || '__bad' in raw
    const explicitId = raw.case_id ?? raw.id
    const id = typeof explicitId === 'string' && explicitId ? explicitId : `case_${String(startIndex + i + 1).padStart(4, '0')}`
    const query = queriesOf(raw)
    const gtKeys = Array.from(new Set(gtByTurn(raw, query.length).flatMap((turn) => turn.filter((g) => g.points.length).map((g) => g.key))))
    const invalidReason = bad ? 'JSON 解析失败' : query.length === 0 ? '缺少 query' : query.some((x) => !x.trim()) ? 'query 含空字符串' : undefined
    const base: CaseItem = {
      id,
      datasetId,
      query: query.length ? query : [''],
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      workspaceSize: workspaceSize(raw),
      gtSource: gtKeys.length ? 'case' : 'missing',
      gtKeys,
      valid: !invalidReason,
      invalidReason,
      raw: bad ? undefined : raw,
    }
    return base.tags.length ? base : { ...base, tags: caseLabels(base).map(([, value]) => value) }
  })
}

export function parseCaseText(text: string, datasetId: string, startIndex: number): CaseItem[] {
  const trimmed = text.trim()
  let rows: unknown[]
  try {
    const parsed: unknown = JSON.parse(trimmed)
    rows = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    rows = trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line): unknown => {
        try {
          return JSON.parse(line)
        } catch {
          return { __bad: line }
        }
      })
  }
  return parseCaseRecords(rows, datasetId, startIndex)
}
