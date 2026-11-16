'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

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
  models: ModelBinding[]
  tasks: EvalTask[]
}
export type ProductLine = { id: string; name: string; code: string; owner: string; desc: string; agents: Agent[] }

export const roleLabel: Record<ModelRole, string> = { target: '被测模型', judge: '裁判模型', sim_user: '仿真用户' }
export const scheduleLabel: Record<TaskSchedule, string> = { manual: '手动触发', daily: '每日定时', pre_release: '发布前门禁' }

const seedLines: ProductLine[] = [
  {
    id: 'pl_doc',
    name: '文档协作',
    code: 'doc',
    owner: '张晨',
    desc: '在线文档编辑与问答类 Agent',
    agents: [
      {
        id: 'ag_doc_editor',
        name: '文档编辑助手',
        code: 'doc-editor',
        endpoint: 'https://agent.internal/doc-editor/v1/chat',
        protocol: 'SSE',
        owner: '张晨',
        models: [
          { id: 'm1', role: 'target', model: 'openai/gpt-5' },
          { id: 'm2', role: 'judge', model: 'openai/gpt-5-mini' },
          { id: 'm3', role: 'sim_user', model: 'anthropic/claude-sonnet-4.5' },
        ],
        tasks: [
          { id: 't1', name: '核心能力回归', dimensions: ['5.1', '5.2', '5.3', '5.4'], schedule: 'pre_release', active: true },
          { id: 't2', name: '澄清行为巡检', dimensions: ['6.1'], schedule: 'daily', active: true },
        ],
      },
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
        tasks: [{ id: 't3', name: '回复完整性', dimensions: ['5.4'], schedule: 'manual', active: true }],
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
        tasks: [{ id: 't4', name: '安全拒答', dimensions: ['6.2'], schedule: 'daily', active: false }],
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
const seedScope: Scope = { lineId: 'pl_doc', agentId: 'ag_doc_editor' }

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
