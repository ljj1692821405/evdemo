'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, XCircle, ArrowRight, Plus, X, Upload, Check, FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cases as initialCases, datasets as initialDatasets, type CaseItem, type Dataset } from '@/lib/mock-data'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'

type UploadResult = { file: string; ok: number; rejected: number } | null

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
    const id = typeof r.id === 'string' && r.id ? r.id : `case_${String(startIndex + i + 1).padStart(4, '0')}`
    const q = r.query
    const query = Array.isArray(q) ? q.map(String) : typeof q === 'string' ? [q] : []
    const gt = r.gt && typeof r.gt === 'object' ? Object.keys(r.gt as object) : []
    const invalidReason = '__bad' in r ? 'JSON 解析失败' : query.length === 0 ? '缺少 query' : query.some((x) => !x.trim()) ? 'query 含空字符串' : undefined
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
    }
  })
}

export function DatasetsView() {
  const [datasets, setDatasets] = useState<Dataset[]>(initialDatasets)
  const [cases, setCases] = useState<CaseItem[]>(initialCases)
  const [dsId, setDsId] = useState(initialDatasets[0].id)
  const [caseId, setCaseId] = useState(initialCases[0].id)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', tags: '' })
  const [upload, setUpload] = useState<UploadResult>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const ds = datasets.find((d) => d.id === dsId)!
  const list = cases.filter((c) => c.datasetId === dsId)

  const createDataset = () => {
    const name = draft.name.trim()
    if (!name) return
    const id = `ds_${Date.now().toString(36)}`
    setDatasets((d) => [{ id, name, version: 'v1', caseCount: 0, tags: draft.tags.split(/[,，\s]+/).filter(Boolean), defaultGt: false, updatedAt: '2026-11-16' }, ...d])
    setDsId(id)
    setCaseId('')
    setUpload(null)
    setDraft({ name: '', tags: '' })
    setCreating(false)
  }

  const onFile = async (file: File) => {
    const added = parseCases(await file.text(), dsId, list.length)
    const existing = new Set(cases.map((c) => c.id))
    const unique = added.map((c) => (existing.has(c.id) ? { ...c, id: `${c.id}_${dsId.slice(-4)}` } : c))
    setCases((cs) => [...cs, ...unique])
    setDatasets((d) => d.map((x) => (x.id === dsId ? { ...x, caseCount: x.caseCount + unique.length } : x)))
    setUpload({ file: file.name, ok: unique.filter((c) => c.valid).length, rejected: unique.filter((c) => !c.valid).length })
    if (unique[0]) setCaseId(unique[0].id)
  }
  const current = list.find((c) => c.id === caseId) ?? list[0]
  const invalid = list.filter((c) => !c.valid).length

  return (
    <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[240px_1fr_320px]">
      <Panel
        title="数据集"
        actions={
          <Btn size="sm" variant={creating ? 'ghost' : 'outline'} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            {creating ? <X className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
            {creating ? '取消' : '新建'}
          </Btn>
        }
        bodyClassName="p-1"
      >
        {creating ? (
          <form onSubmit={(e) => { e.preventDefault(); createDataset() }} className="mb-1 flex flex-col gap-2 rounded-md bg-accent/40 p-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">名称</span>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="长文档编辑集" className="h-8 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">标签</span>
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="编辑, 多轮" className="h-8 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
            </label>
            <Btn type="submit" size="sm" variant="primary" disabled={!draft.name.trim()}>
              <Check className="size-3.5" aria-hidden="true" />创建
            </Btn>
          </form>
        ) : null}
        <ul>
          {datasets.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => { setDsId(d.id); setUpload(null); setCaseId(cases.find((c) => c.datasetId === d.id)?.id ?? '') }}
                aria-current={d.id === dsId ? 'true' : undefined}
                className={cn('w-full rounded-md px-3 py-2 text-left', d.id === dsId ? 'bg-accent' : 'hover:bg-muted')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  <Mono className="text-muted-foreground">{d.version}</Mono>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Mono className="text-muted-foreground">{d.caseCount} case</Mono>
                  {d.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={<span className="flex items-center gap-2">{ds.name}<Mono className="text-muted-foreground">{ds.id}</Mono></span>}
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
            <Btn size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden="true" />上传 case
            </Btn>
          </div>
        }
        bodyClassName="p-0"
      >
        {upload ? (
          <div role="status" className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs">
            <FileUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <Mono>{upload.file}</Mono>
            <Tag tone="pass">+{upload.ok}</Tag>
            {upload.rejected ? <Tag tone="fail">拒收 {upload.rejected}</Tag> : null}
            <button type="button" onClick={() => setUpload(null)} aria-label="关闭" className="ml-auto text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
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
            <Mono>.jsonl / .json</Mono>
          </button>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr><Th className="w-8" /><Th>case</Th><Th>query</Th><Th>轮数</Th><Th>工作区</Th><Th>GT</Th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setCaseId(c.id)}
                  className={cn('cursor-pointer', c.id === current?.id ? 'bg-accent/50' : 'hover:bg-muted/40')}
                >
                  <Td>{c.valid ? <CheckCircle2 className="size-4 text-pass" aria-label="合规" /> : <XCircle className="size-4 text-fail" aria-label="拒收" />}</Td>
                  <Td><Mono>{c.id}</Mono></Td>
                  <Td className="max-w-xs"><span className="line-clamp-1">{c.query[0] || <span className="text-fail">（空）</span>}</span></Td>
                  <Td><Mono>{c.query.length}</Mono></Td>
                  <Td><Mono className="text-muted-foreground">{c.workspaceSize}</Mono></Td>
                  <Td>
                    <Tag tone={c.gtSource === 'case' ? 'pass' : c.gtSource === 'dataset' ? 'primary' : 'warn'}>
                      {c.gtSource === 'case' ? 'case' : c.gtSource === 'dataset' ? '数据集兜底' : '缺 GT'}
                    </Tag>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {current ? (
        <div className="flex flex-col gap-4">
          <Panel title={<Mono className="text-sm">{current.id}</Mono>}>
            <ol className="flex flex-col gap-2">
              {current.query.map((q, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <Mono className="mt-0.5 text-muted-foreground">q{i}</Mono>
                  <span className={cn('text-pretty', !q && 'text-fail')}>{q || '（空字符串）'}</span>
                </li>
              ))}
            </ol>
            <div className={cn('mt-4 rounded-md p-3 text-xs', current.valid ? 'bg-pass-soft text-pass' : 'bg-fail-soft text-fail')}>
              {current.valid ? '结构校验通过' : <>拒收 · <Mono>{current.invalidReason}</Mono></>}
            </div>
          </Panel>
          <Panel title="GT 兜底链">
            <ol className="flex flex-col gap-1.5">
              {[
                { id: 'case', label: 'case.gt', hit: current.gtSource === 'case' },
                { id: 'dataset', label: 'dataset.default_gt', hit: current.gtSource === 'dataset', disabled: !ds.defaultGt },
                { id: 'missing', label: '缺 GT → na', hit: current.gtSource === 'missing' },
              ].map((s, i, arr) => {
                const passed = arr.findIndex((x) => x.hit) > i
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <div
                      className={cn(
                        'flex flex-1 items-center justify-between rounded-md border px-3 py-2 font-mono text-xs',
                        s.hit && (s.id === 'missing' ? 'border-warn bg-warn-soft text-warn' : 'border-pass bg-pass-soft text-pass'),
                        passed && 'text-muted-foreground line-through',
                      )}
                    >
                      {s.label}
                      {s.hit ? <span className="font-sans font-medium">命中</span> : null}
                    </div>
                    {i < arr.length - 1 ? <ArrowRight className="size-3 rotate-90 text-muted-foreground" aria-hidden="true" /> : null}
                  </li>
                )
              })}
            </ol>
            {current.gtKeys.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {current.gtKeys.map((k) => <Tag key={k}>{k}</Tag>)}
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
