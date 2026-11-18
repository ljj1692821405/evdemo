import { PageHeader } from '@/components/eval/primitives'
import { SimulationContractView } from '@/components/eval/simulation-contract-view'

export const metadata = { title: '仿真契约注册台 · 评测平台' }

export default function SimulationContractPage() {
  return (
    <div>
      <PageHeader index={0} title="产线仿真契约注册台" />
      <SimulationContractView />
    </div>
  )
}
