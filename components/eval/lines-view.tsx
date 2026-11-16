'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, Building2, Check, Cpu, ListChecks, Plus, Target, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dimensions } from '@/lib/mock-data'
import {
  roleLabel,
  scheduleLabel,
  useLines,
  useScope,
  type ModelRole,
  type Protocol,
  type TaskSchedule,
} from '@/lib/tenant-store'
import { Btn, Mono, Tag } from './primitives'
import { CapabilityPanel } from './capability-panel'

const inputCls =
  'h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring'
const codeRe = /^[a-z][a-z0-9-]*$/

function ColHeader({ icon: Icon, title, count, onAdd, addLabel }: { icon: typeof Bot; title: string; count: number; onAdd?: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-medium">{title}</h2>
        <Tag>{count}</Tag>
      </div>
      {onAdd ? (
        <Btn size="sm" onClick={onAdd} aria-label={addLabel}>
          <Plus className="size-3.5" aria-hidden="true" />
          新增
        </Btn>
      ) : null}
    </div>
  )
}

function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  if (!armed)
    return (
      <Btn size="sm" variant="ghost" aria-label={`删除 ${label}`} onClick={() => setArmed(true)} className="text-muted-foreground hover:text-fail">
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Btn>
    )
  return (
    <span className="flex items-center gap-1">
      <Btn size="sm" variant="danger" onClick={onConfirm}>确认删除</Btn>
      <Btn size="sm" variant="ghost" aria-label="取消" onClick={() => setArmed(false)}>
        <X className="size-3.5" aria-hidden="true" />
      </Btn>
    </span>
  )
}

