import { PageHeader } from '@/components/eval/primitives'
import { SimulationsView } from '@/components/eval/simulations-view'
import { AgentDataGate } from '@/components/eval/agent-data-gate'

export const metadata = { title: '仿真与快照 · 评测平台' }

export default function SimulationsPage() {
  return (
    <AgentDataGate index={4} title="仿真与快照">
      <div>
        <PageHeader index={4} title="仿真与快照" back="/scorers" />
        <SimulationsView />
      </div>
    </AgentDataGate>
  )
}
