import { PageHeader } from '@/components/eval/primitives'
import { DatasetsView } from '@/components/eval/datasets-view'

export const metadata = { title: '数据集 / Case · 评测平台' }

export default function DatasetsPage() {
  return (
    <div>
      <PageHeader index={1} title="数据集 / Case" meta="T1 · dataset / case" />
      <DatasetsView />
    </div>
  )
}
