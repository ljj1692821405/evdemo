'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

export type StageVersionRef = { code: string; name: string; version: string }

export type StageConfigVersion = {
  id: string
  seq: number
  configVersion: string
  frozenAt: string
  targetModel: string
  backgroundVersion: number
  skillVersionRefs: StageVersionRef[]
  toolVersionRefs: StageVersionRef[]
  snapshotIds: string[]
}

export type AgentStage = {
  id: string
  agentId: string
  name: string
  seq: number
  startedAt: string
  endedAt?: string
  configVersions: StageConfigVersion[]
}

const skillRefs = (docEdit: string): StageVersionRef[] => [
  { code: 'doc-edit', name: '文档改写', version: docEdit },
  { code: 'outline', name: '大纲生成', version: 'v1' },
  { code: 'clarify', name: '意图澄清', version: 'v1' },
]

const toolRefs: StageVersionRef[] = [
  { code: 'askClarification', name: '澄清卡', version: 'v1' },
  { code: 'emitSkillFile', name: '写入文件', version: 'v1' },
  { code: 'getEditingSkill', name: '读取 Skill', version: 'v1' },
]

export const seedStages: AgentStage[] = [
  {
    id: 'stg_w1',
    agentId: 'ag_skill',
    name: 'w1 阶段',
    seq: 1,
    startedAt: '11-01',
    endedAt: '11-07',
    configVersions: [
      {
        id: 'cv_w1_v1',
        seq: 1,
        configVersion: 'skill-agent@v1.0',
        frozenAt: '11-01 10:00',
        targetModel: 'openai/gpt-5',
        backgroundVersion: 1,
        skillVersionRefs: skillRefs('v1'),
        toolVersionRefs: toolRefs,
        snapshotIds: ['snap_1_1', 'snap_2_1', 'snap_3_2'],
      },
    ],
  },
  {
    id: 'stg_w2',
    agentId: 'ag_skill',
    name: 'w2 阶段',
    seq: 2,
    startedAt: '11-08',
    configVersions: [
      {
        id: 'cv_w2_v1',
        seq: 1,
        configVersion: 'skill-agent@v1.1',
        frozenAt: '11-08 10:00',
        targetModel: 'openai/gpt-5',
        backgroundVersion: 1,
        skillVersionRefs: skillRefs('v1'),
        toolVersionRefs: toolRefs,
        snapshotIds: ['snap_4_1'],
      },
      {
        id: 'cv_w2_v2',
        seq: 2,
        configVersion: 'skill-agent@v1.2',
        frozenAt: '11-10 15:20',
        targetModel: 'openai/gpt-5',
        backgroundVersion: 1,
        skillVersionRefs: skillRefs('v2'),
        toolVersionRefs: toolRefs,
        snapshotIds: ['snap_4_2'],
      },
      {
        id: 'cv_w2_v3',
        seq: 3,
        configVersion: 'skill-agent@v1.3',
        frozenAt: '11-12 09:40',
        targetModel: 'openai/gpt-5',
        backgroundVersion: 1,
        skillVersionRefs: skillRefs('v2'),
        toolVersionRefs: toolRefs,
        snapshotIds: ['snap_5_1', 'snap_6_1', 'snap_6_2'],
      },
    ],
  },
]

type FreezeInput = Omit<StageConfigVersion, 'id' | 'seq' | 'snapshotIds'> & { agentId: string }

const sameConfig = (a: StageConfigVersion, b: FreezeInput) =>
  a.targetModel === b.targetModel &&
  a.backgroundVersion === b.backgroundVersion &&
  JSON.stringify(a.skillVersionRefs) === JSON.stringify(b.skillVersionRefs) &&
  JSON.stringify(a.toolVersionRefs) === JSON.stringify(b.toolVersionRefs)

export function useStages(agentId?: string) {
  const [all, setAll] = useShared<AgentStage[]>('agent-stages', seedStages)
  const stages = agentId ? all.filter((s) => s.agentId === agentId) : all
  const currentStage = stages.find((s) => !s.endedAt)

  const createStage = useCallback(
    (input: { agentId: string; name: string; startedAt: string }) => {
      const seq = all.filter((s) => s.agentId === input.agentId).length + 1
      const created: AgentStage = { ...input, id: `stg_${Date.now()}`, seq, configVersions: [] }
      setAll((prev) => [...prev.map((s) => (s.agentId === input.agentId && !s.endedAt ? { ...s, endedAt: input.startedAt } : s)), created])
      return created
    },
    [all, setAll],
  )

  const freezeConfigVersion = useCallback(
    (input: FreezeInput) => {
      const stage = all.find((s) => s.agentId === input.agentId && !s.endedAt)
      if (!stage) return null
      const last = stage.configVersions[stage.configVersions.length - 1]
      if (last && sameConfig(last, input)) return last
      const { agentId: _agentId, ...rest } = input
      const created: StageConfigVersion = { ...rest, id: `cv_${Date.now()}`, seq: stage.configVersions.length + 1, snapshotIds: [] }
      setAll((prev) => prev.map((s) => (s.id === stage.id ? { ...s, configVersions: [...s.configVersions, created] } : s)))
      return created
    },
    [all, setAll],
  )

  const attachSnapshot = useCallback(
    (configVersionId: string, snapshotId: string) => {
      setAll((prev) =>
        prev.map((s) => ({
          ...s,
          configVersions: s.configVersions.map((cv) =>
            cv.id === configVersionId && !cv.snapshotIds.includes(snapshotId)
              ? { ...cv, snapshotIds: [...cv.snapshotIds, snapshotId] }
              : cv,
          ),
        })),
      )
    },
    [setAll],
  )

  const findStage = (id?: string) => (id ? all.find((s) => s.id === id) : undefined)
  const findConfigVersion = (id?: string) =>
    id ? all.flatMap((s) => s.configVersions).find((cv) => cv.id === id) : undefined
  const stageOfConfigVersion = (id?: string) => (id ? all.find((s) => s.configVersions.some((cv) => cv.id === id)) : undefined)

  return { stages, allStages: all, currentStage, createStage, freezeConfigVersion, attachSnapshot, findStage, findConfigVersion, stageOfConfigVersion }
}
