'use client'

import { useState } from 'react'
import { ArrowLeft, GitCommitHorizontal, Puzzle, Unlink, Upload, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { kindLabel, sourceLabel, type AgentConfig, type Asset, type AssetVersion } from '@/lib/capability-data'
import { useCapabilities } from '@/lib/capability-store'
import { Btn, Mono, Tag } from './primitives'

const inputCls =
  'w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'

const fieldLabels: Partial<Record<keyof AssetVersion, string>> = {
  intro: '功能介绍',
  remark: '用途备注',
  capability: '能力描述',
  triggers: '触发场景',
  uses: '依赖 Tool',
  input: '输入',
  output: '输出',
}

const show = (v: unknown) => (Array.isArray(v) ? v.join('、') : (v as string) || '—')

function changedFields(prev: AssetVersion | undefined, cur: AssetVersion) {
  if (!prev) return []
  return (Object.keys(fieldLabels) as (keyof AssetVersion)[]).filter((k) => show(prev[k]) !== show(cur[k]))
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm text-pretty', mono && 'rounded bg-muted px-2 py-1.5 font-mono text-xs')}>{children}</dd>
    </div>
  )
}

export function AssetDetail({
  asset,
  pinnedVersion,
  configs,
  editable,
  onBack,
}: {
  asset: Asset
  pinnedVersion: string | undefined
  configs: AgentConfig[]
  editable: boolean
  onBack: () => void
}) {
  const store = useCapabilities()
  const latest = asset.versions.at(-1)!
  const [viewVersion, setViewVersion] = useState(pinnedVersion ?? latest.version)
  const ver = asset.versions.find((v) => v.version === viewVersion) ?? latest
  const [form, setForm] = useState<null | Omit<AssetVersion, 'version' | 'at'>>(null)
  const usedBy = (v: string) => configs.filter((c) => c.refs.some((r) => r.assetId === asset.id && r.version === v)).map((c) => c.version)
  const Icon = asset.kind === 'skill' ? Puzzle : Wrench

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Btn size="sm" variant="ghost" onClick={onBack} aria-label="返回清单">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Btn>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">{asset.name}</h3>
          <Mono className="text-muted-foreground">{asset.code}</Mono>
          <Tag>{kindLabel[asset.kind]}</Tag>
          <Tag tone={asset.source === 'manual' ? 'warn' : 'neutral'}>{sourceLabel[asset.source]}</Tag>
        </div>
        {editable && !form ? (
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="ghost" onClick={() => { store.detachAsset(asset); onBack() }}>
              <Unlink className="size-3.5" aria-hidden="true" />
              从配置移除
            </Btn>
            <Btn size="sm" onClick={() => setForm({ note: '', intro: latest.intro, remark: latest.remark, capability: latest.capability, triggers: latest.triggers, uses: latest.uses, input: latest.input, output: latest.output })}>
              <Upload className="size-3.5" aria-hidden="true" />
              发布新版本
            </Btn>
          </div>
        ) : null}
      </div>

      {form ? (
        <form
          className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.note.trim()) return
            setViewVersion(store.releaseAssetVersion(asset, form))
            setForm(null)
          }}
        >
          <p className="text-xs text-muted-foreground">发布后自动生成新的 Agent 配置版本；已冻结的评测快照不受影响。</p>
          <input aria-label="更新说明" className={inputCls} placeholder="更新说明（必填）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <textarea aria-label="功能介绍" rows={2} className={inputCls} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
          <input aria-label="用途备注" className={inputCls} placeholder="用途备注" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          {asset.kind === 'skill' ? (
            <>
              <input aria-label="能力描述" className={inputCls} placeholder="能力描述" value={form.capability ?? ''} onChange={(e) => setForm({ ...form, capability: e.target.value })} />
              <input aria-label="触发场景" className={inputCls} placeholder="触发场景，逗号分隔" value={form.triggers?.join('，') ?? ''} onChange={(e) => setForm({ ...form, triggers: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
              <input aria-label="依赖 Tool" className={cn(inputCls, 'font-mono')} placeholder="依赖 Tool code，逗号分隔" value={form.uses?.join(',') ?? ''} onChange={(e) => setForm({ ...form, uses: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
            </>
          ) : (
            <>
              <input aria-label="输入" className={cn(inputCls, 'font-mono')} placeholder="输入 schema" value={form.input ?? ''} onChange={(e) => setForm({ ...form, input: e.target.value })} />
              <input aria-label="输出" className={cn(inputCls, 'font-mono')} placeholder="输出 schema" value={form.output ?? ''} onChange={(e) => setForm({ ...form, output: e.target.value })} />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Btn size="sm" variant="ghost" onClick={() => setForm(null)}>取消</Btn>
            <Btn size="sm" variant="primary" type="submit" disabled={!form.note.trim()}>发布</Btn>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            查看版本
            <Mono className="text-foreground">{ver.version}</Mono>
            {pinnedVersion === ver.version ? <Tag tone="primary">本配置引用</Tag> : null}
            {ver.version === latest.version ? <Tag tone="pass">最新</Tag> : null}
          </div>
          <dl className="flex flex-col gap-3">
            <Field label="功能介绍">{ver.intro}</Field>
            <Field label="用途备注">{ver.remark || '—'}</Field>
            {asset.kind === 'skill' ? (
              <>
                <Field label="能力描述">{ver.capability || '—'}</Field>
                <Field label="触发场景">
                  <span className="flex flex-wrap gap-1">{ver.triggers?.map((t) => <Tag key={t}>{t}</Tag>) ?? '—'}</span>
                </Field>
                <Field label="依赖 Tool">
                  <span className="flex flex-wrap gap-1">{ver.uses?.map((t) => <Mono key={t} className="rounded border px-1.5 py-0.5 text-[11px]">{t}</Mono>) ?? '—'}</span>
                </Field>
              </>
            ) : (
              <>
                <Field label="输入" mono>{ver.input || '—'}</Field>
                <Field label="输出" mono>{ver.output || '—'}</Field>
              </>
            )}
          </dl>
        </div>

        <div className="flex flex-col rounded-md border">
          <h4 className="border-b px-3 py-2 text-sm font-medium">版本历史</h4>
          <ol className="flex flex-col">
            {[...asset.versions].reverse().map((v) => {
              const idx = asset.versions.indexOf(v)
              const changes = changedFields(asset.versions[idx - 1], v)
              const refs = usedBy(v.version)
              return (
                <li key={v.version}>
                  <button
                    type="button"
                    onClick={() => setViewVersion(v.version)}
                    aria-current={v.version === ver.version ? 'true' : undefined}
                    className={cn('flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60', v.version === ver.version && 'bg-accent/60')}
                  >
                    <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <Mono className="font-medium">{v.version}</Mono>
                        <span className="text-[11px] text-muted-foreground">{v.at}</span>
                      </span>
                      <span className="text-xs text-pretty">{v.note}</span>
                      {changes.length ? (
                        <span className="flex flex-wrap gap-1">
                          {changes.map((k) => <Tag key={k} tone="warn">{fieldLabels[k]}</Tag>)}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {refs.length ? `被配置 ${refs.join(' / ')} 引用` : '未被任何配置引用'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
