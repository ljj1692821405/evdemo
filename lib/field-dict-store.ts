'use client'

import { useCallback } from 'react'
import {
  dimensions as seedDimensions,
  fieldDict as seedEntries,
  sampleSimTraj,
  scorers as seedScorers,
  type Dimension,
  type FieldEntry,
  type Scorer,
} from './mock-data'
import { useAgentShared } from './tenant-store'

export { useShared } from './shared-store'

type DictState = { version: number; base: number; entries: FieldEntry[] }

const defaultFieldNames = ['user_query', 'agent_reply', 'tool_calls', 'turn_status']

const seedDict = (isDemo: boolean): DictState =>
  isDemo
    ? { version: 5, base: 5, entries: seedEntries }
    : { version: 1, base: 1, entries: seedEntries.filter((e) => defaultFieldNames.includes(e.logicalName)) }

export function useFieldDict() {
  const [state, setState] = useAgentShared<DictState>('field-dict', seedDict)

  const add = useCallback(
    (entry: FieldEntry) =>
      setState((s) => (s.entries.some((e) => e.logicalName === entry.logicalName) ? s : { ...s, version: s.version + 1, entries: [...s.entries, entry] })),
    [setState],
  )

  const remove = useCallback(
    (name: string) => setState((s) => ({ ...s, version: s.version + 1, entries: s.entries.filter((e) => e.logicalName !== name) })),
    [setState],
  )

  const update = useCallback(
    (name: string, patch: Partial<Omit<FieldEntry, 'logicalName'>>) =>
      setState((s) => ({ ...s, version: s.version + 1, entries: s.entries.map((e) => (e.logicalName === name ? { ...e, ...patch } : e)) })),
    [setState],
  )

  return {
    entries: state.entries,
    names: state.entries.map((e) => e.logicalName),
    version: `fd_v${state.version}`,
    changed: state.version !== state.base,
    find: (name: string) => state.entries.find((e) => e.logicalName === name),
    add,
    remove,
    update,
  }
}

const seedScorerList = (isDemo: boolean): Scorer[] => (isDemo ? seedScorers : [])
const seedDimensionList = (isDemo: boolean): Dimension[] => (isDemo ? seedDimensions : [])

export function useScorers() {
  return useAgentShared<Scorer[]>('scorers', seedScorerList)
}

export function useDimensions(agentId?: string) {
  return useAgentShared<Dimension[]>('dimensions', seedDimensionList, agentId)
}

export const isRawPath = (p: string) => p.startsWith('raw.')
export const isDerivedPath = (p: string) => p.startsWith('derived.')
export const isValidFieldName = (n: string) => /^[a-z][a-z0-9_]*$/.test(n)

const derivedSamples: Record<string, string> = {
  workspace_unchanged: '未变动：# 标题 · ## 下周计划 · ## 附录 · 表格 ×2',
  tool_seq: 'doc.read → doc.edit',
}

export function resolvePath(path: string): unknown {
  if (isRawPath(path)) return undefined
  if (isDerivedPath(path)) return derivedSamples[path.split('.').pop() ?? ''] ?? undefined
  const parts = path.replace('[]', '.0').split('.')
  let cur: unknown = sampleSimTraj
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

export function resolveEntry(entry: FieldEntry): string | null {
  for (const p of entry.paths) {
    const v = resolvePath(p)
    if (!isEmpty(v)) return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }
  return null
}
