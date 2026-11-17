import { demoData, dimKeyOf, turnFieldValues } from './demo-data'
import { goldenCases } from './golden-seed'
import { snapshots, type Scorer, type Verdict } from './mock-data'

export type TrialUnit = {
  key: string
  caseId: string
  turn: number
  turns: number
  query: string
  tags: string[]
  gtKeys: string[]
}

const findTurn = (u: TrialUnit) => {
  const c = demoData.cases.find((x) => x.caseId === u.caseId)
  const t = c?.turns.find((x) => x.turn === u.turn)
  return c && t ? { c, t } : null
}

export function trialUnits(snapshotId: string): TrialUnit[] {
  const snap = snapshots.find((s) => s.id === snapshotId)
  if (!snap) return []
  const caseIds = goldenCases.filter((c) => c.datasetId === snap.datasetId).map((c) => c.id)
  return demoData.cases
    .filter((c) => caseIds.includes(c.caseId))
    .flatMap((c) =>
      c.turns.map((t) => ({
        key: `${c.caseId}#${t.turn}`,
        caseId: c.caseId,
        turn: t.turn,
        turns: c.turns.length,
        query: t.query,
        tags: Object.values(c.labels).map(String),
        gtKeys: Object.entries(t.gt)
          .filter(([, points]) => points.length > 0)
          .map(([key]) => key),
      })),
    )
}

export function fieldValues(u: TrialUnit): Record<string, string | null> {
  const found = findTurn(u)
  return found ? turnFieldValues(found.c, found.t) : { user_query: u.query }
}

export type DimResult = {
  key: string
  verdict: Verdict
  gt: Verdict | null
  evidence: { field: string; quote: string }[]
  reason: string
}

export type TrialResult = {
  id: string
  unitKey: string
  model: string
  at: string
  latencyMs: number
  tokensIn: number
  tokensOut: number
  cost: number
  checks: { label: string; ok: boolean }[]
  dims: DimResult[]
  unbound: string[]
  raw: unknown
}

export function runTrial(scorer: Scorer, u: TrialUnit, template: string, refs: string[], model: string, seq: number): TrialResult {
  const values = fieldValues(u)
  const found = findTurn(u)
  const unbound = refs.filter((r) => !scorer.inputFields.includes(r))
  const tokensIn = Math.round(scorer.inputFields.reduce((s, f) => s + (values[f]?.length ?? 0), 0) * 1.4 + template.length * 0.8)

  const dims: DimResult[] = scorer.outputs.map((key) => {
    if (unbound.length) return { key, verdict: 'error', gt: null, evidence: [], reason: `变量未绑定：${unbound.join(', ')}` }
    const entry = found ? Object.entries(found.t.scores).find(([k]) => dimKeyOf(k) === key) : undefined
    if (!entry) return { key, verdict: 'na', gt: null, evidence: [], reason: '该 case 未激活此维度' }
    const score = entry[1]
    if (!score) return { key, verdict: 'na', gt: null, evidence: [], reason: found?.t.skipReason || '本轮无 GT，不评' }
    return {
      key,
      verdict: score.pass ? 'pass' : 'fail',
      gt: null,
      evidence: score.evidence ? [{ field: '证据分析', quote: score.evidence }] : [],
      reason: score.reason,
    }
  })

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    id: `tr_${seq}`,
    unitKey: u.key,
    model,
    at: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    latencyMs: 0,
    tokensIn: unbound.length ? 0 : tokensIn,
    tokensOut: 0,
    cost: 0,
    checks: [
      { label: 'AST', ok: true },
      { label: 'import', ok: true },
      { label: '变量绑定', ok: unbound.length === 0 },
      { label: 'output_schema', ok: unbound.length === 0 },
    ],
    dims,
    unbound,
    raw: unbound.length
      ? { error: 'unbound_variable', vars: unbound }
      : { source: '05_eval_results 回放', ...Object.fromEntries(dims.map((d) => [d.key, { verdict: d.verdict, reason: d.reason }])) },
  }
}
