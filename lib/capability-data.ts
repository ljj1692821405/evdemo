import { experiments } from './mock-data'
import { runContext, viewableRuns } from './runs'

export type AssetKind = 'skill' | 'tool'
export type AssetSource = 'auto' | 'report' | 'manual'

export type AssetVersion = {
  version: string
  at: string
  note: string
  intro: string
  remark: string
  capability?: string
  triggers?: string[]
  input?: string
  output?: string
  uses?: string[]
}

export type Asset = {
  id: string
  kind: AssetKind
  code: string
  name: string
  agentId: string
  source: AssetSource
  versions: AssetVersion[]
}

export type AssetRef = { assetId: string; version: string }

export type AgentConfig = {
  id: string
  agentId: string
  version: string
  at: string
  author: string
  note: string
  refs: AssetRef[]
}

export type ResolvedItem = { asset: Asset; ver: AssetVersion }

export type FrozenItem = { kind: AssetKind; code: string; name: string; version: string }
export type FrozenSnapshot = {
  expId: string
  agentId: string
  agentCode: string
  configVersion: string
  backgroundVersion?: string
  frozenAt: string
  items: FrozenItem[]
}

export const kindLabel: Record<AssetKind, string> = { skill: 'Skill', tool: 'Tool' }
export const sourceLabel: Record<AssetSource, string> = { auto: '自动采集', report: '接口上报', manual: '手动维护' }

export const seedAssets: Asset[] = [
  {
    id: 'sk_doc_edit',
    kind: 'skill',
    code: 'doc-edit',
    name: '文档改写',
    agentId: 'ag_skill',
    source: 'auto',
    versions: [
      { version: 'v1', at: '10-20 10:00', note: '首次登记', intro: '对选中段落进行改写、润色与格式调整。', remark: '主链路能力，覆盖 70% 用户请求。', capability: '理解改写意图并生成局部修改指令', triggers: ['用户要求润色/改写', '选区非空'], uses: ['doc.read', 'doc.edit'] },
      { version: 'v2', at: '11-08 14:20', note: '支持跨段落改写，改写前先检索上下文', intro: '对选中段落或跨段落内容进行改写、润色与格式调整。', remark: '主链路能力，覆盖 70% 用户请求。', capability: '理解改写意图，检索上下文后生成跨段落修改指令', triggers: ['用户要求润色/改写', '选区非空', '引用其它章节'], uses: ['doc.read', 'doc.search', 'doc.edit'] },
    ],
  },
  {
    id: 'sk_outline',
    kind: 'skill',
    code: 'outline',
    name: '大纲生成',
    agentId: 'ag_skill',
    source: 'auto',
    versions: [
      { version: 'v1', at: '10-20 10:00', note: '首次登记', intro: '根据主题与已有内容生成文档大纲。', remark: '新建文档场景。', capability: '主题拆解与层级结构生成', triggers: ['空文档', '用户要求列提纲'], uses: ['outline.gen', 'doc.edit'] },
    ],
  },
  {
    id: 'sk_clarify',
    kind: 'skill',
    code: 'clarify',
    name: '意图澄清',
    agentId: 'ag_skill',
    source: 'report',
    versions: [
      { version: 'v1', at: '11-12 09:40', note: '新增：指令含糊时主动追问', intro: '在用户指令存在歧义时生成澄清问题。', remark: '对应维度 6.1 澄清时机。', capability: '歧义检测与追问生成', triggers: ['指代不明', '修改范围不明确'], uses: ['doc.read'] },
    ],
  },
  {
    id: 'tl_doc_read',
    kind: 'tool',
    code: 'doc.read',
    name: '读取文档',
    agentId: 'ag_skill',
    source: 'auto',
    versions: [
      { version: 'v1', at: '10-20 10:00', note: '首次登记', intro: '按块读取当前文档内容。', remark: '只读，无副作用。', input: '{ docId: string, range?: [start, end] }', output: '{ blocks: Block[] }' },
    ],
  },
  {
    id: 'tl_doc_edit',
    kind: 'tool',
    code: 'doc.edit',
    name: '编辑文档',
    agentId: 'ag_skill',
    source: 'auto',
    versions: [
      { version: 'v2', at: '10-20 10:00', note: '首次登记', intro: '对指定块执行插入/替换/删除。', remark: '有副作用，需校验 workspace 变更。', input: '{ docId, ops: EditOp[] }', output: '{ ok: boolean, rev: number }' },
      { version: 'v3', at: '11-12 09:40', note: '支持批量 ops 原子提交，返回 diff', intro: '对指定块执行插入/替换/删除，支持批量原子提交。', remark: '有副作用，需校验 workspace 变更。', input: '{ docId, ops: EditOp[], atomic?: boolean }', output: '{ ok: boolean, rev: number, diff: Diff }' },
    ],
  },
  {
    id: 'tl_doc_search',
    kind: 'tool',
    code: 'doc.search',
    name: '文档检索',
    agentId: 'ag_skill',
    source: 'auto',
    versions: [
      { version: 'v1', at: '11-08 14:20', note: '新增：语义检索文档片段', intro: '在当前文档内语义检索相关片段。', remark: '供跨段落改写使用。', input: '{ docId, query: string, topK?: number }', output: '{ hits: { blockId, score }[] }' },
    ],
  },
  {
    id: 'tl_outline_gen',
    kind: 'tool',
    code: 'outline.gen',
    name: '大纲模板',
    agentId: 'ag_skill',
    source: 'manual',
    versions: [
      { version: 'v1', at: '10-20 10:00', note: '首次登记（手动维护，Agent 无法上报）', intro: '返回预置的大纲模板。', remark: '由运营维护模板库。', input: '{ topic: string }', output: '{ outline: Node[] }' },
    ],
  },
  {
    id: 'tl_ask_clarification',
    kind: 'tool',
    code: 'askClarification',
    name: '澄清卡',
    agentId: 'ag_skill',
    source: 'manual',
    versions: [{ version: 'v1', at: '11-16 10:00', note: '首次登记', intro: '弹出澄清卡，挂起等待用户作答。', remark: '' }],
  },
  {
    id: 'tl_emit_skill_file',
    kind: 'tool',
    code: 'emitSkillFile',
    name: '写回文件',
    agentId: 'ag_skill',
    source: 'manual',
    versions: [{ version: 'v1', at: '11-16 10:00', note: '首次登记', intro: '向工作区写入/覆盖指定文件。', remark: '' }],
  },
  {
    id: 'tl_get_editing_skill',
    kind: 'tool',
    code: 'getEditingSkill',
    name: '读取 Skill',
    agentId: 'ag_skill',
    source: 'manual',
    versions: [{ version: 'v1', at: '11-16 10:00', note: '首次登记', intro: '读取当前编辑中的 Skill 内容。', remark: '' }],
  },
  {
    id: 'sk_doc_qa',
    kind: 'skill',
    code: 'doc-answer',
    name: '文档问答',
    agentId: 'ag_doc_qa',
    source: 'report',
    versions: [
      { version: 'v1', at: '10-25 11:00', note: '首次上报', intro: '基于文档内容回答用户问题。', remark: '', capability: '检索增强回答', triggers: ['用户提问'], uses: ['kb.search'] },
    ],
  },
  {
    id: 'tl_kb_search',
    kind: 'tool',
    code: 'kb.search',
    name: '知识库检索',
    agentId: 'ag_doc_qa',
    source: 'report',
    versions: [
      { version: 'v1', at: '10-25 11:00', note: '首次上报', intro: '在知识库中检索相关段落。', remark: '', input: '{ query: string }', output: '{ passages: string[] }' },
    ],
  },
]

