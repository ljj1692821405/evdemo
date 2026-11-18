'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

export type ContractFieldType = 'text' | 'image' | 'video' | 'json' | 'code' | 'number'

export type ContractInputField = {
  key: string
  label: string
  type: ContractFieldType
  required: boolean
  example?: string
}

export type ContractOutputField = {
  key: string
  label: string
  type: ContractFieldType
  sourcePath: string
  syncToDict?: boolean
}

export type SimulationContract = {
  id: string
  agentId: string
  lineId: string
  version: string
  scriptName: string
  updatedAt: string
  inputContract: ContractInputField[]
  outputContract: ContractOutputField[]
}

export const seedContracts: SimulationContract[] = [
  {
    id: 'contract_skill_agent',
    agentId: 'ag_skill',
    lineId: 'line_heyreel',
    version: 'v1.0',
    scriptName: '01_simulate_single.py',
    updatedAt: '2026-11-18',
    inputContract: [
      { key: 'query', label: '用户输入指令 (Prompt)', type: 'text', required: true, example: '把第二章评审范围改成硬规定' },
      { key: 'ground_truth', label: '黄金判定要点 (GT)', type: 'text', required: true, example: '要求先弹澄清卡确认，严禁擅自覆盖' },
      { key: 'reference_image', label: '参考角色图 (可选)', type: 'image', required: false, example: 'https://images.example.com/ref.png' },
      { key: 'scenario_tag', label: '业务场景标签', type: 'text', required: false, example: '多轮修改' },
    ],
    outputContract: [
      { key: 'user_query', label: '当前轮用户输入', type: 'text', sourcePath: 'sim_traj.turns[].user_query', syncToDict: true },
      { key: 'agent_reply', label: 'Agent 最终回复', type: 'text', sourcePath: 'sim_traj.turns[].agent_reply', syncToDict: true },
      { key: 'action_sequence', label: '工具调用链路序列', type: 'json', sourcePath: 'sim_traj.turns[].action_sequence', syncToDict: true },
      { key: 'interactive_cards', label: '下发澄清卡/确认卡', type: 'json', sourcePath: 'sim_traj.turns[].interactive_cards', syncToDict: true },
      { key: 'workspace_after', label: '修改后落盘代码文件', type: 'code', sourcePath: 'sim_traj.turns[].workspace_after', syncToDict: true },
      { key: 'generated_image', label: '生图 Agent 产出图片 URL', type: 'image', sourcePath: 'sim_traj.turns[].generated_image', syncToDict: true },
      { key: 'turn_status', label: '轮次执行终态', type: 'text', sourcePath: 'sim_traj.turns[].turn_status', syncToDict: true },
    ],
  },
]

export function useSimulationContracts(agentId?: string) {
  const [contracts, setContracts] = useShared<SimulationContract[]>('sim-contracts-v2', seedContracts)

  const activeContract = agentId ? contracts.find((c) => c.agentId === agentId) || contracts[0] : contracts[0]

  const updateContract = useCallback(
    (agentId: string, patch: Partial<SimulationContract>) => {
      setContracts((prev) =>
        prev.map((c) => (c.agentId === agentId ? { ...c, ...patch, updatedAt: '刚刚' } : c)),
      )
    },
    [setContracts],
  )

  const addInputField = useCallback(
    (agentId: string, field: ContractInputField) => {
      setContracts((prev) =>
        prev.map((c) =>
          c.agentId === agentId ? { ...c, inputContract: [...c.inputContract, field], updatedAt: '刚刚' } : c,
        ),
      )
    },
    [setContracts],
  )

  const removeInputField = useCallback(
    (agentId: string, key: string) => {
      setContracts((prev) =>
        prev.map((c) =>
          c.agentId === agentId
            ? { ...c, inputContract: c.inputContract.filter((f) => f.key !== key), updatedAt: '刚刚' }
            : c,
        ),
      )
    },
    [setContracts],
  )

  const addOutputField = useCallback(
    (agentId: string, field: ContractOutputField) => {
      setContracts((prev) =>
        prev.map((c) =>
          c.agentId === agentId ? { ...c, outputContract: [...c.outputContract, field], updatedAt: '刚刚' } : c,
        ),
      )
    },
    [setContracts],
  )

  const removeOutputField = useCallback(
    (agentId: string, key: string) => {
      setContracts((prev) =>
        prev.map((c) =>
          c.agentId === agentId
            ? { ...c, outputContract: c.outputContract.filter((f) => f.key !== key), updatedAt: '刚刚' }
            : c,
        ),
      )
    },
    [setContracts],
  )

  return {
    contracts,
    activeContract,
    updateContract,
    addInputField,
    removeInputField,
    addOutputField,
    removeOutputField,
  }
}