export function LinesView() {
  const store = useLines()
  const scope = useScope()
  const [lineId, setLineId] = useState(scope.line?.id ?? store.lines[0]?.id)
  const line = store.lines.find((l) => l.id === lineId) ?? store.lines[0]
  const [agentId, setAgentId] = useState<string | undefined>(scope.agent?.id)
  const agent = line?.agents.find((a) => a.id === agentId) ?? line?.agents[0]

  const [lineForm, setLineForm] = useState<null | { name: string; code: string; owner: string; desc: string }>(null)
  const [agentForm, setAgentForm] = useState<null | { name: string; code: string; endpoint: string; protocol: Protocol; owner: string }>(null)
  const [modelForm, setModelForm] = useState<null | { role: ModelRole; model: string }>(null)
  const [taskForm, setTaskForm] = useState<null | { name: string; dimensions: string[]; schedule: TaskSchedule }>(null)

  const lineCodeTaken = !!lineForm && store.lines.some((l) => l.code === lineForm.code)
  const agentCodeTaken = !!agentForm && !!line?.agents.some((a) => a.code === agentForm.code)
  const isCurrent = !!agent && scope.agent?.id === agent.id && scope.line?.id === line?.id

  return (
    <div className="grid gap-4 p-6 lg:grid-cols-[260px_300px_minmax(0,1fr)]">
      {/* 产线 */}
      <section className="flex flex-col rounded-lg border bg-card" aria-label="产线列表">
        <ColHeader icon={Building2} title="产线" count={store.lines.length} addLabel="新增产线" onAdd={() => setLineForm({ name: '', code: '', owner: '', desc: '' })} />
        {lineForm ? (
          <form
            className="flex flex-col gap-2 border-b bg-muted/40 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!lineForm.name || !codeRe.test(lineForm.code) || lineCodeTaken) return
              const id = store.addLine(lineForm)
              setLineId(id)
              setLineForm(null)
            }}
          >
            <input aria-label="产线名称" className={inputCls} placeholder="产线名称" value={lineForm.name} onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })} />
            <input aria-label="产线标识" className={cn(inputCls, 'font-mono')} placeholder="code，如 search" value={lineForm.code} onChange={(e) => setLineForm({ ...lineForm, code: e.target.value.trim() })} />
            {lineCodeTaken ? <p className="text-xs text-fail">标识已存在</p> : null}
            <input aria-label="负责人" className={inputCls} placeholder="负责人" value={lineForm.owner} onChange={(e) => setLineForm({ ...lineForm, owner: e.target.value })} />
            <input aria-label="描述" className={inputCls} placeholder="描述" value={lineForm.desc} onChange={(e) => setLineForm({ ...lineForm, desc: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Btn size="sm" variant="ghost" onClick={() => setLineForm(null)}>取消</Btn>
              <Btn size="sm" variant="primary" type="submit" disabled={!lineForm.name || !codeRe.test(lineForm.code) || lineCodeTaken}>创建</Btn>
            </div>
          </form>
        ) : null}
        <ul className="flex flex-col">
          {store.lines.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => {
                  setLineId(l.id)
                  setAgentId(undefined)
                }}
                aria-current={l.id === line?.id ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60',
                  l.id === line?.id && 'bg-accent/60 shadow-[inset_2px_0_0_var(--color-primary)]',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{l.name}</span>
                  <Mono className="text-muted-foreground">{l.code}</Mono>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{l.agents.length} 个 Agent</span>
                  <span aria-hidden="true">·</span>
                  <span>{l.owner || '—'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Agent */}
      <section className="flex flex-col rounded-lg border bg-card" aria-label="Agent 列表">
        <ColHeader
          icon={Bot}
          title={line ? `${line.name} · Agent` : 'Agent'}
          count={line?.agents.length ?? 0}
          addLabel="接入 Agent"
          onAdd={line ? () => setAgentForm({ name: '', code: '', endpoint: '', protocol: 'HTTP', owner: line.owner }) : undefined}
        />
        {line ? (
          <div className="flex items-start justify-between gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
            <p className="text-pretty">{line.desc || '暂无描述'}</p>
            <ConfirmDelete label={`产线 ${line.name}`} onConfirm={() => store.removeLine(line.id)} />
          </div>
        ) : null}
        {agentForm && line ? (
          <form
            className="flex flex-col gap-2 border-b bg-muted/40 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!agentForm.name || !codeRe.test(agentForm.code) || agentCodeTaken) return
              setAgentId(store.addAgent(line.id, agentForm))
              setAgentForm(null)
            }}
          >
            <input aria-label="Agent 名称" className={inputCls} placeholder="Agent 名称" value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} />
            <input aria-label="Agent 标识" className={cn(inputCls, 'font-mono')} placeholder="code，如 doc-summary" value={agentForm.code} onChange={(e) => setAgentForm({ ...agentForm, code: e.target.value.trim() })} />
            {agentCodeTaken ? <p className="text-xs text-fail">该产线下标识已存在</p> : null}
            <div className="flex gap-2">
              <select aria-label="协议" className={cn(inputCls, 'w-24 shrink-0')} value={agentForm.protocol} onChange={(e) => setAgentForm({ ...agentForm, protocol: e.target.value as Protocol })}>
                <option>HTTP</option>
                <option>SSE</option>
                <option>gRPC</option>
              </select>
              <input aria-label="接入地址" className={cn(inputCls, 'font-mono')} placeholder="接入地址" value={agentForm.endpoint} onChange={(e) => setAgentForm({ ...agentForm, endpoint: e.target.value.trim() })} />
            </div>
            <div className="flex justify-end gap-2">
              <Btn size="sm" variant="ghost" onClick={() => setAgentForm(null)}>取消</Btn>
              <Btn size="sm" variant="primary" type="submit" disabled={!agentForm.name || !codeRe.test(agentForm.code) || agentCodeTaken}>接入</Btn>
            </div>
          </form>
        ) : null}
        {line && line.agents.length === 0 && !agentForm ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Bot className="size-6" aria-hidden="true" />
            该产线尚未接入 Agent
          </div>
        ) : null}
        <ul className="flex flex-col">
          {line?.agents.map((a) => {
            const current = scope.agent?.id === a.id && scope.line?.id === line.id
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setAgentId(a.id)}
                  aria-current={a.id === agent?.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60',
                    a.id === agent?.id && 'bg-accent/60 shadow-[inset_2px_0_0_var(--color-primary)]',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    {current ? <Tag tone="primary">当前作用域</Tag> : <Tag>{a.protocol}</Tag>}
                  </span>
                  <Mono className="text-muted-foreground">{a.code}</Mono>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{a.models.length} 模型</span>
                    <span>{a.tasks.length} 任务</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Agent 详情 */}
      <section className="flex min-w-0 flex-col rounded-lg border bg-card" aria-label="Agent 详情">
        {!agent || !line ? (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">选择或接入一个 Agent</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">{agent.name}</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ConfirmDelete label={`Agent ${agent.name}`} onConfirm={() => store.removeAgent(line.id, agent.id)} />
                {isCurrent ? (
                  <Link href="/datasets" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    进入评测
                  </Link>
                ) : (
                  <Btn variant="primary" onClick={() => scope.setScope({ lineId: line.id, agentId: agent.id })}>
                    <Target className="size-4" aria-hidden="true" />
                    设为当前作用域
                  </Btn>
                )}
              </div>
            </div>

            <div className="grid gap-4 p-4 xl:grid-cols-2">
              {/* 模型 */}
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                    模型绑定
                  </div>
                  <Btn size="sm" onClick={() => setModelForm({ role: 'target', model: '' })}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    新增
                  </Btn>
                </div>
                {modelForm ? (
                  <form
                    className="flex gap-2 border-b bg-muted/40 p-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!modelForm.model.includes('/')) return
                      store.addModel(line.id, agent.id, modelForm)
                      setModelForm(null)
                    }}
                  >
                    <select aria-label="模型角色" className={cn(inputCls, 'w-28 shrink-0')} value={modelForm.role} onChange={(e) => setModelForm({ ...modelForm, role: e.target.value as ModelRole })}>
                      {(Object.keys(roleLabel) as ModelRole[]).map((r) => (
                        <option key={r} value={r}>{roleLabel[r]}</option>
                      ))}
                    </select>
                    <input aria-label="模型 ID" className={cn(inputCls, 'font-mono')} placeholder="provider/model" value={modelForm.model} onChange={(e) => setModelForm({ ...modelForm, model: e.target.value.trim() })} />
                    <Btn size="md" variant="primary" type="submit" aria-label="确认添加模型" disabled={!modelForm.model.includes('/')}>
                      <Check className="size-4" aria-hidden="true" />
                    </Btn>
                    <Btn size="md" variant="ghost" aria-label="取消" onClick={() => setModelForm(null)}>
                      <X className="size-4" aria-hidden="true" />
                    </Btn>
                  </form>
                ) : null}
                <ul>
                  {agent.models.length === 0 ? <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无模型</li> : null}
                  {agent.models.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <Tag tone={m.role === 'target' ? 'primary' : m.role === 'judge' ? 'warn' : 'neutral'}>{roleLabel[m.role]}</Tag>
                        <Mono className="truncate">{m.model}</Mono>
                      </span>
                      <ConfirmDelete label={m.model} onConfirm={() => store.removeModel(line.id, agent.id, m.id)} />
                    </li>
                  ))}
                </ul>
              </div>

              {/* 评测任务 */}
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
                    评测任务
                  </div>
                  <Btn size="sm" onClick={() => setTaskForm({ name: '', dimensions: [], schedule: 'manual' })}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    新增
                  </Btn>
                </div>
                {taskForm ? (
                  <form
                    className="flex flex-col gap-2 border-b bg-muted/40 p-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!taskForm.name || taskForm.dimensions.length === 0) return
                      store.addTask(line.id, agent.id, { ...taskForm, active: true })
                      setTaskForm(null)
                    }}
                  >
                    <div className="flex gap-2">
                      <input aria-label="任务名称" className={inputCls} placeholder="任务名称" value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} />
                      <select aria-label="触发方式" className={cn(inputCls, 'w-32 shrink-0')} value={taskForm.schedule} onChange={(e) => setTaskForm({ ...taskForm, schedule: e.target.value as TaskSchedule })}>
                        {(Object.keys(scheduleLabel) as TaskSchedule[]).map((s) => (
                          <option key={s} value={s}>{scheduleLabel[s]}</option>
                        ))}
                      </select>
                    </div>
                    <fieldset className="flex flex-wrap gap-1.5">
                      <legend className="sr-only">评测维度</legend>
                      {dimensions.map((d) => {
                        const on = taskForm.dimensions.includes(d.key)
                        return (
                          <button
                            key={d.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setTaskForm({ ...taskForm, dimensions: on ? taskForm.dimensions.filter((k) => k !== d.key) : [...taskForm.dimensions, d.key] })
                            }
                            className={cn(
                              'rounded border px-2 py-1 text-xs transition-colors',
                              on ? 'border-primary bg-accent text-accent-foreground' : 'border-input bg-card hover:bg-muted',
                            )}
                          >
                            <span className="font-mono">{d.key}</span> {d.name}
                          </button>
                        )
                      })}
                    </fieldset>
                    <div className="flex justify-end gap-2">
                      <Btn size="sm" variant="ghost" onClick={() => setTaskForm(null)}>取消</Btn>
                      <Btn size="sm" variant="primary" type="submit" disabled={!taskForm.name || taskForm.dimensions.length === 0}>创建任务</Btn>
                    </div>
                  </form>
                ) : null}
                <ul>
                  {agent.tasks.length === 0 ? <li className="px-3 py-6 text-center text-xs text-muted-foreground">暂无评测任务</li> : null}
                  {agent.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
                      <div className="min-w-0">
                        <div className={cn('flex items-center gap-2 text-sm', !t.active && 'text-muted-foreground')}>
                          {t.name}
                          <Tag>{scheduleLabel[t.schedule]}</Tag>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.dimensions.map((k) => (
                            <Mono key={k} className="rounded bg-muted px-1 text-[11px] text-muted-foreground">
                              {k} {dimensions.find((d) => d.key === k)?.name}
                            </Mono>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={t.active}
                          aria-label={`启用 ${t.name}`}
                          onClick={() => store.toggleTask(line.id, agent.id, t.id)}
                          className={cn('relative h-5 w-9 rounded-full transition-colors', t.active ? 'bg-primary' : 'bg-muted-foreground/30')}
                        >
                          <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', t.active ? 'left-[18px]' : 'left-0.5')} />
                        </button>
                        <ConfirmDelete label={t.name} onConfirm={() => store.removeTask(line.id, agent.id, t.id)} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <CapabilityPanel key={agent.id} agentId={agent.id} agentCode={agent.code} />
          </>
        )}
      </section>
    </div>
  )
}
