'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw, ChevronDown, ChevronRight, Upload } from 'lucide-react'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import type { RegisteredCapability } from '@/lib/eval-capability-store'
import type { CapabilityVersionMeta } from '@/lib/api-client'

/**
 * 能力版本面板（接入后端语义化版本表 eval_capability_versions）。
 *
 * 能力：发布当前能力为不可变版本（vN.0.0 自动推导）、列出历史版本。
 * 挂在能力头部下方；后端不可用时显示错误不阻断。
 *
 * 关键：发布的 config 携带 executionType / entrypoint / outputSchema，
 * 这三者变化会被后端 diff 标记为 breaking=true（契约层兼容性破坏）。
 */

/** 把前端 RegisteredCapability 收敛成后端版本 config。 */
export function capabilityToConfig(cap: RegisteredCapability): Record<string, any> {
  return {
    name: cap.name,
    code: cap.code,
    category: cap.category,
    executionType: cap.executionType,
    entrypoint: cap.entrypoint,
    inputSchema: cap.inputSchema,
    outputSchema: cap.outputSchema,
    intro: cap.intro,
    scenario: cap.scenario,
    tags: cap.tags,
  }
}

export function CapabilityVersionHistory({ cap }: { cap: RegisteredCapability }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<CapabilityVersionMeta[]>([])
  const [publishing, setPublishing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { listCapabilityVersions } = await import('@/lib/api-client')
      setVersions(await listCapabilityVersions(cap.id))
    } catch (e: any) {
      setError(e?.message || String(e))
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [cap.id])

  // 切换能力时重置
  useEffect(() => {
    setOpen(false)
    setVersions([])
    setError(null)
    setMsg(null)
  }, [cap.id])

  useEffect(() => {
    if (open && versions.length === 0 && !loading) load()
  }, [open, versions.length, loading, load])

  const doPublish = async () => {
    setPublishing(true)
    setMsg(null)
    try {
      const { publishCapabilityVersion } = await import('@/lib/api-client')
      const published = await publishCapabilityVersion({
        capabilityId: cap.id,
        config: capabilityToConfig(cap),
        name: cap.name,
        executionType: cap.executionType,
        trialPassed: true,
        createdBy: cap.author || '当前用户',
      })
      setMsg(`已发布 ${published.version}（已入库）`)
      await load()
    } catch (e: any) {
      setMsg(`发布失败（后端未入库：${e?.message || String(e)}）`)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Panel
      className="mt-4"
      title={
        <button type="button" className="flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <History className="size-4" aria-hidden="true" />
          能力版本
          {versions.length > 0 ? <Tag className="ml-1">{versions.length}</Tag> : null}
        </button>
      }
      actions={
        open ? (
          <div className="flex items-center gap-2">
            {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
            <Btn size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {loading ? '加载中…' : '刷新'}
            </Btn>
            <Btn size="sm" variant="primary" onClick={doPublish} disabled={publishing}>
              <Upload className="size-3.5" aria-hidden="true" />
              {publishing ? '发布中…' : '发布当前为新版本'}
            </Btn>
          </div>
        ) : null
      }
    >
      {!open ? (
        <p className="text-xs text-muted-foreground">
          展开可将当前能力配置固化为不可变版本（vN.0.0 自动推导），或查看历史版本。
          executionType / entrypoint / outputSchema 变化会被标记为 breaking。
        </p>
      ) : (
        <div className="space-y-3">
          {error ? (
            <div className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-xs text-fail">
              后端未返回数据：{error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无已入库的历史版本（点「发布当前为新版本」生成）。</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>版本</Th>
                    <Th>名称</Th>
                    <Th>执行类型</Th>
                    <Th>发布人</Th>
                    <Th>时间</Th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version} className="border-t">
                      <Td>
                        <Mono className="font-semibold">{v.version}</Mono>
                        {v.version === cap.version ? <Tag tone="primary" className="ml-1.5">当前</Tag> : null}
                      </Td>
                      <Td>{v.name || '—'}</Td>
                      <Td><Mono className="text-xs">{v.executionType || '—'}</Mono></Td>
                      <Td className="text-xs text-muted-foreground">{v.createdBy || '—'}</Td>
                      <Td className="text-xs text-muted-foreground">{(v.createdAt || '').replace('T', ' ').slice(0, 16)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

