'use client'

import { useState } from 'react'
import { GitBranch, Snowflake, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn } from './primitives'
import { useStages } from '@/lib/stage-store'
import { useCapabilities } from '@/lib/capability-store'
import { resolveConfig } from '@/lib/capability-data'
import type { Agent } from '@/lib/tenant-store'

const inputCls = 'h-8 rounded-md border border-input bg-background px-2 text-sm'

export function AgentStagesPanel({ agent }: { agent: Agent }) {
  const { stages, createStage } = useStages(agent.id)
  const { assets, currentOf } = useCapabilities()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const freeze = () => {
    const cfg = currentOf(agent.id)
    const items = cfg ? resolveConfig(cfg, assets) : []
    const target = agent.models.find((m) => m.role === 'target')?.model ?? '—'
    const nextSeq = stages.length + 1
    createStage({
      agentId: agent.id,
      name: name.trim() || `w${nextSeq} 阶段`,
      frozenAt: '刚刚',
      configVersion: cfg?.version ?? 'v1.0',
      targetModel: target,
      backgroundVersion: agent.backgroundVersion ?? 0,
      skillVersionRefs: items
        .filter((i) => i.asset.kind === 'skill')
        .map((i) => ({ code: i.asset.code, name: i.asset.name, version: i.ver.version })),
      toolVersionRefs: items
        .filter((i) => i.asset.kind === 'tool')
        .map((i) => ({ code: i.asset.code, name: i.asset.name, version: i.ver.version })),
    })
    setName('')
    setNaming(false)
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          版本阶段
        </div>
        <Btn size="sm" onClick={() => setNaming((v) => !v)}>
          <Snowflake className="size-3.5" aria-hidden="true" />
          冻结当前配置
        </Btn>
      </div>

      {naming ? (
        <form
          className="flex gap-2 border-b bg-muted/40 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            freeze()
          }}
        >
          <input
            aria-label="阶段名称"
            className={cn(inputCls, 'min-w-0 flex-1')}
            placeholder={`阶段名称，留空则自动命名 w${stages.length + 1} 阶段`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Btn size="md" variant="primary" type="submit" aria-label="确认冻结">
            <Check className="size-4" aria-hidden="true" />
          </Btn>
          <Btn size="md" variant="ghost" aria-label="取消" onClick={() => setNaming(false)}>
            <X className="size-4" aria-hidden="true" />
          </Btn>
        </form>
      ) : null}

      <ul>
        {stages.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无阶段，仿真前会自动冻结</li>
        ) : null}
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
            <div className="flex min-w-0 items-center gap-2">
              <Tag tone={i === stages.length - 1 ? 'primary' : 'neutral'}>{s.name}</Tag>
              {i === stages.length - 1 ? <Tag tone="pass">当前</Tag> : null}
              <Mono className="text-[11px] text-muted-foreground">{s.frozenAt}</Mono>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="font-mono">{s.targetModel}</Tag>
              <Tag>{s.skillVersionRefs.length} Skill</Tag>
              <Tag>{s.toolVersionRefs.length} Tool</Tag>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
