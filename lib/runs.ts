import { experiments, runStats, runs, scorers, type RunStats } from './mock-data'

export const viewableRuns = runs.filter((r) => r.status === 'completed' || r.status === 'partial')

export function runContext(runId: string | undefined) {
  const run = viewableRuns.find((r) => r.id === runId)
  if (!run) return null
  const exp = experiments.find((e) => e.id === run.experimentId)!
  const dimKeys = Array.from(new Set(exp.scorerIds.flatMap((id) => scorers.find((s) => s.id === id)?.outputs ?? [])))
  return { run, exp, dimKeys, stats: deriveStats(run.id, dimKeys) }
}

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n))
}

function deriveStats(runId: string, dimKeys: string[]): RunStats {
  const base = runStats.run_0412
  if (runStats[runId]) return runStats[runId]
  const seed = Number.parseInt(runId.replace(/\D/g, ''), 10)
  const shift = (seed % 5) - 2
  const dims = base.dims
    .filter((d) => dimKeys.includes(d.key))
    .map((d) => ({
      ...d,
      caseRate: [clamp(d.caseRate[0] + shift, d.caseRate[1]), d.caseRate[1]] as [number, number],
      turnRate: [clamp(d.turnRate[0] + shift, d.turnRate[1]), d.turnRate[1]] as [number, number],
      agreement: { ...d.agreement, agree: clamp(d.agreement.agree + Math.min(0, shift), d.agreement.n) },
    }))
  const run = runs.find((r) => r.id === runId)!
  return {
    ...base,
    runId,
    status: run.status,
    caseRate: [clamp(base.caseRate[0] + shift, base.caseRate[1]), base.caseRate[1]],
    error: run.errors,
    dims,
    failTop: base.failTop.filter((f) => dimKeys.includes(f.dim)),
    disagreeTop: base.disagreeTop.filter((f) => dimKeys.includes(f.dim)),
    cost: { ...base.cost, fee: run.cost },
  }
}
