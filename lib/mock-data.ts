import { demoData, hasGroundTruth, shortTime, turnFieldValues, turnScores, type DemoCase } from './demo-data'
import { goldenCases, goldenDatasets } from './golden-seed'

export type Verdict = 'pass' | 'fail' | 'na' | 'error'

export type Dataset = {
  id: string
  name: string
  version: string
  caseCount: number
  tags: string[]
  defaultGt: boolean
  updatedAt: string
}

export type CaseItem = {
  id: string
  datasetId: string
  query: string[]
  tags: string[]
  workspaceSize: string
  gtSource: 'case' | 'dataset' | 'missing'
  gtKeys: string[]
  valid: boolean
  invalidReason?: string
  raw?: Record<string, unknown>
}

export const DEMO_AGENT_ID = 'ag_skill'

export type FieldContext = { kind: 'tools' } | { kind: 'enum'; values: { value: string; meaning: string }[] }

export type FieldEntry = {
  logicalName: string
  paths: string[]
  avgTokens: number
  description: string
  source?: 'sim' | 'derived'
  script?: string
  context?: FieldContext
}

export const fieldDictVersion = 'fd_v1'

const datasetOrder = (c: DemoCase) => {
  const datasetId = goldenCases.find((g) => g.id === c.caseId)?.datasetId
  const i = goldenDatasets.findIndex((d) => d.id === datasetId)
  return i === -1 ? goldenDatasets.length : i
}

const demoCases = [...demoData.cases].sort((a, b) => datasetOrder(a) - datasetOrder(b))
const demoTurns = demoCases.flatMap((c) => c.turns.map((t) => ({ c, t })))
const turnValues = demoTurns.map(({ c, t }) => turnFieldValues(c, t))

const avgTokens = (name: string) => {
  const sizes = turnValues.map((v) => v[name]?.length ?? 0).filter((n) => n > 0)
  return sizes.length ? Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 1.4) : 0
}

const turnField = (logicalName: string, key: string, description: string, context?: FieldContext): FieldEntry => ({
  logicalName,
  paths: [`sim_traj.turns[].${key}`],
  avgTokens: avgTokens(logicalName),
  description,
  ...(context ? { context } : {}),
})

const caseField = (logicalName: string, description: string): FieldEntry => ({
  logicalName,
  paths: [`sim_traj.${logicalName}`],
  avgTokens: avgTokens(logicalName),
  description,
})

const derivedField = (logicalName: string, script: string, description: string): FieldEntry => ({
  logicalName,
  paths: [`derived.${script}.${logicalName}`],
  avgTokens: avgTokens(logicalName),
  description,
  source: 'derived',
  script,
})

export const fieldDict: FieldEntry[] = [
  turnField('user_query', 'query', '用户指令'),
  turnField('agent_reply', 'agent_reply', 'Agent 回复'),
  turnField('action_sequence', 'action_sequence', '本轮工具调用序列', { kind: 'tools' }),
  turnField('turn_status', 'status', '轮次终态', { kind: 'enum', values: [{ value: 'success(stop)', meaning: '正常结束' }] }),
  turnField('interactive_cards', 'interactive_cards', '澄清卡内容与选择'),
  turnField('write_confirm', 'write_confirm', '写入确认卡'),
  turnField('file_actions', 'file_actions', '本轮文件写入'),
  turnField('workspace_before', 'workspace_before', '本轮前工作区'),
  turnField('workspace_after', 'workspace_after', '本轮后工作区'),
  { logicalName: 'ground_truth', paths: ['sim_traj.turns_gt.turn_1'], avgTokens: avgTokens('ground_truth'), description: '判定准绳（GT 要点）' },
  caseField('scenario_bucket', '场景分桶'),
  caseField('task_type', '任务类型'),
  caseField('input_type', '输入类型'),
  caseField('has_initial_workspace', '是否带初始工作区'),
  derivedField('interaction_flow', 'interaction_flow', '交互流程摘要（挂起、澄清、确认）'),
  derivedField('diff_stats', 'workspace_diff', '工作区差分统计'),
  derivedField('metadata_diff_text', 'workspace_diff', '元数据差分'),
  derivedField('scoped_modified_diff', 'workspace_diff', '变动切片'),
  derivedField('skeleton_radar_summary', 'section_radar', '章节骨架雷达'),
  derivedField('temporal_audit_summary', 'temporal_tracker', '多轮时序审计'),
]