export const seedConfigs: AgentConfig[] = [
  {
    id: 'cfg_doc_editor_v1_0',
    agentId: 'ag_skill',
    version: 'v1.0',
    at: '10-20 10:00',
    author: '张晨',
    note: '初始能力配置',
    refs: [
      { assetId: 'sk_doc_edit', version: 'v1' },
      { assetId: 'sk_outline', version: 'v1' },
      { assetId: 'tl_doc_read', version: 'v1' },
      { assetId: 'tl_doc_edit', version: 'v2' },
      { assetId: 'tl_outline_gen', version: 'v1' },
    ],
  },
  {
    id: 'cfg_doc_editor_v1_1',
    agentId: 'ag_skill',
    version: 'v1.1',
    at: '11-08 14:20',
    author: '张晨',
    note: '跨段落改写：doc-edit 升级 v2，新增 doc.search',
    refs: [
      { assetId: 'sk_doc_edit', version: 'v2' },
      { assetId: 'sk_outline', version: 'v1' },
      { assetId: 'tl_doc_read', version: 'v1' },
      { assetId: 'tl_doc_edit', version: 'v2' },
      { assetId: 'tl_doc_search', version: 'v1' },
      { assetId: 'tl_outline_gen', version: 'v1' },
    ],
  },
  {
    id: 'cfg_doc_editor_v1_2',
    agentId: 'ag_skill',
    version: 'v1.2',
    at: '11-12 09:40',
    author: '李沐',
    note: '新增澄清 Skill；doc.edit 升级 v3；下线大纲模板工具',
    refs: [
      { assetId: 'sk_doc_edit', version: 'v2' },
      { assetId: 'sk_outline', version: 'v1' },
      { assetId: 'sk_clarify', version: 'v1' },
      { assetId: 'tl_doc_read', version: 'v1' },
      { assetId: 'tl_doc_edit', version: 'v3' },
      { assetId: 'tl_doc_search', version: 'v1' },
    ],
  },
  {
    id: 'cfg_skill_v1_3',
    agentId: 'ag_skill',
    version: 'v1.3',
    at: '11-16 10:00',
    author: '张晨',
    note: '切换为 Skill 工具集：登记 askClarification / emitSkillFile / getEditingSkill，下线 doc.* 工具',
    refs: [
      { assetId: 'sk_doc_edit', version: 'v2' },
      { assetId: 'sk_outline', version: 'v1' },
      { assetId: 'sk_clarify', version: 'v1' },
      { assetId: 'tl_ask_clarification', version: 'v1' },
      { assetId: 'tl_emit_skill_file', version: 'v1' },
      { assetId: 'tl_get_editing_skill', version: 'v1' },
    ],
  },
  {
    id: 'cfg_doc_qa_v1_0',
    agentId: 'ag_doc_qa',
    version: 'v1.0',
    at: '10-25 11:00',
    author: '李沐',
    note: '接口上报初始配置',
    refs: [
      { assetId: 'sk_doc_qa', version: 'v1' },
      { assetId: 'tl_kb_search', version: 'v1' },
    ],
  },
]

