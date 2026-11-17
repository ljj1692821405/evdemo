'use client'

import { goldenCases, goldenDatasets } from './golden-seed'
import type { CaseItem, Dataset } from './mock-data'
import { useAgentShared } from './tenant-store'

type DatasetState = { datasets: Dataset[]; cases: CaseItem[] }

const seedState = (isDemo: boolean): DatasetState => (isDemo ? { datasets: goldenDatasets, cases: goldenCases } : { datasets: [], cases: [] })

export function useDatasets() {
  const [state, setState] = useAgentShared<DatasetState>('datasets', seedState)

  return {
    datasets: state.datasets,
    cases: state.cases,
    addDataset: (dataset: Dataset) => setState((s) => ({ ...s, datasets: [dataset, ...s.datasets] })),
    addCases: (datasetId: string, items: CaseItem[]) =>
      setState((s) => ({
        datasets: s.datasets.map((d) => (d.id === datasetId ? { ...d, caseCount: d.caseCount + items.length } : d)),
        cases: [...s.cases, ...items],
      })),
    removeDataset: (datasetId: string) =>
      setState((s) => ({
        datasets: s.datasets.filter((d) => d.id !== datasetId),
        cases: s.cases.filter((c) => c.datasetId !== datasetId),
      })),
    removeCase: (caseId: string) =>
      setState((s) => {
        const target = s.cases.find((c) => c.id === caseId)
        if (!target) return s
        return {
          datasets: s.datasets.map((d) => (d.id === target.datasetId ? { ...d, caseCount: Math.max(0, d.caseCount - 1) } : d)),
          cases: s.cases.filter((c) => c.id !== caseId),
        }
      }),
  }
}
