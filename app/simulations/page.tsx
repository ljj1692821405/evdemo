import { PageHeader } from '@/components/eval/primitives'
import { SimulationsView } from '@/components/eval/simulations-view'

export const metadata = { title: '仿真与快照 · 评测平台' }

export default function SimulationsPage() {
  return (
    <div>
      <PageHeader index={4} title="仿真与快照" back="/scorers" />
      <SimulationsView />
    </div>
  )
}
