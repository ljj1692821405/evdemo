import { PageHeader, Mono, Tag } from '@/components/eval/primitives'
import { ReviewBoard } from '@/components/eval/review-board'

export const metadata = { title: '核对看板 · 评测平台' }

export default function ReviewPage() {
  return (
    <div>
      <PageHeader
        index={7}
        title="核对看板"
        meta={
          <span className="flex items-center gap-2">
            <Mono>run_0412</Mono>
            <span aria-hidden="true">·</span>
            <Mono>pt_intent@v4 · sc_ws@v1</Mono>
          </span>
        }
        actions={<Tag tone="primary">review_schema · 3 选项</Tag>}
      />
      <ReviewBoard />
    </div>
  )
}
