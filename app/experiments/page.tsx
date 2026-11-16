import { PageHeader } from '@/components/eval/primitives'
import { ExperimentsView } from '@/components/eval/experiments-view'

export const metadata = { title: '实验与评测 · 评测平台' }

export default async function ExperimentsPage({ searchParams }: { searchParams: Promise<{ id?: string; snapshot?: string }> }) {
  const { id, snapshot } = await searchParams
  return (
    <div>
      <PageHeader index={5} title="实验与评测" back="/simulations" meta="T8 experiment · T9 eval_run · 读快照 → 批量评分" />
      <ExperimentsView key={`${id ?? ''}-${snapshot ?? ''}`} initialId={id} newFromSnapshot={snapshot} />
    </div>
  )
}
