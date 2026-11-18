'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Boxes, Plus, Puzzle, Wrench, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  diffItems,
  frozenSnapshots,
  kindLabel,
  metricsForAgent,
  resolveConfig,
  sourceLabel,
  toFrozen,
  type AssetSource,
  type ResolvedItem,
} from '@/lib/capability-data'
import { useCapabilities, type NewAsset } from '@/lib/capability-store'
import { AssetDetail } from './capability-asset-detail'
import { FrozenSnapshotCard } from './capability-snapshot'
import { Btn, Mono, Tag } from './primitives'

type TabKey = 'list' | 'deps' | 'diff' | 'snapshots'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'list', label: '能力清单' },
  { key: 'deps', label: '依赖关系' },
  { key: 'diff', label: '版本对比' },
  { key: 'snapshots', label: '评测快照' },
]

const inputCls =
  'h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'
const selectCls = 'h-8 rounded-md border border-input bg-card px-2 font-mono text-xs'
const codeRe = /^[a-z][a-z0-9.-]*$/

const fmtRate = (r: number | null | undefined) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`)

export function CapabilityPanel({ agentId, agentCode }: { agentId: string; agentCode: string }) {
  const store = useCapabilities()
  const configs = store.configsOf(agentId)
  const current = configs.at(-1)
  const [viewId, setViewId] = useState<string | undefined>()
  const viewing = configs.find((c) => c.id === viewId) ?? current
  const isCurrent = !!viewing && viewing.id === current?.id
  const [tab, setTab] = useState<TabKey>('list')
  const [openAsset, setOpenAsset] = useState<string | undefined>()
  const [form, setForm] = useState<null | NewAsset>(null)

  const items = viewing ? resolveConfig(viewing, store.assets) : []
  const skills = items.filter((i) => i.asset.kind === 'skill')
  const tools = items.filter((i) => i.asset.kind === 'tool')
  const snaps = frozenSnapshots.filter((s) => s.agentId === agentId)
  const refCount = (version: string) => snaps.filter((s) => s.configVersion === version).length

  const detailAsset = store.assets.find((a) => a.id === openAsset)
  const codeTaken = !!form && store.assets.some((a) => a.agentId === agentId && a.kind === form.kind && a.code === form.code)

  return (
    <section className="mx-4 mb-4 flex flex-col rounded-md border" aria-label="能力配置">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">能力配置</h3>
          <Tag>
            <Puzzle className="size-3" aria-hidden="true" />
            {skills.length} Skill
          </Tag>
          <Tag>
            <Wrench className="size-3" aria-hidden="true" />
            {tools.length} Tool
          </Tag>
        </div>
        {configs.length ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            配置版本
            <select
              className={selectCls}
              value={viewing?.id}
              onChange={(e) => {
                setViewId(e.target.value)
                setOpenAsset(undefined)
              }}
            >
              {[...configs].reverse().map((c) => (
                <option key={c.id} value={c.id}>
                  {agentCode}@{c.version} {c.id === current?.id ? '· 当前' : '· 历史'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div role="tablist" aria-label="能力配置视图" className="flex gap-1 border-b px-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key)
              setOpenAsset(undefined)
            }}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-3" role="tabpanel">
        {detailAsset ? (
          <AssetDetail
            key={detailAsset.id}
            asset={detailAsset}
            pinnedVersion={viewing?.refs.find((r) => r.assetId === detailAsset.id)?.version}
            configs={configs}
            editable={isCurrent}
            onBack={() => setOpenAsset(undefined)}
          />
        ) : tab === 'list' ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <AssetList
              title="Skill"
              icon={Puzzle}
              items={skills}
              onOpen={setOpenAsset}
              onDelete={isCurrent ? store.detachAsset : undefined}
              onAdd={isCurrent ? () => setForm({ kind: 'skill', code: '', name: '', source: 'manual', intro: '', remark: '' }) : undefined}
            >
              {form?.kind === 'skill' ? (
                <RegisterForm
                  form={form}
                  setForm={setForm}
                  codeTaken={codeTaken}
                  nextVersion={current?.version}
                  onSubmit={() => {
                    store.registerAsset(agentId, form)
                    setForm(null)
                  }}
                />
              ) : null}
            </AssetList>
            <AssetList
              title="Tool"
              icon={Wrench}
              items={tools}
              onOpen={setOpenAsset}
              onDelete={isCurrent ? store.detachAsset : undefined}
              onAdd={isCurrent ? () => setForm({ kind: 'tool', code: '', name: '', source: 'manual', intro: '', remark: '' }) : undefined}
            >
              {form?.kind === 'tool' ? (
                <RegisterForm
                  form={form}
                  setForm={setForm}
                  codeTaken={codeTaken}
                  nextVersion={current?.version}
                  onSubmit={() => {
                    store.registerAsset(agentId, form)
                    setForm(null)
                  }}
                />
              ) : null}
            </AssetList>
          </div>
        ) : tab === 'deps' ? (
          <DependencyView skills={skills} tools={tools} agentCode={agentCode} version={viewing?.version} onOpen={setOpenAsset} />
        ) : tab === 'diff' ? (
          <DiffView agentId={agentId} agentCode={agentCode} configs={configs} assets={store.assets} defaultTarget={viewing?.id} />
        ) : (
          <SnapshotList agentId={agentId} />
        )}
      </div>
    </section>
  )
}

function RegisterForm({
  form,
  setForm,
  codeTaken,
  nextVersion,
  onSubmit,
}: {
  form: NewAsset
  setForm: (v: NewAsset | null) => void
  codeTaken: boolean
  nextVersion?: string
  onSubmit: () => void
}) {
  const valid = !!form.name && codeRe.test(form.code) && !codeTaken && !!form.intro
  return (
    <form
      className="flex flex-col gap-2 border-b bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSubmit()
      }}
    >
      <select aria-label="来源" className={cn(inputCls, 'w-full')} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as AssetSource })}>
        {(Object.keys(sourceLabel) as AssetSource[]).map((s) => (
          <option key={s} value={s}>{sourceLabel[s]}</option>
        ))}
      </select>
      <input aria-label="名称" className={cn(inputCls, 'w-full')} placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input aria-label="标识" className={cn(inputCls, 'w-full font-mono')} placeholder="code，如 doc.translate" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.trim() })} />
      {codeTaken ? <p className="text-xs text-fail">该 Agent 下已存在同名 {kindLabel[form.kind]}</p> : null}
      <input aria-label="功能介绍" className={cn(inputCls, 'w-full')} placeholder="功能介绍（必填）" value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
      <input aria-label="用途备注" className={cn(inputCls, 'w-full')} placeholder="用途备注" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
      {form.kind === 'skill' ? (
        <>
          <input aria-label="触发场景" className={cn(inputCls, 'w-full')} placeholder="触发场景，逗号分隔" onChange={(e) => setForm({ ...form, triggers: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
          <input aria-label="依赖 Tool" className={cn(inputCls, 'w-full font-mono')} placeholder="依赖 Tool code，逗号分隔" onChange={(e) => setForm({ ...form, uses: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
        </>
      ) : (
        <>
          <input aria-label="输入" className={cn(inputCls, 'w-full font-mono')} placeholder="输入 schema" onChange={(e) => setForm({ ...form, input: e.target.value })} />
          <input aria-label="输出" className={cn(inputCls, 'w-full font-mono')} placeholder="输出 schema" onChange={(e) => setForm({ ...form, output: e.target.value })} />
        </>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto min-w-0 text-[11px] text-muted-foreground">登记后生成新配置版本 {nextVersion ? `（${nextVersion} → 下一版）` : 'v1.0'}</span>
        <Btn size="sm" variant="ghost" onClick={() => setForm(null)}>取消</Btn>
        <Btn size="sm" variant="primary" type="submit" disabled={!valid}>登记</Btn>
      </div>
    </form>
  )
}

function InlineDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
        aria-label={`删除 ${label}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-opacity hover:bg-fail-soft hover:text-fail focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-fail px-2 text-[11px] font-medium text-primary-foreground hover:bg-fail/90"
      >
        <Trash2 className="size-3" aria-hidden="true" />
        删除
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        aria-label="取消"
        className="flex size-7 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-muted"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  )
}