const clip = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max)}…` : text)

const sampleCase = demoCases.find((c) => c.turns.some((t) => t.cards.length > 0)) ?? demoCases[0]
const sampleTurn = sampleCase.turns[0]

export const sampleSimTraj = {
  sim_traj: {
    case_id: sampleCase.caseId,
    ...sampleCase.labels,
    turns_gt: { turn_1: sampleTurn.gt },
    turns: [
      {
        query: sampleTurn.query,
        agent_reply: clip(sampleTurn.agentReply),
        status: sampleTurn.status,
        action_sequence: sampleTurn.actions,
        interactive_cards: sampleTurn.cards.map((card) => ({ title: card.title, selected: card.selected })),
        write_confirm: sampleTurn.writeConfirm,
        file_actions: sampleTurn.fileOps,
        workspace_before: clip(sampleTurn.wsBefore),
        workspace_after: clip(sampleTurn.wsAfter),
      },
    ],
  },
}

const derivedNames = fieldDict.filter((f) => f.source === 'derived').map((f) => f.logicalName)

export const derivedSamples: Record<string, string> = Object.fromEntries(
  derivedNames.flatMap((name) => {
    const value = turnValues.find((v) => v[name])?.[name]
    return value ? [[name, clip(value, 400)]] : []
  }),
)

export type Dimension = {
  key: string
  name: string
  gtKey: string
  scoreType: 'binary'
  thresholds: { release: number; agreement: number; minSamples: number }
  enabled: boolean
}

type DimDef = {
  key: string
  name: string
  gtKey: string
  scorerId: string
  scorerName: string
  implType: Scorer['implType']
  inputFields: string[]
  scriptId?: string
  evidenceScript?: string
}

const dimDefs: DimDef[] = [
  { key: '1.1', name: '意图识别准确率', gtKey: 'gt_1_1_intent', scorerId: 'sc_intent', scorerName: '意图识别裁判', implType: 'llm_judge', inputFields: ['user_query', 'agent_reply', 'action_sequence', 'interaction_flow', 'ground_truth'], evidenceScript: 'interaction_flow' },
  { key: '2.1', name: '澄清追问准确率', gtKey: 'gt_2_1_clarification', scorerId: 'sc_clarify', scorerName: '澄清卡质量裁判', implType: 'llm_judge', inputFields: ['user_query', 'interactive_cards', 'ground_truth'] },
  { key: '3.2', name: '多轮上下文更新', gtKey: 'gt_3_2_context_update', scorerId: 'sc_context', scorerName: '多轮上下文更新裁判', implType: 'hybrid', inputFields: ['user_query', 'agent_reply', 'skeleton_radar_summary', 'scoped_modified_diff', 'temporal_audit_summary', 'ground_truth'], evidenceScript: 'section_radar + temporal_tracker' },
  { key: '4.1', name: 'SKILL 结构合规率', gtKey: 'gt_4_1_structure', scorerId: 'sc_structure', scorerName: 'SKILL 结构校验', implType: 'script', inputFields: ['workspace_after'], scriptId: 'judge2_workspace_code:check_skill_md_structure' },
  { key: '4.2', name: '输出质量忠实度', gtKey: 'gt_4_2_quality', scorerId: 'sc_quality', scorerName: '输出质量裁判', implType: 'llm_judge', inputFields: ['user_query', 'agent_reply', 'scoped_modified_diff', 'ground_truth'], evidenceScript: 'workspace_diff' },
  { key: '5.1', name: '定向修改与内容保护率', gtKey: 'gt_5_1_targeted', scorerId: 'sc_targeted', scorerName: '定向修改与内容保护裁判', implType: 'hybrid', inputFields: ['user_query', 'agent_reply', 'diff_stats', 'metadata_diff_text', 'skeleton_radar_summary', 'scoped_modified_diff', 'ground_truth'], evidenceScript: 'workspace_diff + section_radar' },
  { key: '6.1', name: '职责边界遵循率', gtKey: 'gt_6_1_boundary', scorerId: 'sc_boundary', scorerName: '职责边界裁判', implType: 'llm_judge', inputFields: ['user_query', 'agent_reply', 'action_sequence', 'ground_truth'] },
  { key: '6.2', name: '安全风险处理正确率', gtKey: 'gt_6_2_safety', scorerId: 'sc_safety', scorerName: '安全风险处理裁判', implType: 'llm_judge', inputFields: ['user_query', 'agent_reply', 'ground_truth'] },
]

export const dimensions: Dimension[] = dimDefs.map((d) => ({
  key: d.key,
  name: d.name,
  gtKey: d.gtKey,
  scoreType: 'binary',
  thresholds: { release: 0.85, agreement: 0.85, minSamples: 10 },
  enabled: true,
}))

export type Scorer = {
  id: string
  name: string
  outputs: string[]
  implType: 'llm_judge' | 'script' | 'hybrid'
  inputFields: string[]
  fixedInputs?: { name: string; kind: 'text' | 'file'; value: string }[]
  promptVersion?: string
  judgeModel?: string
  promptTemplate?: string
  background?: string
  scriptId?: string
  scriptHash?: string
  evidenceScript?: string
  status: 'draft' | 'published'
  version: number
  createdBy: string
}

const scorerIdOfDim = (dim: string) => dimDefs.find((d) => d.key === dim)?.scorerId ?? dimDefs[0].scorerId

export const scorers: Scorer[] = dimDefs.map((d) => {
  const prompt = demoData.dimPrompts[d.key]
  return {
    id: d.scorerId,
    name: d.scorerName,
    outputs: [d.key],
    implType: d.implType,
    inputFields: d.inputFields,
    ...(prompt
      ? {
          promptVersion: `${d.scorerId.replace(/^sc_/, 'pt_')}@v1`,
          judgeModel: 'openai/gpt-5.4-mini',
          promptTemplate: `${prompt}\n\n${d.inputFields.map((f) => `## ${f}\n{{${f}}}`).join('\n')}`,
        }
      : {}),
    scriptId: d.scriptId,
    evidenceScript: d.evidenceScript,
    status: 'published',
    version: 1,
    createdBy: '评测开发',
  }
})

export type SimJobStatus = 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed'

export type SimJob = {
  id: string
  datasetId: string
  script: string
  status: SimJobStatus
  done: number
  total: number
  failed: number
  startedAt: string
  snapshotId?: string
  stageId?: string
  configVersionId?: string
  errors: { caseId: string; type: string; detail: string }[]
}

export type Snapshot = {
  id: string
  jobId: string
  datasetId: string
  cases: number
  turns: number
  frozenAt: string
  status: 'completed' | 'partial_failed'
  missingCases: number
  note?: string
  stageId?: string
  configVersionId?: string
}

const demoRuns = demoCases.map((c, i) => {
  const datasetId = goldenCases.find((g) => g.id === c.caseId)?.datasetId ?? `ds_${c.caseId}`
  const slug = datasetId.replace(/^ds_dim_/, '')
  const dimKeys = Array.from(new Set(c.turns.flatMap((t) => Object.keys(turnScores(t)))))
  const configVersionId = i < 3 ? 'cv_w1_v1' : i === 3 ? 'cv_w2_v1' : i === 4 ? 'cv_w2_v2' : 'cv_w2_v3'
  return {
    c,
    stageId: i < 3 ? 'stg_w1' : 'stg_w2',
    configVersionId,
    datasetId,
    datasetName: goldenDatasets.find((d) => d.id === datasetId)?.name ?? c.caseId,
    jobId: `job_${slug}`,
    snapshotId: `snap_${slug}`,
    expId: `exp_${slug}`,
    runId: `run_${slug}`,
    dimKeys,
    scorerIds: dimKeys.map(scorerIdOfDim),
    note: `澄清策略 ${Array.from(new Set(c.turns.map((t) => t.clarifyPolicy).filter(Boolean))).join(' / ') || '—'}`,
    at: shortTime(c.runTime),
  }
})

export const simJobs: SimJob[] = demoRuns.map((r) => ({
  id: r.jobId,
  datasetId: r.datasetId,
  script: '01_simulate_single.py',
  status: 'completed',
  done: 1,
  total: 1,
  failed: 0,
  startedAt: r.at,
  snapshotId: r.snapshotId,
  stageId: r.stageId,
  configVersionId: r.configVersionId,
  errors: [],
}))

export const snapshots: Snapshot[] = demoRuns.map((r) => ({
  id: r.snapshotId,
  jobId: r.jobId,
  datasetId: r.datasetId,
  cases: 1,
  turns: r.c.turns.length,
  frozenAt: r.at,
  status: 'completed',
  missingCases: 0,
  note: r.note,
  stageId: r.stageId,
  configVersionId: r.configVersionId,
}))

export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed'

export type Run = {
  id: string
  experimentId: string
  status: RunStatus
  units: number
  doneUnits: number
  errors: number
  startedAt: string
  cost: string
}

export type Experiment = {
  id: string
  name: string
  snapshotId: string
  scorerIds: string[]
  weights: Record<string, number>
  createdBy: string
  createdAt: string
  fieldDictVersion: string
}

export const experiments: Experiment[] = demoRuns.map((r) => ({
  id: r.expId,
  name: r.datasetName,
  snapshotId: r.snapshotId,
  scorerIds: r.scorerIds,
  weights: Object.fromEntries(r.dimKeys.map((k) => [k, Number((1 / r.dimKeys.length).toFixed(2))])),
  createdBy: '评测开发',
  createdAt: r.at,
  fieldDictVersion,
}))

export const runs: Run[] = demoRuns.map((r) => {
  const units = r.c.turns.reduce((n, t) => n + Object.keys(turnScores(t)).length, 0)
  return { id: r.runId, experimentId: r.expId, status: 'completed', units, doneUnits: units, errors: 0, startedAt: r.at, cost: '—' }
})

export type DimStat = {
  key: string
  caseRate: [number, number]
  turnRate: [number, number]
  participated: number
  total: number
  na: number
  naMissingGt: number
  error: number
  agreement: { agree: number; n: number; stale: boolean }
}

export type RunStats = {
  runId: string
  status: RunStatus
  caseRate: [number, number]
  agreement: { agree: number; n: number }
  pass: number
  fail: number
  na: number
  error: number
  dims: DimStat[]
  failTop: { caseId: string; dim: string; reason: string }[]
  disagreeTop: { caseId: string; turn: number; dim: string; judge: Verdict; human: Verdict }[]
  cost: { tokens: string; calls: number; fee: string }
}

export const runStats: Record<string, RunStats> = Object.fromEntries(
  demoRuns.map((r) => {
    const scored = r.c.turns.flatMap((t) => Object.entries(turnScores(t)).map(([dim, score]) => ({ t, dim, score })))
    const dims: DimStat[] = r.dimKeys.map((dim) => {
      const rows = scored.filter((s) => s.dim === dim)
      const judged = rows.filter((s) => s.score)
      const passed = judged.filter((s) => s.score?.pass).length
      const na = rows.length - judged.length
      return {
        key: dim,
        caseRate: [judged.length > 0 && passed === judged.length ? 1 : 0, 1],
        turnRate: [passed, judged.length],
        participated: judged.length,
        total: r.c.turns.length,
        na,
        naMissingGt: rows.filter((s) => !s.score && !hasGroundTruth(s.t, s.dim)).length,
        error: 0,
        agreement: { agree: 0, n: 0, stale: false },
      }
    })
    const pass = scored.filter((s) => s.score?.pass).length
    const fail = scored.filter((s) => s.score && !s.score.pass).length
    const stats: RunStats = {
      runId: r.runId,
      status: 'completed',
      caseRate: [r.c.eval?.passed ? 1 : 0, 1],
      agreement: { agree: 0, n: 0 },
      pass,
      fail,
      na: scored.length - pass - fail,
      error: 0,
      dims,
      failTop: scored.filter((s) => s.score && !s.score.pass).map((s) => ({ caseId: `${r.c.caseId}#${s.t.turn}`, dim: s.dim, reason: s.score?.reason ?? '' })),
      disagreeTop: [],
      cost: { tokens: '—', calls: r.c.turns.filter((t) => t.judge && !t.skipped).length, fee: '—' },
    }
    return [r.runId, stats]
  }),
)

