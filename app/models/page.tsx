import { PageHeader } from '@/components/eval/primitives'
import { ModelsView } from '@/components/eval/models-view'

export const metadata = { title: '模型服务 · 评测平台' }

export default function ModelsPage() {
  return (
    <div>
      <PageHeader index={11} title="模型服务" />
      <ModelsView />
    </div>
  )
}
