'use client'

import { useCallback } from 'react'
import { DEMO_AGENT_ID } from './mock-data'
import { useShared } from './shared-store'

export type ModelRole = 'target' | 'judge' | 'sim_user'
export type Protocol = 'HTTP' | 'SSE' | 'gRPC'
export type TaskSchedule = 'manual' | 'daily' | 'pre_release'

export type ModelBinding = { id: string; role: ModelRole; model: string }
export type EvalTask = { id: string; name: string; dimensions: string[]; schedule: TaskSchedule; active: boolean }
export type Agent = {
  id: string
  name: string
  code: string
  endpoint: string
  protocol: Protocol
  owner: string
  background?: string
  backgroundVersion?: number
  dataSourceNote?: string
  models: ModelBinding[]
  tasks: EvalTask[]
}
export type ProductLine = { id: string; name: string; code: string; owner: string; desc: string; agents: Agent[] }

export const roleLabel: Record<ModelRole, string> = { target: '被测模型', judge: '裁判模型', sim_user: '仿真用户' }
export const scheduleLabel: Record<TaskSchedule, string> = { manual: '手动触发', daily: '每日定时', pre_release: '发布前门禁' }

const skillAgentBackground = `Skill-Agent 负责创建和编辑 Skill 文件，写入前需经用户确认。
1. 模糊意图：Agent 调 askClarification 弹出澄清卡 → 挂起等待 → 用户作答 → 自动调 emitSkillFile 写入
2. 明确意图：Agent 不弹澄清卡 → 直接弹写入确认卡 → 用户确认 → 写入`

const skillAgentDataSourceNote = `1. Case 最简结构为 query + 工作区快照，另带用于统计分桶的标签字段。
2. 仿真脚本只读取其中几个字段，请求 Agent 并同步后处理；仿真结果包含 Case 全部字段，由评测开发在脚本中保证。
3. 多轮对话以 turn 为最小评测单元。带初始工作区的 Case 只在首轮记录；后续轮若修改工作区则从 SSE 打捞，未修改则继承上一轮。
4. 工作区 diff 由前置脚本计算，结合用户 query 与 Agent 回复判断：改的地方对不对、有没有改到别的区域。`

const seedLines: ProductLine[] = [
  {
    id: 'pl_heyreel',
    name: 'Heyreel',
    code: 'heyreel',
    owner: '张晨',
    desc: 'Skill 编辑类 Agent',
    agents: [
      {
        id: DEMO_AGENT_ID,
        name: 'Skill-Agent',
        code: 'skill-agent',
        endpoint: 'https://agent.internal/skill-agent/v1/chat',
        protocol: 'SSE',
        owner: '张晨',
        background: skillAgentBackground,
        backgroundVersion: 1,
        dataSourceNote: skillAgentDataSourceNote,
        models: [
          { id: 'm1', role: 'target', model: 'openai/gpt-5' },
          { id: 'm2', role: 'judge', model: 'openai/gpt-5-mini' },
          { id: 'm3', role: 'sim_user', model: 'anthropic/claude-sonnet-4.5' },
        ],
        tasks: [
          { id: 't1', name: '核心能力回归', dimensions: ['1.1', '2.1', '3.2', '4.1', '4.2', '5.1'], schedule: 'pre_release', active: true },
          { id: 't2', name: '边界与安全巡检', dimensions: ['6.1', '6.2'], schedule: 'daily', active: true },
        ],
      },
    ],
  },
  {
    id: 'pl_doc',
    name: '文档协作',
    code: 'doc',
    owner: '张晨',
    desc: '在线文档编辑与问答类 Agent',
    agents: [
      {
        id: 'ag_doc_qa',
        name: '文档问答',
        code: 'doc-qa',
        endpoint: 'https://agent.internal/doc-qa/v2/invoke',
        protocol: 'HTTP',
        owner: '李沐',
        models: [
          { id: 'm4', role: 'target', model: 'openai/gpt-5-mini' },
          { id: 'm5', role: 'judge', model: 'openai/gpt-5' },
        ],
        tasks: [],
      },
    ],
  },
  {
    id: 'pl_cs',
    name: '智能客服',
    code: 'cs',
    owner: '王一',
    desc: '售前/售后客服对话 Agent',
    agents: [
      {
        id: 'ag_cs_bot',
        name: '售后客服',
        code: 'cs-aftersale',
        endpoint: 'grpc://cs-gateway:9090/AfterSale',
        protocol: 'gRPC',
        owner: '王一',
        models: [{ id: 'm6', role: 'target', model: 'google/gemini-2.5-flash' }],
        tasks: [],
      },
    ],
  },
  { id: 'pl_code', name: '研发效能', code: 'code', owner: '赵然', desc: '代码生成与评审 Agent（待接入）', agents: [] },
]

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

