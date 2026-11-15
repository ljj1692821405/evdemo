import type { DimStat, Dimension, Verdict } from './mock-data'

// Prototype stand-in for backend B5 (the single source of truth for numbers).
// In production the frontend must not compute these; it renders what B5 returns.

export type Judgment = { label: '可放手' | '需人工' | '样本不足'; tone: 'pass' | 'warn' | 'na' }

export function judgeDimension(stat: DimStat, dim: Dimension): Judgment {
  if (stat.agreement.n < dim.thresholds.minSamples) return { label: '样本不足', tone: 'na' }
  const agreement = stat.agreement.agree / stat.agreement.n
  const passRate = stat.caseRate[0] / stat.caseRate[1]
  if (agreement >= dim.thresholds.agreement && passRate >= 0) {
    return { label: '可放手', tone: 'pass' }
  }
  return { label: '需人工', tone: 'warn' }
}

export type Pair = { judge: Verdict; human: Verdict }

export function agreementStats(pairs: Pair[], judgeTotal: number) {
  const labeled = pairs.length
  const valid = pairs.filter((p) => p.judge !== 'na' && p.human !== 'na' && p.judge !== 'error')
  const agree = valid.filter((p) => p.judge === p.human).length
  const naAny = pairs.filter((p) => p.judge === 'na' || p.human === 'na').length
  return {
    labeled,
    denominator: valid.length,
    agree,
    rate: valid.length ? agree / valid.length : null,
    naRatio: labeled ? naAny / labeled : null,
    coverage: judgeTotal ? labeled / judgeTotal : null,
  }
}

export function pct(v: number | null, digits = 1) {
  return v === null ? '—' : `${(v * 100).toFixed(digits)}%`
}
