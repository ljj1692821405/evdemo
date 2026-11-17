import { PageHeader, Tag } from '@/components/eval/primitives'
import { ExportView } from '@/components/eval/export-view'
import { AgentDataGate } from '@/components/eval/agent-data-gate'

export const metadata = { title: '报告 / 导出 · 评测平台' }

export default function ExportPage() {
  return (
    <AgentDataGate index={10} title="报告 / 导出">
      <div>
        <PageHeader index={10} title="报告 / 导出" back="/review?run=run_0412" actions={<Tag>只读</Tag>} />
        <ExportView />
      </div>
    </AgentDataGate>
  )
}
