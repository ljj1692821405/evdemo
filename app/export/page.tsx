import { PageHeader, Mono, Tag } from '@/components/eval/primitives'
import { ExportView } from '@/components/eval/export-view'

export const metadata = { title: '报告 / 导出 · 评测平台' }

export default function ExportPage() {
  return (
    <div>
      <PageHeader index={8} title="报告 / 导出" meta={<Mono>run_0412 · exp_031</Mono>} actions={<Tag>只读</Tag>} />
      <ExportView />
    </div>
  )
}
