'use client'

import { useState } from 'react'
import { GitBranch, Snowflake, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn } from './primitives'
import { useStages } from '@/lib/stage-store'
import { useCapabilities } from '@/lib/capability-store'
import { resolveConfig } from '@/lib/capability-data'
import type { Agent } from '@/lib/tenant-store'

const inputCls = 'h-8 rounded-md border border-input bg-background px-2 text-sm'

export function AgentStagesPanel({ agent }: { agent: Agent }) {
  const { stages, currentStage, createStage, freezeConfigVersion } = useStages(agent.id)
  const { assets, currentOf } = useCapabilities()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    currentStage ? { [currentStage.id]: true } : {},
  )

  const snapshotCount = (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId)
    return stage ? stage.configVersions.reduce((n, cv) => n + cv.snapshotIds.length, 0) : 0
  }

  const startStage = () => {
    const seq = stages.length + 1
    const created = createStage({
      agentId: agent.id,
      name: name.trim() || `w${seq} 阶段`,
      startedAt: '刚刚',
    })
    setExpanded((m) => ({ ...m, [created.id]: true }))
    setName('')
    setNaming(false)
  }

  const freeze = () => {
    const cfg = currentOf(agent.id)
    const items = cfg ? resolveConfig(cfg, assets) : []
    const target = agent.models.find((m) => m.role === 'target')?.model ?? '—'
    freezeConfigVersion({
      agentId: agent.id,
      configVersion: `${agent.code}@${cfg?.version ?? 'v1.0'}`,
      frozenAt: '刚刚',
      targetModel: target,
      backgroundVersion: agent.backgroundVersion ?? 0,
      skillVersionRefs: items
        .filter((i) => i.asset.kind === 'skill')
        .map((i) => ({ code: i.asset.code, name: i.asset.name, version: i.ver.version })),
      toolVersionRefs: items
        .filter((i) => i.asset.kind === 'tool')
        .map((i) => ({ code: i.asset.code, name: i.asset.name, version: i.ver.version })),
    })
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          版本阶段
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" onClick={freeze} disabled={!currentStage}>
            <Snowflake className="size-3.5" aria-hidden="true" />
            冻结配置版本
          </Btn>
          <Btn size="sm" variant="outline" onClick={() => setNaming((v) => !v)}>
            开启新阶段
          </Btn>
        </div>
      </div>

      {naming ? (
        <form
          className="flex gap-2 border-b bg-muted/40 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            startStage()
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
          <Btn size="md" variant="primary" type="submit" aria-label="确认开启">
            <Check className="size-4" aria-hidden="true" />
          </Btn>
          <Btn size="md" variant="ghost" aria-label="取消" onClick={() => setNaming(false)}>
            <X className="size-4" aria-hidden="true" />
          </Btn>
        </form>
      ) : null}

      <ul>
        {stages.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无阶段</li>
        ) : null}
        {[...stages].reverse().map((stage) => {
          const open = expanded[stage.id]
          const isCurrent = !stage.endedAt
          return (
            <li key={stage.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setExpanded((m) => ({ ...m, [stage.id]: !open }))}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
              >
                {open ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="w-24 shrink-0 truncate text-sm font-medium">{stage.name}</span>
                <span className="w-4 shrink-0">
                  {isCurrent ? <span className="block size-1.5 rounded-full bg-pass" aria-label="当前阶段" /> : null}
                </span>
                <Mono className="w-32 shrink-0 text-[11px] text-muted-foreground">
                  {stage.startedAt} ~ {stage.endedAt ?? '当前'}
                </Mono>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Tag>{stage.configVersions.length} 配置版本</Tag>
                  <Tag>{snapshotCount(stage.id)} 快照</Tag>
                </span>
              </button>

              {open ? (
                <div className="border-t bg-muted/20 px-3 py-2">
                  {stage.configVersions.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">该阶段暂无配置版本</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="w-8 py-1 text-left font-medium">#</th>
                          <th className="w-44 py-1 text-left font-medium">配置版本</th>
                          <th className="w-28 py-1 text-left font-medium">冻结时间</th>
                          <th className="w-36 py-1 text-left font-medium">被测模型</th>
                          <th className="w-32 py-1 text-left font-medium">能力</th>
                          <th className="py-1 text-right font-medium">快照</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {[...stage.configVersions].reverse().map((cv) => (
                          <tr key={cv.id}>
                            <td className="py-1.5"><Mono className="text-muted-foreground">{cv.seq}</Mono></td>
                            <td className="py-1.5"><Mono className="font-semibold">{cv.configVersion}</Mono></td>
                            <td className="py-1.5"><Mono className="text-muted-foreground">{cv.frozenAt}</Mono></td>
                            <td className="py-1.5"><Mono className="text-muted-foreground">{cv.targetModel}</Mono></td>
                            <td className="py-1.5 text-muted-foreground">{cv.skillVersionRefs.length} Skill · {cv.toolVersionRefs.length} Tool</td>
                            <td className="py-1.5 text-right"><Mono>{cv.snapshotIds.length}</Mono></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
