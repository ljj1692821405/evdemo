'use client'

import useSWR from 'swr'
import { goldenCases, goldenDatasets } from './golden-seed'
import { DEMO_AGENT_ID, type CaseItem, type Dataset } from './mock-data'
import { useScope } from './tenant-store'
import {
  addCases as apiAddCases,
  createDataset as apiCreateDataset,
  deleteCase as apiDeleteCase,
  deleteDataset as apiDeleteDataset,
  getAllCases,
  getDatasets,
} from './api-client'

type DatasetState = { datasets: Dataset[]; cases: CaseItem[] }

const swrOptions = { revalidateOnFocus: false, keepPreviousData: true }

/** 首次进入且库为空时，把 demo 种子写进数据库，避免"新增后种子消失"。同一个 Agent 只尝试一次。 */
const seedPromises = new Map<string, Promise<void>>()

async function seedGoldenOnce(agentId: string, lineId: string): Promise<void> {
  if (agentId !== DEMO_AGENT_ID) return
  const existing = seedPromises.get(agentId)
  if (existing) return existing

  const job = (async () => {
    for (const d of goldenDatasets) {
      await apiCreateDataset({
        id: d.id,
        name: d.name,
        agentId,
        lineId,
        version: d.version,
        tags: d.tags,
        defaultGt: d.defaultGt,
      })
    }
    const byDataset = new Map<string, CaseItem[]>()
    for (const c of goldenCases) {
      const list = byDataset.get(c.datasetId) ?? []
      list.push(c)
      byDataset.set(c.datasetId, list)
    }
    for (const [datasetId, items] of byDataset) {
      await apiAddCases(datasetId, agentId, items, lineId)
    }
  })().catch(() => {
    // 播种失败不影响正常读写，下次刷新重试
    seedPromises.delete(agentId)
  })

  seedPromises.set(agentId, job)
  return job
}

/** 后端持久化的数据集 / Case 数据源。 */
async function fetchDatasetsState(agentId: string, lineId: string): Promise<DatasetState> {
  const [datasets, cases] = await Promise.all([getDatasets(agentId, lineId), getAllCases(agentId, lineId)])

  if (datasets.length === 0 && cases.length === 0 && agentId === DEMO_AGENT_ID) {
    await seedGoldenOnce(agentId, lineId)
    const [seededDatasets, seededCases] = await Promise.all([
      getDatasets(agentId, lineId),
      getAllCases(agentId, lineId),
    ])
    if (seededDatasets.length > 0) {
      return { datasets: seededDatasets, cases: seededCases }
    }
    // 后端写入不可用（无库 / 网络不通）时退回只读种子，界面不至于空白
    return { datasets: goldenDatasets, cases: goldenCases }
  }

  return { datasets, cases }
}

export function useDatasets() {
  const { agent, line } = useScope()
  const agentId = agent?.id ?? DEMO_AGENT_ID
  const lineId = line?.id ?? ''
  const key = `datasets:${lineId}:${agentId}`

  const { data, mutate } = useSWR<DatasetState>(key, () => fetchDatasetsState(agentId, lineId), swrOptions)
  const state: DatasetState = data ?? { datasets: [], cases: [] }

  return {
    datasets: state.datasets,
    cases: state.cases,
    loading: !data,
    /** 重新从后端拉取（页面刷新、切换 Agent 时使用） */
    reload: () => mutate(),

    addDataset: async (dataset: Dataset) => {
      // 先乐观更新，界面立即出现；后端失败会回滚
      await mutate(
        async () => {
          await apiCreateDataset({
            id: dataset.id,
            name: dataset.name,
            agentId,
            lineId,
            version: dataset.version,
            tags: dataset.tags,
            defaultGt: dataset.defaultGt,
          })
          return fetchDatasetsState(agentId, lineId)
        },
        {
          optimisticData: (prev) => ({
            datasets: [dataset, ...(prev?.datasets ?? [])],
            cases: prev?.cases ?? [],
          }),
          rollbackOnError: true,
          revalidate: false,
        },
      )
    },

    addCases: async (datasetId: string, items: CaseItem[]) => {
      await mutate(
        async () => {
          await apiAddCases(datasetId, agentId, items, lineId)
          return fetchDatasetsState(agentId, lineId)
        },
        {
          optimisticData: (prev) => ({
            datasets: (prev?.datasets ?? []).map((d) =>
              d.id === datasetId ? { ...d, caseCount: d.caseCount + items.length } : d,
            ),
            cases: [...(prev?.cases ?? []), ...items],
          }),
          rollbackOnError: true,
          revalidate: false,
        },
      )
    },

    removeDataset: async (datasetId: string) => {
      await mutate(
        async () => {
          await apiDeleteDataset(datasetId, agentId, lineId)
          return fetchDatasetsState(agentId, lineId)
        },
        {
          optimisticData: (prev) => ({
            datasets: (prev?.datasets ?? []).filter((d) => d.id !== datasetId),
            cases: (prev?.cases ?? []).filter((c) => c.datasetId !== datasetId),
          }),
          rollbackOnError: true,
          revalidate: false,
        },
      )
    },

    removeCase: async (caseId: string) => {
      const target = state.cases.find((c) => c.id === caseId)
      await mutate(
        async () => {
          await apiDeleteCase(caseId, agentId, lineId)
          return fetchDatasetsState(agentId, lineId)
        },
        {
          optimisticData: (prev) => ({
            datasets: (prev?.datasets ?? []).map((d) =>
              d.id === target?.datasetId ? { ...d, caseCount: Math.max(0, d.caseCount - 1) } : d,
            ),
            cases: (prev?.cases ?? []).filter((c) => c.id !== caseId),
          }),
          rollbackOnError: true,
          revalidate: false,
        },
      )
    },
  }
}

