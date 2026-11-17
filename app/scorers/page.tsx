import { PageHeader } from '@/components/eval/primitives'
import { ScorersView } from '@/components/eval/scorers-view'

export const metadata = { title: '维度与评分器 · 评测平台' }

export default async function ScorersPage({ searchParams }: { searchParams: Promise<{ importCap?: string }> }) {
  const { importCap } = await searchParams
  return (
    <div>
      <PageHeader index={4} title="维度与评分器" />
      <ScorersView initialImportCapId={importCap} />
    </div>
  )
}
