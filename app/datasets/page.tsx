import { PageHeader } from '@/components/eval/primitives'
import { DatasetsView } from '@/components/eval/datasets-view'
import { AgentDataGate } from '@/components/eval/agent-data-gate'

export const metadata = { title: '数据集 / Case · 评测平台' }

export default function DatasetsPage() {
  return (
    <AgentDataGate index={2} title="数据集 / Case">
      <div>
        <PageHeader index={2} title="数据集 / Case" />
        <DatasetsView />
      </div>
    </AgentDataGate>
  )
}
