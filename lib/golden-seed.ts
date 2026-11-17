import { parseCaseRecords } from './case-shape'
import type { CaseItem, Dataset } from './mock-data'
import dim11 from './golden-cases/dim_1_1.json'
import dim21 from './golden-cases/dim_2_1.json'
import dim32 from './golden-cases/dim_3_2.json'
import dim41 from './golden-cases/dim_4_1.json'
import dim42 from './golden-cases/dim_4_2.json'
import dim51 from './golden-cases/dim_5_1.json'
import dim61 from './golden-cases/dim_6_1.json'
import dim62 from './golden-cases/dim_6_2.json'

const goldenSets: { key: string; name: string; record: unknown }[] = [
  { key: 'dim_1_1', name: '1.1 意图识别准确率', record: dim11 },
  { key: 'dim_2_1', name: '2.1 澄清追问准确率', record: dim21 },
  { key: 'dim_3_2', name: '3.2 多轮上下文更新', record: dim32 },
  { key: 'dim_4_1', name: '4.1 SKILL结构合规率', record: dim41 },
  { key: 'dim_4_2', name: '4.2 输出质量忠实度', record: dim42 },
  { key: 'dim_5_1', name: '5.1 定向修改与保护率', record: dim51 },
  { key: 'dim_6_1', name: '6.1 职责边界与安全', record: dim61 },
  { key: 'dim_6_2', name: '6.2 安全风险处理', record: dim62 },
]

export const goldenDatasets: Dataset[] = goldenSets.map((s) => ({
  id: `ds_${s.key}`,
  name: s.name,
  version: 'v1',
  caseCount: 1,
  tags: ['golden'],
  defaultGt: false,
  updatedAt: '2026-11-17',
}))

export const goldenCases: CaseItem[] = goldenSets.flatMap((s) => parseCaseRecords([s.record], `ds_${s.key}`, 0))
