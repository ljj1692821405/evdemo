'use client'

import { useCallback } from 'react'
import useSWR from 'swr'
import { fieldDict as seedEntries, sampleSimTraj, scorers as seedScorers, type FieldEntry, type Scorer } from './mock-data'

const swrOptions = { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }

export function useShared<T>(key: string, initial: T) {
  const { data, mutate } = useSWR<T>(key, null, { ...swrOptions, fallbackData: initial })
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      mutate((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev ?? initial) : next), { revalidate: false }),
    [mutate, initial],
  )
  return [data ?? initial, set] as const
}

type DictState = { version: number; entries: FieldEntry[] }

const seedVersion = 5
const seedDict: DictState = { version: seedVersion, entries: seedEntries }

export function useFieldDict() {
  const [state, setState] = useShared<DictState>('field-dict', seedDict)

  const add = useCallback(
    (entry: FieldEntry) =>
      setState((s) => (s.entries.some((e) => e.logicalName === entry.logicalName) ? s : { version: s.version + 1, entries: [...s.entries, entry] })),
    [setState],
  )

  const remove = useCallback(
    (name: string) => setState((s) => ({ version: s.version + 1, entries: s.entries.filter((e) => e.logicalName !== name) })),
    [setState],
  )

  return {
    entries: state.entries,
    names: state.entries.map((e) => e.logicalName),
    version: `fd_v${state.version}`,
    changed: state.version !== seedVersion,
    find: (name: string) => state.entries.find((e) => e.logicalName === name),
    add,
    remove,
  }
}

export function useScorers() {
  return useShared<Scorer[]>('scorers', seedScorers)
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
