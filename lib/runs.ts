import { experiments, runStats, runs, scorers, type RunStats } from './mock-data'

export const viewableRuns = runs.filter((r) => r.status === 'completed' || r.status === 'partial')

export function runContext(runId: string | undefined) {
  const run = viewableRuns.find((r) => r.id === runId)
  if (!run) return null
  const exp = experiments.find((e) => e.id === run.experimentId)!
  const scorerDims = Array.from(new Set(exp.scorerIds.flatMap((id) => scorers.find((s) => s.id === id)?.outputs ?? [])))
  const stats: RunStats = runStats[run.id] ?? {
    runId: run.id,
    status: run.status,
    caseRate: [0, 0],
    agreement: { agree: 0, n: 0 },
    pass: 0,
    fail: 0,
    na: 0,
    error: run.errors,
    dims: [],
    failTop: [],
    disagreeTop: [],
    cost: { tokens: '—', calls: 0, fee: run.cost },
  }
  const dimKeys = stats.dims.length ? stats.dims.map((d) => d.key) : scorerDims
  return { run, exp, dimKeys, stats }
}
