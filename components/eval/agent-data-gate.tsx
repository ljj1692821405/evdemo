'use client'

import { DEMO_AGENT_ID } from '@/lib/mock-data'
import { useScope } from '@/lib/tenant-store'
import { PageHeader } from './primitives'

export function AgentDataGate({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  const { agent } = useScope()
  if (agent?.id === DEMO_AGENT_ID) return <>{children}</>
  return (
    <div>
      <PageHeader index={index} title={title} />
      <p className="p-10 text-center text-sm text-muted-foreground">暂无数据</p>
    </div>
  )
}
