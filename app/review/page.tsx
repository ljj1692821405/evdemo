import { PageHeader, Tag } from '@/components/eval/primitives'
import { ReviewBoard } from '@/components/eval/review-board'
import { RunPicker } from '@/components/eval/run-picker'
import { AgentDataGate } from '@/components/eval/agent-data-gate'
import { runContext } from '@/lib/runs'

export const metadata = { title: '核对看板 · 评测平台' }

export default function ReviewPage(props: { searchParams: Promise<{ run?: string }> }) {
  return (
    <AgentDataGate index={8} title="核对看板">
      <ReviewContent {...props} />
    </AgentDataGate>
  )
}

async function ReviewContent({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams
  const ctx = runContext(runId)
  if (!ctx) {
    return (
      <div>
        <PageHeader index={8} title="核对看板" />
        <RunPicker basePath="/review" />
      </div>
    )
  }
  const { run, dimKeys } = ctx
  return (
    <div>
      <PageHeader
        index={8}
        title="核对看板"
        back="/review"
        actions={<Tag tone="primary">review_schema · 3 选项</Tag>}
      />
      <ReviewBoard key={run.id} dimKeys={dimKeys} />
    </div>
  )
}
