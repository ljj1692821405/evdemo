'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, XCircle, Plus, X, Upload, Check, FileUp, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { snapshots, type CaseItem } from '@/lib/mock-data'
import { useDatasets } from '@/lib/dataset-store'
import { useScope } from '@/lib/tenant-store'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import { ConfirmDialog } from './confirm-dialog'
import { CaseDetailDialog } from './case-detail-dialog'

type UploadResult = { file: string; ok: number; rejected: number } | null
type PendingDelete = { kind: 'dataset'; id: string } | { kind: 'case'; id: string } | null

function parseCases(text: string, datasetId: string, startIndex: number): CaseItem[] {
  const trimmed = text.trim()
  let rows: unknown[] = []
  try {
    const parsed = JSON.parse(trimmed)
    rows = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    rows = trimmed.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return { __bad: line } }
    })
  }
  return rows.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const bad = '__bad' in r
    const id = typeof r.id === 'string' && r.id ? r.id : `case_${String(startIndex + i + 1).padStart(4, '0')}`
    const q = r.query
    const query = Array.isArray(q) ? q.map(String) : typeof q === 'string' ? [q] : []
    const gt = r.gt && typeof r.gt === 'object' ? Object.keys(r.gt as object) : []
    const invalidReason = bad ? 'JSON 解析失败' : query.length === 0 ? '缺少 query' : query.some((x) => !x.trim()) ? 'query 含空字符串' : undefined
    return {
      id,
      datasetId,
      query: query.length ? query : [''],
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      workspaceSize: r.initial_workspace ? `${(JSON.stringify(r.initial_workspace).length / 1024).toFixed(1)} KB` : '—',
      gtSource: gt.length ? 'case' : 'missing',
      gtKeys: gt,
      valid: !invalidReason,
      invalidReason,
      raw: bad ? undefined : r,
    }
  })
}

const snapshotImpact = (datasetId: string) => {
  const n = snapshots.filter((s) => s.datasetId === datasetId).length
  return n ? `将影响 ${n} 个已冻结快照的可追溯性。` : ''
}

export function DatasetsView() {
  const { agent } = useScope()
  return <AgentDatasets key={agent?.id ?? 'none'} />
}

