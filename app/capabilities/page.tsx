import { PageHeader } from '@/components/eval/primitives'
import { CapabilitiesRegistryView } from '@/components/eval/capabilities-registry-view'

export const metadata = { title: '其他评测能力 · 评测平台' }

export default function CapabilitiesPage() {
  return (
    <div>
      <PageHeader
        index={9}
        title="其他评测能力"
        meta="通用评测能力注册中心 · 文生图 / 图生视频 / 多模态等能力定义与契约"
      />
      <CapabilitiesRegistryView />
    </div>
  )
}