export function useLines() {
  const [lines, setLines] = useShared<ProductLine[]>('product-lines', seedLines)

  const updateAgent = useCallback(
    (lineId: string, agentId: string, fn: (a: Agent) => Agent) =>
      setLines((ls) => ls.map((l) => (l.id !== lineId ? l : { ...l, agents: l.agents.map((a) => (a.id === agentId ? fn(a) : a)) }))),
    [setLines],
  )

  return {
    lines,
    addLine: (l: Omit<ProductLine, 'id' | 'agents'>) => {
      const id = uid('pl')
      setLines((ls) => [...ls, { ...l, id, agents: [] }])
      return id
    },
    removeLine: (id: string) => setLines((ls) => ls.filter((l) => l.id !== id)),
    addAgent: (lineId: string, a: Omit<Agent, 'id' | 'models' | 'tasks'>) => {
      const id = uid('ag')
      setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, agents: [...l.agents, { ...a, id, models: [], tasks: [] }] } : l)))
      return id
    },
    removeAgent: (lineId: string, agentId: string) =>
      setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, agents: l.agents.filter((a) => a.id !== agentId) } : l))),
    setBackground: (lineId: string, agentId: string, background: string) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, background, backgroundVersion: (a.backgroundVersion ?? 0) + 1 })),
    setDataSourceNote: (lineId: string, agentId: string, dataSourceNote: string) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, dataSourceNote })),
    addModel: (lineId: string, agentId: string, m: Omit<ModelBinding, 'id'>) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, models: [...a.models, { ...m, id: uid('m') }] })),
    removeModel: (lineId: string, agentId: string, id: string) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, models: a.models.filter((m) => m.id !== id) })),
    addTask: (lineId: string, agentId: string, t: Omit<EvalTask, 'id'>) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, tasks: [...a.tasks, { ...t, id: uid('t') }] })),
    removeTask: (lineId: string, agentId: string, id: string) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, tasks: a.tasks.filter((t) => t.id !== id) })),
    toggleTask: (lineId: string, agentId: string, id: string) =>
      updateAgent(lineId, agentId, (a) => ({ ...a, tasks: a.tasks.map((t) => (t.id === id ? { ...t, active: !t.active } : t)) })),
  }
}

type Scope = { lineId: string; agentId: string }
const seedScope: Scope = { lineId: 'pl_heyreel', agentId: DEMO_AGENT_ID }

export function useScope() {
  const { lines } = useLines()
  const [scope, setScope] = useShared<Scope>('scope', seedScope)
  const line = lines.find((l) => l.id === scope.lineId) ?? lines[0]
  const agent = line?.agents.find((a) => a.id === scope.agentId) ?? line?.agents[0]
  return {
    line,
    agent,
    setLine: (lineId: string) => {
      const l = lines.find((x) => x.id === lineId)
      setScope({ lineId, agentId: l?.agents[0]?.id ?? '' })
    },
    setAgent: (agentId: string) => setScope({ lineId: line?.id ?? '', agentId }),
    setScope,
  }
}

const seedCache = new Map<string, unknown>()

export function useAgentShared<T>(key: string, seed: (isDemo: boolean) => T, agentIdOverride?: string) {
  const { agent } = useScope()
  const agentId = agentIdOverride ?? agent?.id ?? 'none'
  const cacheKey = `${key}:${agentId}`
  if (!seedCache.has(cacheKey)) seedCache.set(cacheKey, seed(agentId === DEMO_AGENT_ID))
  return useShared<T>(cacheKey, seedCache.get(cacheKey) as T)
}
