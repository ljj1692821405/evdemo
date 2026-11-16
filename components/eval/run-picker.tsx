import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { experiments } from '@/lib/mock-data'
import { viewableRuns } from '@/lib/runs'
import { Panel, Tag, Mono, Th, Td } from './primitives'

export function RunPicker({ basePath }: { basePath: string }) {
  return (
    <div className="p-6">
      <Panel title="选择实验" bodyClassName="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><Th>实验</Th><Th>run</Th><Th>快照</Th><Th>状态</Th><Th>开始</Th><Th>费用</Th><Th /></tr>
          </thead>
          <tbody className="divide-y">
            {viewableRuns.map((r) => {
              const exp = experiments.find((e) => e.id === r.experimentId)!
              const href = `${basePath}?run=${r.id}`
              return (
                <tr key={r.id} className="group relative hover:bg-muted/40">
                  <Td>
                    <Link href={href} className="font-medium after:absolute after:inset-0">{exp.name}</Link>
                    <Mono className="ml-2 text-muted-foreground">{exp.id}</Mono>
                  </Td>
                  <Td><Mono className="font-semibold">{r.id}</Mono></Td>
                  <Td><Mono className="text-muted-foreground">{exp.snapshotId}</Mono></Td>
                  <Td><Tag tone={r.status === 'completed' ? 'pass' : 'warn'}>{r.status}</Tag></Td>
                  <Td><Mono className="text-muted-foreground">{r.startedAt}</Mono></Td>
                  <Td><Mono>{r.cost}</Mono></Td>
                  <Td className="text-right">
                    <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
