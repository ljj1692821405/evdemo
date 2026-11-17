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
  scripts: Record<string, string>
  cases: DemoCase[]
}

export const dimKeyOf = (key: string) => {
  const m = key.match(/^(?:dim|gt)_(\d+)_(\d+)/)
  return m ? `${m[1]}.${m[2]}` : key
}

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
