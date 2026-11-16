import { cases, dimensions, snapshots, type Scorer, type Verdict } from './mock-data'

export type TrialUnit = {
  key: string
  caseId: string
  turn: number
  turns: number
  query: string
  tags: string[]
  gtKeys: string[]
}

const syntheticQueries = [
  '把第三段压缩到 50 字以内',
  '表格按金额降序排列',
  '给每个小节加编号',
  '把「客户」统一替换成「用户」',
  '在文末补一段总结',
  '删除所有空行',
]

export function trialUnits(snapshotId: string): TrialUnit[] {
  const snap = snapshots.find((s) => s.id === snapshotId)
  if (!snap) return []
  const source = cases.filter((c) => c.datasetId === snap.datasetId && c.valid)
  if (source.length) {
    return source.flatMap((c) =>
      c.query.map((q, i) => ({
        key: `${c.id}#${i + 1}`,
        caseId: c.id,
        turn: i + 1,
        turns: c.query.length,
        query: q,
        tags: c.tags,
        gtKeys: c.gtKeys,
      })),
    )
  }
  return syntheticQueries.map((q, i) => {
    const id = `case_${String(i + 201 + snap.cases).padStart(4, '0')}`
    return { key: `${id}#1`, caseId: id, turn: 1, turns: 1, query: q, tags: ['编辑'], gtKeys: i % 2 ? ['intent'] : ['intent', 'reply'] }
  })
}

const replies: Record<string, string> = {
  case_0001: '已将「项目进度」更新为 80%，并在该节末尾补充：排期存在 1 周延期风险，主要受接口联调影响。',
  case_0002: '好的，请问需要按哪种方式整理？',
  case_0003: '已删除 6 行重复客户记录（按客户编号去重），保留最早创建的一条。',
  case_0004: 'The second paragraph has been translated into English; glossary terms were kept as-is.',
  case_0007: '已将全文 14 处日期统一为 YYYY-MM-DD 格式。',
  case_0008: '已在合同最前面插入摘要（96 字）。',
  case_0010: '已将标题改为「三步搞定周报：效率翻倍的写作清单」。',
}

export function fieldValues(u: TrialUnit): Record<string, string | null> {
  const reply = u.caseId === 'case_0002' && u.turn === 2
    ? '已按负责人分组整理出 7 条行动项。'
    : replies[u.caseId] ?? `已完成：${u.query}`
  const isClarifyTurn = u.caseId === 'case_0002' && u.turn === 1
  return {
    user_query: u.query,
    agent_reply: reply,
    tool_calls: isClarifyTurn
      ? '[]'
      : JSON.stringify([{ name: 'doc.read', args: { doc_id: 'wk_46' } }, { name: 'doc.edit', args: { op: 'replace' } }], null, 2),
    workspace_before: '# 周报 W46\n## 项目进度\n当前完成 65%。\n## 下周计划\n…',
    workspace_after: '# 周报 W46\n## 项目进度\n当前完成 80%。排期存在 1 周延期风险，主要受接口联调影响。\n## 下周计划\n…',
    workspace_diff: isClarifyTurn ? null : '@@ -3 +3 @@\n- 当前完成 65%。\n+ 当前完成 80%。排期存在 1 周延期风险，主要受接口联调影响。',
    clarify_question: isClarifyTurn ? '请问需要按哪种方式整理？' : null,
    turn_status: isClarifyTurn ? 'awaiting_user' : 'completed',
  }
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

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function runTrial(scorer: Scorer, u: TrialUnit, template: string, refs: string[], model: string, seq: number): TrialResult {
  const values = fieldValues(u)
  const unbound = refs.filter((r) => !scorer.inputFields.includes(r))
  const missing = scorer.inputFields.filter((f) => values[f] == null)
  const h = hash(`${scorer.id}${u.key}${model}${template.length}`)
  const tokensIn = Math.round(scorer.inputFields.reduce((s, f) => s + (values[f]?.length ?? 0), 0) * 1.4 + template.length * 0.8)

  const dims: DimResult[] = scorer.outputs.map((key, i) => {
    const dim = dimensions.find((d) => d.key === key)
    const gt: Verdict | null = dim && u.gtKeys.includes(dim.gtKey) ? ((h >> i) % 5 === 0 ? 'fail' : 'pass') : null
    let verdict: Verdict
    if (unbound.length) verdict = 'error'
    else if (missing.length && i === 0) verdict = 'na'
    else verdict = (h >> (i + 2)) % 4 === 0 ? 'fail' : 'pass'
    const field = scorer.inputFields.find((f) => f !== 'user_query' && values[f]) ?? 'user_query'
    const evidence =
      verdict === 'error'
        ? []
        : [
            { field: 'user_query', quote: u.query.slice(0, 40) },
            { field, quote: (values[field] ?? '').split('\n').find((l) => l.trim() && !l.startsWith('@@') && !l.startsWith('#'))?.slice(0, 60) ?? '' },
          ]
    const reason =
      verdict === 'error'
        ? `变量未绑定：${unbound.join(', ')}`
        : verdict === 'na'
          ? `${missing.join(', ')} 为空`
          : verdict === 'pass'
            ? '回复覆盖了请求中的全部意图'
            : '回复遗漏了请求中的部分要求'
    return { key, verdict, gt, evidence, reason }
  })

  const now = new Date()
  return {
    id: `tr_${seq}`,
    unitKey: u.key,
    model,
    at: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
    latencyMs: unbound.length ? 12 : 800 + (h % 1600),
    tokensIn: unbound.length ? 0 : tokensIn,
    tokensOut: unbound.length ? 0 : 120 + (h % 80),
    cost: unbound.length ? 0 : Number(((tokensIn * 0.25 + 150 * 2) / 1_000_000 * 7.2).toFixed(4)),
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
      : Object.fromEntries(dims.map((d) => [d.key, { verdict: d.verdict, reason: d.reason, evidence: d.evidence.map((e) => e.quote) }])),
  }
}
