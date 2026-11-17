import demo from './real/demo.json'

export type DemoScore = { pass: boolean; reason: string; evidence: string }
export type DemoCard = { title: string; options: { label: string; recommended: boolean }[]; selected: string[] }

export type DemoTurn = {
  turn: number
  query: string
  agentReply: string
  status: string
  latency: Record<string, number>
  actions: string[]
  cards: DemoCard[]
  writeConfirm: string | null
  writeConfirmed: boolean
  fileOps: { path: string; op: string; chars: number }[]
  wsBefore: string
  wsAfter: string
  wsMeta: { key: string; before: string; after: string }[]
  gt: Record<string, string[]>
  judge: string | null
  clarifyPolicy: string
  skipped: boolean
  skipReason: string
  scores: Record<string, DemoScore | null>
  inputs: Record<string, unknown>
}

export type DemoCase = {
  caseId: string
  sessionId: string
  runTime: string
  labels: Record<string, string | number | boolean>
  dimensions: string[]
  eval: {
    target: string
    passed: boolean
    checkTotal: number
    checkPassed: number
    summary: Record<string, { failedTurns: number[]; flawBrief: string }>
  } | null
  turns: DemoTurn[]
}

export type DemoJudge = { label: string; promptFile: string; systemPrompt: string }

export const demoData = demo as unknown as {
  judges: Record<string, DemoJudge>
  dimPrompts: Record<string, string>
  scripts: Record<string, string>
  cases: DemoCase[]
}

const mergedInto: Record<string, string> = { '5.2': '5.1' }
const subCheckLabel: Record<string, string> = { dim_5_1_targeted: '定向修改', dim_5_2_preservation: '内容保持' }

export const dimKeyOf = (key: string) => {
  const m = key.match(/^(?:dim|gt)_(\d+)_(\d+)/)
  if (!m) return key
  const dim = `${m[1]}.${m[2]}`
  return mergedInto[dim] ?? dim
}

export function turnScores(t: DemoTurn): Record<string, DemoScore | null> {
  const groups = new Map<string, [string, DemoScore | null][]>()
  for (const entry of Object.entries(t.scores)) {
    const dim = dimKeyOf(entry[0])
    groups.set(dim, [...(groups.get(dim) ?? []), entry])
  }
  return Object.fromEntries(
    Array.from(groups, ([dim, entries]) => {
      const judged = entries.filter((e): e is [string, DemoScore] => e[1] !== null)
      if (!judged.length) return [dim, null]
      if (entries.length === 1) return [dim, judged[0][1]]
      const join = (pick: (s: DemoScore) => string) =>
        judged
          .filter(([, s]) => pick(s))
          .map(([key, s]) => `${subCheckLabel[key] ?? key}：${pick(s)}`)
          .join('\n')
      return [dim, { pass: judged.every(([, s]) => s.pass), reason: join((s) => s.reason), evidence: join((s) => s.evidence) }]
    }),
  )
}

export const hasGroundTruth = (t: DemoTurn, dim: string) => Object.entries(t.gt).some(([key, points]) => dimKeyOf(key) === dim && points.length > 0)

export const shortTime = (runTime: string) => runTime.slice(5, 16)

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function groundTruthText(turn: DemoTurn, dimKeys?: string[]): string | null {
  const blocks = Object.entries(turn.gt)
    .filter(([key, points]) => points.length > 0 && (!dimKeys || dimKeys.includes(dimKeyOf(key))))
    .map(([key, points]) => `【${key}】\n${points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`)
  return blocks.length ? blocks.join('\n\n') : null
}

export function turnFieldValues(c: DemoCase, t: DemoTurn): Record<string, string | null> {
  const values: Record<string, string | null> = {
    user_query: t.query,
    agent_reply: t.agentReply,
    action_sequence: JSON.stringify(t.actions),
    turn_status: t.status,
    interactive_cards: t.cards.length ? JSON.stringify(t.cards.map((card) => ({ title: card.title, options: card.options.map((o) => o.label), selected: card.selected })), null, 2) : null,
    write_confirm: t.writeConfirm,
    file_actions: t.fileOps.length ? JSON.stringify(t.fileOps) : null,
    workspace_before: t.wsBefore || null,
    workspace_after: t.wsAfter || null,
    ground_truth: groundTruthText(t),
  }
  for (const [key, value] of Object.entries(c.labels)) values[key] = String(value)
  for (const [key, value] of Object.entries(t.inputs)) {
    if (!(key in values)) values[key] = asText(value)
  }
  return values
}
