'use client'

import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { Btn } from './primitives'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认删除',
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="confirm-dialog-title" className="text-sm font-semibold">{title}</h3>
            <p id="confirm-dialog-message" className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn size="sm" variant="outline" onClick={onCancel}>取消</Btn>
          <Btn size="sm" variant="danger" autoFocus onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  )
}
