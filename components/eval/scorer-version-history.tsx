'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, GitCompare, RotateCcw, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import type { Scorer } from '@/lib/mock-data'
import type { ScorerVersionMeta } from '@/lib/api-client'

/**
 * 评分器版本历史面板（接入后端 append-only 版本表）。
 *
 * 能力：列出历史版本 / 两版本字段级 diff / 回溯某版本派生新草稿（不写库）。
 * 挂在已发布评分器下方；后端不可用时静默显示错误，不阻断主流程。
 */
export function ScorerVersionHistory({
  scorerId,
  currentVersion,
  onRestore,
}: {
  scorerId: string
  currentVersion: number
  onRestore: (config: Record<string, any>, draftVersion: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<ScorerVersionMeta[]>([])
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [diff, setDiff] = useState<any | null>(null)
  const [diffing, setDiffing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { listScorerVersions } = await import('@/lib/api-client')
      const list = await listScorerVersions(scorerId)
      setVersions(list)
      // 默认选中最近两个版本便于直接 diff
      if (list.length >= 2) {
        setFrom(list[1].version)
        setTo(list[0].version)
      } else if (list.length === 1) {
        setFrom(list[0].version)
        setTo(list[0].version)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [scorerId])

  // 展开时首次加载；切换评分器时重置
  useEffect(() => {
    setOpen(false)
    setVersions([])
    setDiff(null)
    setError(null)
  }, [scorerId])

  useEffect(() => {
    if (open && versions.length === 0 && !loading) load()
  }, [open, versions.length, loading, load])

  const runDiff = async () => {
    if (from == null || to == null || from === to) return
    setDiffing(true)
    setDiff(null)
    try {
      const { diffScorerVersions } = await import('@/lib/api-client')
      const d = await diffScorerVersions(scorerId, from, to)
      setDiff(d)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDiffing(false)
    }
  }

  const doRestore = async (version: number) => {
    setBusy(true)
    setError(null)
    try {
      const { restoreScorerVersion } = await import('@/lib/api-client')
      const r = await restoreScorerVersion(scorerId, version)
      onRestore(r.config, r.draftVersion)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const fmtVal = (v: any) => {
    if (v == null) return '—'
    if (Array.isArray(v)) return v.length ? v.join(', ') : '[]'
    if (typeof v === 'object') return JSON.stringify(v)
    const s = String(v)
    return s.length > 60 ? s.slice(0, 60) + '…' : s
  }

  return (
    <Panel
      className="mt-4"
      title={
        <button type="button" className="flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <History className="size-4" aria-hidden="true" />
          版本历史
          {versions.length > 0 ? <Tag className="ml-1">{versions.length}</Tag> : null}
        </button>
      }
      actions={
        open ? (
          <Btn size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {loading ? '加载中…' : '刷新'}
          </Btn>
        ) : null
      }
    >
      {!open ? (
        <p className="text-xs text-muted-foreground">展开查看后端已固化的历史版本，可对比差异或取回派生新草稿。</p>
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
            <p className="text-xs text-muted-foreground">暂无已入库的历史版本（发布一次后生成）。</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <Th>版本</Th>
                      <Th>名称</Th>
                      <Th>发布人</Th>
                      <Th>时间</Th>
                      <Th>备注</Th>
                      <Th className="text-right">操作</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.version} className="border-t">
                        <Td>
                          <Mono className="font-semibold">v{v.version}</Mono>
                          {v.version === currentVersion ? <Tag tone="primary" className="ml-1.5">当前</Tag> : null}
                        </Td>
                        <Td>{v.name || '—'}</Td>
                        <Td className="text-xs text-muted-foreground">{v.createdBy || '—'}</Td>
                        <Td className="text-xs text-muted-foreground">{(v.createdAt || '').replace('T', ' ').slice(0, 16)}</Td>
                        <Td className="text-xs text-muted-foreground">{v.note || '—'}</Td>
                        <Td className="text-right">
                          <Btn size="sm" disabled={busy} onClick={() => doRestore(v.version)}>
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            取回
                          </Btn>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>


              {versions.length >= 2 ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <GitCompare className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">对比</span>
                  <select
                    className="h-7 rounded-md border border-input bg-card px-2 text-xs"
                    value={from ?? ''}
                    onChange={(e) => setFrom(Number(e.target.value))}
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>v{v.version}</option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">→</span>
                  <select
                    className="h-7 rounded-md border border-input bg-card px-2 text-xs"
                    value={to ?? ''}
                    onChange={(e) => setTo(Number(e.target.value))}
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>v{v.version}</option>
                    ))}
                  </select>
                  <Btn size="sm" onClick={runDiff} disabled={diffing || from == null || to == null || from === to}>
                    {diffing ? '对比中…' : '对比差异'}
                  </Btn>
                </div>
              ) : null}

              {diff ? (
                diff.identical ? (
                  <p className="text-xs text-pass">v{diff.from} 与 v{diff.to} 内容一致，无差异。</p>
                ) : (
                  <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-medium">v{diff.from} → v{diff.to} 差异</p>
                    {(diff.changes || []).map((c: any) => (
                      <div key={c.field} className="text-xs">
                        <span className="font-medium">{c.label || c.field}</span>
                        {c.field === 'inputs' ? (
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            {(diff.inputs?.added || []).map((i: any) => (
                              <Tag key={`a-${i.name}`} tone="pass">+ {i.name}</Tag>
                            ))}
                            {(diff.inputs?.removed || []).map((i: any) => (
                              <Tag key={`r-${i.name}`} tone="fail">− {i.name}</Tag>
                            ))}
                            {(diff.inputs?.changed || []).map((i: any) => (
                              <Tag key={`c-${i.name}`} tone="warn">~ {i.name}</Tag>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
                            <span className="text-fail">− </span>
                            <Mono>{fmtVal(c.before)}</Mono>
                            <span className="text-pass">+ </span>
                            <Mono>{fmtVal(c.after)}</Mono>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

/** 把后端版本 config 反向映射回前端 Scorer 草稿字段。 */
export function configToScorerPatch(config: Record<string, any>): Partial<Scorer> {
  return {
    name: config.name,
    implType: config.implType,
    inputFields: config.inputFields ?? [],
    outputs: config.outputs ?? [],
    promptTemplate: config.promptTemplate ?? '',
    background: config.background ?? '',
    judgeModel: config.judgeModel ?? '',
    scriptId: config.scriptId ?? undefined,
    evidenceScript: config.evidenceScript ?? undefined,
    referenceCapabilityId: config.referenceCapabilityId ?? undefined,
  }
}

