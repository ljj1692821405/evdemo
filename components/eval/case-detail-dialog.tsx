'use client'

import { useEffect } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Trash2, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CaseItem } from '@/lib/mock-data'
import { caseDimensions, caseExtraFields, caseLabels, caseTurns, caseWorkspace } from '@/lib/case-shape'
import { Mono, Tag } from './primitives'

type Media = { key: string; url: string; kind: 'image' | 'video' }

const imageRe = /^data:image\/|\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i
const videoRe = /\.(mp4|webm|mov)(\?|#|$)/i

function mediaOf(c: CaseItem): Media[] {
  if (!c.raw) return []
  return Object.entries(c.raw).flatMap(([key, value]): Media[] => {
    if (typeof value !== 'string') return []
    if (imageRe.test(value)) return [{ key, url: value, kind: 'image' }]
    if (videoRe.test(value)) return [{ key, url: value, kind: 'video' }]
    return []
  })
}

export function CaseDetailDialog({
  cases,
  currentId,
  onNavigate,
  onClose,
  onDelete,
}: {
  cases: CaseItem[]
  currentId: string
  onNavigate: (id: string) => void
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const index = Math.max(0, cases.findIndex((c) => c.id === currentId))
  const current = cases[index]
  const prev = cases[index - 1]
  const next = cases[index + 1]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id)
      else if (e.key === 'ArrowRight' && next) onNavigate(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, onNavigate, onClose])

  if (!current) return null

  const turns = caseTurns(current)
  const workspace = caseWorkspace(current)
  const labels: [string, string][] = current.raw ? caseLabels(current) : current.tags.map((t) => ['tag', t])
  const dims = caseDimensions(current)
  const extra = caseExtraFields(current)
  const media = mediaOf(current)
  const legacyId = typeof current.raw?.legacy_id === 'string' ? current.raw.legacy_id : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${current.id} 详情`}
        className="flex h-[90vh] w-full max-w-6xl flex-col rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          {current.valid ? <CheckCircle2 className="size-5 text-pass" aria-label="合规" /> : <XCircle className="size-5 text-fail" aria-label="拒收" />}
          <Mono className="text-base font-semibold">{current.id}</Mono>
          {legacyId ? <Mono className="text-sm text-muted-foreground">{legacyId}</Mono> : null}
          {current.invalidReason ? <span className="text-sm text-fail">{current.invalidReason}</span> : null}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={!prev}
              onClick={() => prev && onNavigate(prev.id)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />上一条
            </button>
            <Mono className="px-2 text-sm text-muted-foreground">{index + 1} / {cases.length}</Mono>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && onNavigate(next.id)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              下一条<ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(current.id)}
              aria-label={`删除 ${current.id}`}
              className="ml-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={onClose} aria-label="关闭" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-5">
            {dims.length || labels.length ? (
              <section className="flex flex-col gap-2">
                {dims.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {dims.map((d) => <Tag key={d} tone="primary" className="px-2 py-1 text-xs">{d}</Tag>)}
                  </div>
                ) : null}
                {labels.length ? (
                  <dl className="flex flex-wrap gap-1.5">
                    {labels.map(([key, value], i) => (
                      <div key={`${key}:${i}`} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                        {current.raw ? <dt className="text-muted-foreground">{key}</dt> : null}
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">对话</h3>
              <ol className="flex flex-col gap-3">
                {turns.map((t) => (
                  <li key={t.no} className="overflow-hidden rounded-lg border">
                    <div className="flex gap-3 bg-muted/30 p-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground">{t.no}</span>
                      <p className={cn('min-w-0 whitespace-pre-wrap text-pretty text-sm leading-relaxed', !t.query && 'text-fail')}>{t.query || '（空）'}</p>
                    </div>
                    {t.gt.length ? (
                      <div className="flex flex-col gap-3 border-t p-3">
                        {t.gt.map((g) => (
                          <div key={g.key} className="flex flex-col gap-1.5">
                            <Mono className="text-sm font-semibold text-primary">{g.key}</Mono>
                            {g.points.length ? (
                              <ol className="flex flex-col gap-1.5">
                                {g.points.map((p, i) => (
                                  <li key={i} className="flex gap-2 text-sm leading-relaxed">
                                    <Mono className="mt-0.5 shrink-0 text-sm text-muted-foreground">{i + 1}</Mono>
                                    <span className="min-w-0 text-pretty">{p}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <span className="text-sm text-muted-foreground">本轮无 GT</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>

            {workspace ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">初始工作区</h3>
                {workspace.name || workspace.description ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    {workspace.name ? <div className="text-sm font-medium">{workspace.name}</div> : null}
                    {workspace.description ? <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{workspace.description}</p> : null}
                  </div>
                ) : null}
                {workspace.files.map((f) => (
                  <details key={f.path} className="rounded-lg border">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                      <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                      <Mono className="text-sm font-semibold">{f.path}</Mono>
                      <Mono className="ml-auto text-sm text-muted-foreground">{(f.content.length / 1024).toFixed(1)} KB</Mono>
                    </summary>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t bg-muted/20 p-3 font-mono text-[13px] leading-relaxed">{f.content}</pre>
                  </details>
                ))}
              </section>
            ) : !current.raw ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">初始工作区</h3>
                <Mono className="text-sm">{current.workspaceSize}</Mono>
              </section>
            ) : null}

            {media.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">媒体</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {media.map((m) => (
                    <figure key={m.key} className="flex flex-col gap-1.5 rounded-lg border p-2">
                      {m.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url || '/placeholder.svg'} alt={m.key} className="aspect-video w-full rounded-md bg-muted object-contain" />
                      ) : (
                        <video src={m.url} controls className="aspect-video w-full rounded-md bg-black object-contain" />
                      )}
                      <figcaption><Mono className="text-sm">{m.key}</Mono></figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ) : null}

            {extra.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">其他字段</h3>
                <dl className="divide-y rounded-lg border text-sm">
                  {extra.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 px-3 py-2">
                      <dt><Mono className="break-all text-sm text-muted-foreground">{key}</Mono></dt>
                      <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">{JSON.stringify(value, null, 2)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </div>

          <nav aria-label="全部 case" className="min-h-0 overflow-y-auto border-t p-4 lg:border-l lg:border-t-0">
            <ul className="grid grid-cols-5 gap-1.5">
              {cases.map((c, i) => {
                const thumb = mediaOf(c).find((m) => m.kind === 'image')?.url
                const active = c.id === current.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(c.id)}
                      aria-label={c.id}
                      aria-current={active ? 'true' : undefined}
                      title={c.query[0] || c.id}
                      className={cn(
                        'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border font-mono text-sm transition-colors',
                        active ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50',
                        !thumb && (c.valid ? (active ? 'bg-accent text-accent-foreground' : 'bg-muted/40 text-muted-foreground') : 'bg-fail-soft text-fail'),
                      )}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb || '/placeholder.svg'} alt="" className="size-full object-cover" />
                      ) : (
                        i + 1
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  )
}
