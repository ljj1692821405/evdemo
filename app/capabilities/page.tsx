import { PageHeader } from '@/components/eval/primitives'
import { CapabilitiesRegistryView } from '@/components/eval/capabilities-registry-view'

export const metadata = { title: '评测能力注册 · 评测平台' }

export default function CapabilitiesPage() {
  return (
    <div>
      <PageHeader
        index={1}
        title="评测能力注册"
      />
      <CapabilitiesRegistryView />
    </div>
  )
}
