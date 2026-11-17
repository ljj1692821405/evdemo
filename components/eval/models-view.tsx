'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Panel, Tag, Mono, Th, Td } from './primitives'
import { useModelServices, type ModelModality } from '@/lib/model-service-store'

const modalityLabel: Record<ModelModality, string> = {
  text: '文本',
  vision: '视觉',
  multimodal: '多模态',
}

const modalityTone: Record<ModelModality, 'primary' | 'pass' | 'warn'> = {
  text: 'primary',
  vision: 'warn',
  multimodal: 'pass',
}

export function ModelsView() {
  const { models } = useModelServices()
  const [provider, setProvider] = useState('all')

  const providers = Array.from(new Set(models.map((m) => m.provider)))
  const filtered = provider === 'all' ? models : models.filter((m) => m.provider === provider)
  const available = models.filter((m) => m.status === 'available').length

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {['all', ...providers].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                provider === p ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p === 'all' ? '全部' : p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Tag tone="pass">{available} 可用</Tag>
          <Tag>{models.length} 总计</Tag>
        </div>
      </div>

      <Panel bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <Th>模型服务</Th>
                <Th>供应商</Th>
                <Th>模态</Th>
                <Th className="text-right">上下文</Th>
                <Th className="text-right">单价 (输入 / 输出)</Th>
                <Th className="text-right">状态</Th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <Td><Mono className="font-semibold">{m.modelId}</Mono></Td>
                  <Td><Tag>{m.provider}</Tag></Td>
                  <Td><Tag tone={modalityTone[m.modality]}>{modalityLabel[m.modality]}</Tag></Td>
                  <Td className="text-right"><Mono className="text-muted-foreground">{m.contextWindow.toLocaleString()}</Mono></Td>
                  <Td className="text-right">
                    <Mono className="text-muted-foreground">
                      ${m.pricing.input.toFixed(2)} / ${m.pricing.output.toFixed(2)}
                    </Mono>
                  </Td>
                  <Td className="text-right">
                    <Tag tone={m.status === 'available' ? 'pass' : 'neutral'}>{m.status === 'available' ? '可用' : '已下线'}</Tag>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
