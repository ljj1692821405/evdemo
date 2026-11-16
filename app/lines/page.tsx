import { PageHeader } from '@/components/eval/primitives'
import { LinesView } from '@/components/eval/lines-view'

export const metadata = { title: '产线管理 · 评测平台' }

export default function LinesPage() {
  return (
    <div>
      <PageHeader index={0} title="产线管理" />
      <LinesView />
    </div>
  )
}