export function resolveConfig(cfg: AgentConfig, assets: Asset[]): ResolvedItem[] {
  return cfg.refs.flatMap((r) => {
    const asset = assets.find((a) => a.id === r.assetId)
    const ver = asset?.versions.find((v) => v.version === r.version)
    return asset && ver ? [{ asset, ver }] : []
  })
}

export type ConfigDiff = {
  added: FrozenItem[]
  removed: FrozenItem[]
  modified: (FrozenItem & { from: string })[]
  unchanged: FrozenItem[]
}

export function diffItems(base: FrozenItem[], target: FrozenItem[]): ConfigDiff {
  const key = (i: FrozenItem) => `${i.kind}:${i.code}`
  const baseMap = new Map(base.map((i) => [key(i), i]))
  const targetMap = new Map(target.map((i) => [key(i), i]))
  const diff: ConfigDiff = { added: [], removed: [], modified: [], unchanged: [] }
  for (const t of target) {
    const b = baseMap.get(key(t))
    if (!b) diff.added.push(t)
    else if (b.version !== t.version) diff.modified.push({ ...t, from: b.version })
    else diff.unchanged.push(t)
  }
  for (const b of base) if (!targetMap.has(key(b))) diff.removed.push(b)
  return diff
}

export const toFrozen = (items: ResolvedItem[]): FrozenItem[] =>
  items.map(({ asset, ver }) => ({ kind: asset.kind, code: asset.code, name: asset.name, version: ver.version }))

const agentCodes: Record<string, string> = { ag_skill: 'skill-agent', ag_doc_qa: 'doc-qa' }

export const frozenSnapshots: FrozenSnapshot[] = Object.freeze(
  experiments.flatMap((e) => {
    const cfg = seedConfigs.find((c) => c.id === 'cfg_skill_v1_3')
    if (!cfg) return []
    return [
      Object.freeze({
        expId: e.id,
        agentId: cfg.agentId,
        agentCode: agentCodes[cfg.agentId] ?? cfg.agentId,
        configVersion: cfg.version,
        backgroundVersion: 'v1',
        frozenAt: e.createdAt,
        items: toFrozen(resolveConfig(cfg, seedAssets)),
      }),
    ]
  }),
) as FrozenSnapshot[]

export const snapshotForExp = (expId: string) => frozenSnapshots.find((s) => s.expId === expId)

export type ConfigMetric = { configVersion: string; runs: number; pass: number; total: number; rate: number | null }

export function metricsForAgent(agentId: string): Record<string, ConfigMetric> {
  const out: Record<string, ConfigMetric> = {}
  for (const snap of frozenSnapshots.filter((s) => s.agentId === agentId)) {
    const m = (out[snap.configVersion] ??= { configVersion: snap.configVersion, runs: 0, pass: 0, total: 0, rate: null })
    for (const run of viewableRuns.filter((r) => r.experimentId === snap.expId)) {
      const ctx = runContext(run.id)
      if (!ctx) continue
      m.runs += 1
      m.pass += ctx.stats.caseRate[0]
      m.total += ctx.stats.caseRate[1]
    }
    m.rate = m.total ? m.pass / m.total : null
  }
  return out
}
