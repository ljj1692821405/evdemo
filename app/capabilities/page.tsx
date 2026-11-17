import { PageHeader } from '@/components/eval/primitives'
import { CapabilitiesRegistryView } from '@/components/eval/capabilities-registry-view'

export const metadata = { title: '其他评测能力 · 评测平台' }

export default function CapabilitiesPage() {
  return (
    <div>
      <PageHeader
        index={1}
        title="其他评测能力"
      />
      <CapabilitiesRegistryView />
    </div>
  )
}
