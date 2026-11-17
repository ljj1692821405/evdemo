'use client'

import { useEffect } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Trash2, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CaseItem } from '@/lib/mock-data'
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

const display = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))

const gtLabel: Record<CaseItem['gtSource'], string> = { case: 'case 自带', dataset: '数据集兜底', missing: '缺 GT' }

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

  const media = mediaOf(current)
  const fields: [string, unknown][] = current.raw
    ? Object.entries(current.raw).filter(([key]) => key !== 'query')
    : [
        ['tags', current.tags.join('、') || '—'],
        ['工作区', current.workspaceSize],
        ['GT', current.gtKeys.join('、') || '—'],
      ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${current.id} 详情`}
        className="flex h-[88vh] w-full max-w-5xl flex-col rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          {current.valid ? <CheckCircle2 className="size-5 text-pass" aria-label="合规" /> : <XCircle className="size-5 text-fail" aria-label="拒收" />}
          <Mono className="text-base font-semibold">{current.id}</Mono>
          <Tag tone={current.gtSource === 'missing' ? 'warn' : 'pass'}>{gtLabel[current.gtSource]}</Tag>
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
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Query</h3>
              <ol className="flex flex-col gap-2">
                {current.query.map((q, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border bg-muted/30 p-3">
                    <Mono className="mt-0.5 shrink-0 text-sm text-muted-foreground">{i + 1}</Mono>
                    <p className={cn('min-w-0 whitespace-pre-wrap text-pretty text-sm leading-relaxed', !q && 'text-fail')}>{q || '（空）'}</p>
                  </li>
                ))}
              </ol>
            </section>

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

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">字段</h3>
              <dl className="divide-y rounded-lg border text-sm">
                {fields.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 px-3 py-2">
                    <dt><Mono className="break-all text-sm text-muted-foreground">{key}</Mono></dt>
                    <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">{display(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
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
