import { PageHeader } from '@/components/eval/primitives'
import { ExperimentsView } from '@/components/eval/experiments-view'
import { AgentDataGate } from '@/components/eval/agent-data-gate'

export const metadata = { title: '实验与评测 · 评测平台' }

export default function ExperimentsPage(props: { searchParams: Promise<{ id?: string; snapshot?: string }> }) {
  return (
    <AgentDataGate index={5} title="实验与评测">
      <ExperimentsContent {...props} />
    </AgentDataGate>
  )
}

async function ExperimentsContent({ searchParams }: { searchParams: Promise<{ id?: string; snapshot?: string }> }) {
  const { id, snapshot } = await searchParams
  return (
    <div>
      <PageHeader index={5} title="实验与评测" back="/simulations" />
      <ExperimentsView key={`${id ?? ''}-${snapshot ?? ''}`} initialId={id} newFromSnapshot={snapshot} />
    </div>
  )
}
