import Link from 'next/link'
import { PageHeader, Mono, Tag } from '@/components/eval/primitives'
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
        <PageHeader index={8} title="核对看板" back="/dashboard" />
        <RunPicker basePath="/review" />
      </div>
    )
  }
  const { run, exp, dimKeys } = ctx
  return (
    <div>
      <PageHeader
        index={8}
        title="核对看板"
        back={`/dashboard?run=${run.id}`}
        meta={
          <span className="flex items-center gap-2">
            <Mono>{run.id}</Mono>
            <span aria-hidden="true">·</span>
            <Link href={`/experiments?id=${exp.id}`} className="hover:text-foreground hover:underline">{exp.name}</Link>
            <span aria-hidden="true">·</span>
            <Mono>{exp.scorerIds.join(' · ')}</Mono>
          </span>
        }
        actions={<Tag tone="primary">review_schema · 3 选项</Tag>}
      />
      <ReviewBoard key={run.id} dimKeys={dimKeys} />
    </div>
  )
}
