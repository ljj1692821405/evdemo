import { PageHeader } from '@/components/eval/primitives'
import { SimulationsView } from '@/components/eval/simulations-view'

export const metadata = { title: '仿真与快照 · 评测平台' }

export default function SimulationsPage() {
  return (
    <div>
      <PageHeader index={4} title="仿真与快照" meta="T7 · simulation_job → snapshot（1:1，冻结只读）" />
      <SimulationsView />
    </div>
  )
}
