import { Lock, Puzzle, Wrench } from 'lucide-react'
import type { FrozenSnapshot } from '@/lib/capability-data'
import { Mono, Tag } from './primitives'

export function FrozenSnapshotCard({ snap, compact }: { snap: FrozenSnapshot | undefined; compact?: boolean }) {
  if (!snap) {
    return <p className="text-xs text-muted-foreground">该实验未绑定能力配置快照（历史实验，早于能力登记上线）</p>
  }
  const skills = snap.items.filter((i) => i.kind === 'skill')
  const tools = snap.items.filter((i) => i.kind === 'tool')
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag tone="primary">
          <Lock className="size-3" aria-hidden="true" />
          已冻结
        </Tag>
        <Mono>
          {snap.agentCode}@{snap.configVersion}
        </Mono>
        <span className="text-muted-foreground">
          {skills.length} Skill · {tools.length} Tool · 冻结于 {snap.frozenAt}
        </span>
      </div>
      {compact ? null : (
        <div className="flex flex-col gap-1.5">
          {[
            { label: 'Skill', icon: Puzzle, items: skills },
            { label: 'Tool', icon: Wrench, items: tools },
          ].map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-1.5">
              <span className="flex w-12 shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <g.icon className="size-3" aria-hidden="true" />
                {g.label}
              </span>
              {g.items.map((i) => (
                <span key={i.code} className="inline-flex items-center gap-1 rounded border bg-card px-1.5 py-0.5 font-mono text-[11px]">
                  {i.code}
                  <span className="text-muted-foreground">@{i.version}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
