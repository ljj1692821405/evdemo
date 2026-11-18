'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

export type StageVersionRef = { code: string; name: string; version: string }

export type AgentStage = {
  id: string
  agentId: string
  name: string
  seq: number
  frozenAt: string
  configVersion: string
  targetModel: string
  backgroundVersion: number
  skillVersionRefs: StageVersionRef[]
  toolVersionRefs: StageVersionRef[]
}

export const seedStages: AgentStage[] = [
  {
    id: 'stg_w1',
    agentId: 'ag_skill',
    name: 'w1 阶段',
    seq: 1,
    frozenAt: '11-01 10:00',
    configVersion: 'skill-agent@v1.0',
    targetModel: 'openai/gpt-5',
    backgroundVersion: 1,
    skillVersionRefs: [
      { code: 'doc-edit', name: '文档改写', version: 'v1' },
      { code: 'outline', name: '大纲生成', version: 'v1' },
      { code: 'clarify', name: '意图澄清', version: 'v1' },
    ],
    toolVersionRefs: [
      { code: 'askClarification', name: '澄清卡', version: 'v1' },
      { code: 'emitSkillFile', name: '写入文件', version: 'v1' },
      { code: 'getEditingSkill', name: '读取 Skill', version: 'v1' },
    ],
  },
  {
    id: 'stg_w2',
    agentId: 'ag_skill',
    name: 'w2 阶段',
    seq: 2,
    frozenAt: '11-08 10:00',
    configVersion: 'skill-agent@v1.3',
    targetModel: 'openai/gpt-5',
    backgroundVersion: 1,
    skillVersionRefs: [
      { code: 'doc-edit', name: '文档改写', version: 'v2' },
      { code: 'outline', name: '大纲生成', version: 'v1' },
      { code: 'clarify', name: '意图澄清', version: 'v1' },
    ],
    toolVersionRefs: [
      { code: 'askClarification', name: '澄清卡', version: 'v1' },
      { code: 'emitSkillFile', name: '写入文件', version: 'v1' },
      { code: 'getEditingSkill', name: '读取 Skill', version: 'v1' },
    ],
  },
]

export function useStages(agentId?: string) {
  const [all, setAll] = useShared<AgentStage[]>('agent-stages', seedStages)
  const stages = agentId ? all.filter((s) => s.agentId === agentId) : all

  const createStage = useCallback(
    (input: Omit<AgentStage, 'id' | 'seq'>) => {
      const seq = all.filter((s) => s.agentId === input.agentId).length + 1
      const created: AgentStage = { ...input, id: `stg_${Date.now()}`, seq }
      setAll((prev) => [...prev, created])
      return created
    },
    [all, setAll],
  )

  const findStage = (id?: string) => (id ? all.find((s) => s.id === id) : undefined)

  return { stages, allStages: all, createStage, findStage }
}