export type ReviewOption = { key: string; label: string; value: Verdict; tone: 'pass' | 'fail' | 'na' }

export const reviewSchema = {
  scope: 'turn' as const,
  options: [
    { key: '1', label: '通过', value: 'pass', tone: 'pass' },
    { key: '2', label: '失败', value: 'fail', tone: 'fail' },
    { key: '3', label: '不适用', value: 'na', tone: 'na' },
  ] as ReviewOption[],
  note: true,
  caseVerdictRule: 'all_turns_pass',
}

export type Evidence = { view: string; title: string; summary?: string; data: unknown }

export type ReviewTurn = {
  caseId: string
  turnNo: number
  totalTurns: number
  user: string
  agent: string
  tools: { name: string; args: string; ok: boolean }[]
  judgments: { dim: string; scorerId: string; verdict: Verdict; reason: string; shortCircuit?: boolean; evidence?: Evidence }[]
  workspace: { meta: { key: string; before: string; after: string }[]; before: string; after: string }
  gt?: { key: string; points: string[] }[]
  cards?: { title: string; options: { label: string; recommended: boolean }[]; selected: string[] }[]
  writeConfirm?: { title: string; confirmed: boolean }
}

export const reviewTurns: ReviewTurn[] = demoTurns.map(({ c, t }) => ({
  caseId: c.caseId,
  turnNo: t.turn,
  totalTurns: c.turns.length,
  user: t.query,
  agent: t.agentReply,
  tools: t.actions.map((name) => ({ name, args: '', ok: true })),
  judgments: Object.entries(turnScores(t)).map(([dim, score]) => ({
    dim,
    scorerId: scorerIdOfDim(dim),
    verdict: score ? (score.pass ? 'pass' : 'fail') : 'na',
    reason: score ? score.reason : t.skipReason || '本轮无 GT，不评',
    evidence: score?.evidence ? { view: 'text', title: '证据分析', data: score.evidence } : undefined,
  })),
  workspace: { meta: t.wsMeta, before: t.wsBefore, after: t.wsAfter },
  gt: Object.entries(t.gt)
    .filter(([, points]) => points.length > 0)
    .map(([key, points]) => ({ key, points })),
  cards: t.cards,
  writeConfirm: t.writeConfirm ? { title: t.writeConfirm, confirmed: t.writeConfirmed } : undefined,
}))
