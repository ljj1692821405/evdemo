import { PageHeader } from '@/components/eval/primitives'
import { ScorersView } from '@/components/eval/scorers-view'

export const metadata = { title: '维度与评分器 · 评测平台' }

export default function ScorersPage() {
  return (
    <div>
      <PageHeader index={3} title="维度与评分器" back="/field-dict" meta="T3 dimension · T4 scorer · T5 prompt · T6 script" />
      <ScorersView />
    </div>
  )
}
