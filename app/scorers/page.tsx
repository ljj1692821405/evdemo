import { PageHeader } from '@/components/eval/primitives'
import { ScorersView } from '@/components/eval/scorers-view'

export const metadata = { title: '维度与评分器 · 评测平台' }

export default function ScorersPage() {
  return (
    <div>
      <PageHeader index={3} title="维度与评分器" back="/field-dict" />
      <ScorersView />
    </div>
  )
}