function AssetList({
  title,
  icon: Icon,
  items,
  onOpen,
  onDelete,
  onAdd,
  children,
}: {
  title: string
  icon: typeof Puzzle
  items: ResolvedItem[]
  onOpen: (id: string) => void
  onDelete?: (asset: ResolvedItem['asset']) => void
  onAdd?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-md border">
      <h4 className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5">
          <Icon className="size-3.5" aria-hidden="true" />
          {title}
          <span>({items.length})</span>
        </span>
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-input bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" aria-hidden="true" />
            登记
          </button>
        ) : null}
      </h4>
      {children}
      <ul>
        {items.length === 0 ? <li className="px-3 py-5 text-center text-xs text-muted-foreground">暂无</li> : null}
        {items.map(({ asset, ver }) => {
          const latest = asset.versions.at(-1)!.version
          return (
            <li key={asset.id} className="group flex items-center gap-1 border-b pr-2 last:border-b-0">
              <button type="button" onClick={() => onOpen(asset.id)} className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 text-left hover:bg-muted/60">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{asset.name}</span>
                  <Mono className="text-muted-foreground">{asset.code}</Mono>
                  <Tag tone="primary">{ver.version}</Tag>
                  {ver.version !== latest ? <Tag tone="warn">最新 {latest}</Tag> : null}
                  <span className="ml-auto text-[11px] text-muted-foreground">{sourceLabel[asset.source]}</span>
                </span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{ver.intro}</span>
                {ver.remark ? <span className="line-clamp-1 text-[11px] text-muted-foreground/80">备注：{ver.remark}</span> : null}
              </button>
              {onDelete ? <InlineDelete label={asset.code} onConfirm={() => onDelete(asset)} /> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Chip({ item, onOpen, tone }: { item: ResolvedItem; onOpen: (id: string) => void; tone: 'skill' | 'tool' }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.asset.id)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted',
        tone === 'skill' ? 'border-primary/40 bg-accent/50' : 'bg-card',
      )}
    >
      {tone === 'skill' ? <Puzzle className="size-3 text-primary" aria-hidden="true" /> : <Wrench className="size-3 text-muted-foreground" aria-hidden="true" />}
      <span className="font-mono">{item.asset.code}</span>
      <span className="font-mono text-muted-foreground">@{item.ver.version}</span>
    </button>
  )
}

function DependencyView({
  skills,
  tools,
  agentCode,
  version,
  onOpen,
}: {
  skills: ResolvedItem[]
  tools: ResolvedItem[]
  agentCode: string
  version?: string
  onOpen: (id: string) => void
}) {
  const used = new Set(skills.flatMap((s) => s.ver.uses ?? []))
  const orphan = tools.filter((t) => !used.has(t.asset.code))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mono className="rounded bg-foreground px-2 py-1 text-background">
          {agentCode}@{version}
        </Mono>
        <ArrowRight className="size-3.5" aria-hidden="true" />
        {skills.length} Skill
        <ArrowRight className="size-3.5" aria-hidden="true" />
        {tools.length} Tool
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        {skills.map((s) => (
          <li key={s.asset.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <Chip item={s} onOpen={onOpen} tone="skill" />
            <ArrowRight className="size-3.5 text-muted-foreground" aria-label="调用" />
            <span className="flex flex-wrap gap-1.5">
              {(s.ver.uses ?? []).length === 0 ? <span className="text-xs text-muted-foreground">无 Tool 依赖</span> : null}
              {(s.ver.uses ?? []).map((code) => {
                const t = tools.find((x) => x.asset.code === code)
                return t ? (
                  <Chip key={code} item={t} onOpen={onOpen} tone="tool" />
                ) : (
                  <span key={code} className="inline-flex items-center gap-1 rounded-md border border-dashed border-fail/60 px-2 py-1 font-mono text-xs text-fail">
                    {code} · 未在配置中
                  </span>
                )
              })}
            </span>
          </li>
        ))}
        {orphan.length ? (
          <li className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">Agent 直接调用</span>
            {orphan.map((t) => <Chip key={t.asset.id} item={t} onOpen={onOpen} tone="tool" />)}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

function DiffView({
  agentId,
  agentCode,
  configs,
  assets,
  defaultTarget,
}: {
  agentId: string
  agentCode: string
  configs: ReturnType<ReturnType<typeof useCapabilities>['configsOf']>
  assets: ReturnType<typeof useCapabilities>['assets']
  defaultTarget?: string
}) {
  const tIdx = Math.max(0, configs.findIndex((c) => c.id === defaultTarget))
  const [targetId, setTargetId] = useState(configs[tIdx]?.id)
  const [baseId, setBaseId] = useState(configs[Math.max(0, tIdx - 1)]?.id)
  const base = configs.find((c) => c.id === baseId)
  const target = configs.find((c) => c.id === targetId)
  if (configs.length < 2 || !base || !target) return <p className="py-8 text-center text-sm text-muted-foreground">至少需要两个配置版本才能对比</p>

  const diff = diffItems(toFrozen(resolveConfig(base, assets)), toFrozen(resolveConfig(target, assets)))
  const metrics = metricsForAgent(agentId)
  const mb = metrics[base.version]
  const mt = metrics[target.version]
  const delta = mb?.rate != null && mt?.rate != null ? mt.rate - mb.rate : null
  const rows = [
    ...diff.added.map((i) => ({ ...i, type: '新增' as const, from: '—' })),
    ...diff.removed.map((i) => ({ ...i, type: '删除' as const, from: i.version, version: '—' })),
    ...diff.modified.map((i) => ({ ...i, type: '修改' as const })),
  ]
  const typeTone = { 新增: 'pass', 删除: 'fail', 修改: 'warn' } as const

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          基线
          <select className={selectCls} value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {configs.map((c) => <option key={c.id} value={c.id}>{agentCode}@{c.version}</option>)}
          </select>
        </label>
        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <label className="flex items-center gap-1.5 text-muted-foreground">
          对比
          <select className={selectCls} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {configs.map((c) => <option key={c.id} value={c.id}>{agentCode}@{c.version}</option>)}
          </select>
        </label>
        <span className="ml-auto flex gap-1.5">
          <Tag tone="pass">+{diff.added.length} 新增</Tag>
          <Tag tone="fail">-{diff.removed.length} 删除</Tag>
          <Tag tone="warn">~{diff.modified.length} 修改</Tag>
          <Tag>{diff.unchanged.length} 未变</Tag>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: `${base.version} 通过率`, value: fmtRate(mb?.rate), sub: mb ? `${mb.runs} 次评测 · ${mb.pass}/${mb.total}` : '暂无评测' },
          { label: `${target.version} 通过率`, value: fmtRate(mt?.rate), sub: mt ? `${mt.runs} 次评测 · ${mt.pass}/${mt.total}` : '暂无评测' },
          {
            label: '效果变化',
            value: delta == null ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pt`,
            sub: delta == null ? '缺少可对比的评测结果' : delta >= 0 ? '能力变更后效果提升' : '能力变更后效果下降，建议排查',
            tone: delta == null ? undefined : delta >= 0 ? 'text-pass' : 'text-fail',
          },
        ].map((m) => (
          <div key={m.label} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div className={cn('mt-1 font-mono text-lg font-semibold tabular-nums', m.tone)}>{m.value}</div>
            <div className="text-[11px] text-muted-foreground">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">变更</th>
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">能力</th>
              <th className="px-3 py-2 font-medium">版本</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">两个版本配置一致</td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={`${r.kind}:${r.code}`}>
                <td className="px-3 py-2"><Tag tone={typeTone[r.type]}>{r.type}</Tag></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{kindLabel[r.kind]}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.name}</span> <Mono className="text-muted-foreground">{r.code}</Mono>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <span className={cn(r.type === '删除' && 'line-through text-muted-foreground')}>{r.from}</span>
                  {r.type !== '删除' ? (
                    <>
                      <span className="px-1 text-muted-foreground" aria-label="变为">→</span>
                      <span className="font-medium">{r.version}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SnapshotList({ agentId }: { agentId: string }) {
  const snaps = frozenSnapshots.filter((s) => s.agentId === agentId)
  const metrics = metricsForAgent(agentId)
  if (!snaps.length) return <p className="py-8 text-center text-sm text-muted-foreground">该 Agent 暂无评测快照</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">评测任务创建时冻结所用的 Agent / Skill / Tool 版本，后续配置变更不会影响历史快照。</p>
      <ul className="flex flex-col divide-y rounded-md border">
        {snaps.map((s) => (
          <li key={s.expId} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/experiments?id=${s.expId}`} className="font-mono text-sm font-medium text-primary hover:underline">
                {s.expId}
              </Link>
              <span className="ml-auto text-xs text-muted-foreground">
                配置通过率 <span className="font-mono text-foreground">{fmtRate(metrics[s.configVersion]?.rate)}</span>
              </span>
            </div>
            <FrozenSnapshotCard snap={s} />
          </li>
        ))}
      </ul>
    </div>
  )
}