function AgentDatasets() {
  const store = useDatasets()
  const { datasets, cases } = store
  const [dsId, setDsId] = useState(datasets[0]?.id ?? '')
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingDelete>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', tags: '' })
  const [upload, setUpload] = useState<UploadResult>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ds = datasets.find((d) => d.id === dsId) ?? datasets[0]
  const list = ds ? cases.filter((c) => c.datasetId === ds.id) : []
  const invalid = list.filter((c) => !c.valid).length

  const createDataset = () => {
    const name = draft.name.trim()
    if (!name) return
    const id = `ds_${Date.now().toString(36)}`
    store.addDataset({ id, name, version: 'v1', caseCount: 0, tags: draft.tags.split(/[,，\s]+/).filter(Boolean), defaultGt: false, updatedAt: '2026-11-17' })
    setDsId(id)
    setUpload(null)
    setDraft({ name: '', tags: '' })
    setCreating(false)
  }

  const onFile = async (file: File) => {
    if (!ds) return
    const added = parseCases(await file.text(), ds.id, list.length)
    const existing = new Set(cases.map((c) => c.id))
    const unique = added.map((c) => (existing.has(c.id) ? { ...c, id: `${c.id}_${ds.id.slice(-4)}` } : c))
    store.addCases(ds.id, unique)
    setUpload({ file: file.name, ok: unique.filter((c) => c.valid).length, rejected: unique.filter((c) => !c.valid).length })
  }

  const pendingDataset = pending?.kind === 'dataset' ? datasets.find((d) => d.id === pending.id) : undefined
  const pendingCase = pending?.kind === 'case' ? cases.find((c) => c.id === pending.id) : undefined

  const confirmDelete = () => {
    if (pendingDataset) {
      store.removeDataset(pendingDataset.id)
      if (ds?.id === pendingDataset.id) {
        setOpenCase(null)
        setUpload(null)
      }
    } else if (pendingCase) {
      if (openCase === pendingCase.id) {
        const i = list.findIndex((c) => c.id === pendingCase.id)
        setOpenCase((list[i + 1] ?? list[i - 1])?.id ?? null)
      }
      store.removeCase(pendingCase.id)
    }
    setPending(null)
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Panel
        title="数据集"
        actions={
          <Btn size="sm" variant={creating ? 'ghost' : 'outline'} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            {creating ? <X className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
            {creating ? '取消' : '新建'}
          </Btn>
        }
        className="lg:self-start"
        bodyClassName="p-1"
      >
        {creating ? (
          <form onSubmit={(e) => { e.preventDefault(); createDataset() }} className="mb-1 flex flex-col gap-2 rounded-md bg-accent/40 p-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              名称
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="黄金集-意图理解" className="h-8 rounded-md border bg-card px-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              标签
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="golden, 多轮" className="h-8 rounded-md border bg-card px-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </label>
            <Btn type="submit" size="sm" variant="primary" disabled={!draft.name.trim()}>
              <Check className="size-3.5" aria-hidden="true" />创建
            </Btn>
          </form>
        ) : null}
        {datasets.length === 0 && !creating ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无数据集</p> : null}
        <ul>
          {datasets.map((d) => {
            const active = d.id === ds?.id
            return (
              <li key={d.id} className={cn('group flex items-center gap-1 rounded-md pr-1', active ? 'bg-accent' : 'hover:bg-muted')}>
                <button
                  type="button"
                  onClick={() => { setDsId(d.id); setUpload(null) }}
                  aria-current={active ? 'true' : undefined}
                  className="min-w-0 flex-1 rounded-md px-3 py-2 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    <Mono className="shrink-0 text-muted-foreground">{d.caseCount}</Mono>
                  </div>
                  {d.tags.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {d.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                    </div>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setPending({ kind: 'dataset', id: d.id })}
                  aria-label={`删除数据集 ${d.name}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      </Panel>

      {ds ? (
        <Panel
          title={<span className="flex items-center gap-2">{ds.name}<Mono className="text-muted-foreground">{ds.version}</Mono></span>}
          actions={
            <div className="flex items-center gap-1.5">
              {list.length ? <Tag tone="pass">{list.length - invalid} 合规</Tag> : null}
              {invalid ? <Tag tone="fail">{invalid} 拒收</Tag> : null}
              <input
                ref={fileRef}
                type="file"
                accept=".jsonl,.json,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
              />
              <Btn size="sm" variant="primary" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3.5" aria-hidden="true" />上传 case
              </Btn>
            </div>
          }
          className="min-w-0"
          bodyClassName="overflow-x-auto p-0"
        >
          {upload ? (
            <div role="status" className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
              <FileUp className="size-4 text-muted-foreground" aria-hidden="true" />
              <Mono className="text-sm">{upload.file}</Mono>
              <Tag tone="pass">+{upload.ok}</Tag>
              {upload.rejected ? <Tag tone="fail">拒收 {upload.rejected}</Tag> : null}
              <button type="button" onClick={() => setUpload(null)} aria-label="关闭" className="ml-auto text-muted-foreground hover:text-foreground"><X className="size-4" aria-hidden="true" /></button>
            </div>
          ) : null}
          {list.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
              className="m-4 flex w-[calc(100%-2rem)] flex-col items-center gap-2 rounded-lg border-2 border-dashed py-12 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary"
            >
              <FileUp className="size-6" aria-hidden="true" />
              <span className="font-medium">上传 case</span>
              <Mono className="text-sm">.jsonl / .json</Mono>
            </button>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <Th className="w-8"><span className="sr-only">校验</span></Th>
                  <Th className="text-xs">Case</Th>
                  <Th className="text-xs">Query</Th>
                  <Th className="text-right text-xs">轮数</Th>
                  <Th className="text-right text-xs">工作区</Th>
                  <Th className="text-xs">GT</Th>
                  <Th className="w-10"><span className="sr-only">操作</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((c) => (
                  <tr key={c.id} onClick={() => setOpenCase(c.id)} className="group cursor-pointer hover:bg-muted/40">
                    <Td>{c.valid ? <CheckCircle2 className="size-4 text-pass" aria-label="合规" /> : <XCircle className="size-4 text-fail" aria-label="拒收" />}</Td>
                    <Td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenCase(c.id) }} className="font-mono text-sm font-semibold hover:text-primary hover:underline">
                        {c.id}
                      </button>
                    </Td>
                    <Td className="max-w-md"><span className="line-clamp-1">{c.query[0] || <span className="text-fail">（空）</span>}</span></Td>
                    <Td className="text-right"><Mono className="text-sm">{c.query.length}</Mono></Td>
                    <Td className="whitespace-nowrap text-right"><Mono className="text-sm text-muted-foreground">{c.workspaceSize}</Mono></Td>
                    <Td>
                      <span className={cn('whitespace-nowrap', c.gtSource === 'missing' && 'text-warn')}>
                        {c.gtSource === 'case' ? 'case 自带' : c.gtSource === 'dataset' ? '数据集兜底' : '缺 GT'}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPending({ kind: 'case', id: c.id }) }}
                        aria-label={`删除 ${c.id}`}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card py-16 text-sm text-muted-foreground">
          暂无数据
          <Btn variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />新建数据集
          </Btn>
        </div>
      )}

      {openCase && list.some((c) => c.id === openCase) ? (
        <CaseDetailDialog
          cases={list}
          currentId={openCase}
          onNavigate={setOpenCase}
          onClose={() => setOpenCase(null)}
          onDelete={(id) => setPending({ kind: 'case', id })}
        />
      ) : null}

      {pendingDataset ? (
        <ConfirmDialog
          title="删除数据集"
          message={`确定删除「${pendingDataset.name}」及其 ${cases.filter((c) => c.datasetId === pendingDataset.id).length} 条 case 吗？${snapshotImpact(pendingDataset.id)}`}
          onCancel={() => setPending(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
      {pendingCase ? (
        <ConfirmDialog
          title="删除 Case"
          message={`确定删除 ${pendingCase.id} 吗？${snapshotImpact(pendingCase.datasetId)}`}
          onCancel={() => setPending(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  )
}
