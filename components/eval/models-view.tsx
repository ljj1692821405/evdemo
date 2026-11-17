'use client'

import { useState } from 'react'
import { Plus, Trash2, Power, X, KeyRound } from 'lucide-react'
import { Panel, Tag, Mono, Th, Td, Btn } from './primitives'
import { useModelServices, maskKey, type ModelChannel } from '@/lib/model-service-store'

export function ModelsView() {
  const { channels, addChannel, removeChannel, toggleChannel } = useModelServices()
  const [open, setOpen] = useState(false)

  const active = channels.filter((c) => c.status === 'active').length

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tag tone="pass">{active} 启用</Tag>
          <Tag>{channels.length} 渠道</Tag>
        </div>
        <Btn variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          注册 Key
        </Btn>
      </div>

      <Panel bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <Th>渠道</Th>
                <Th>供应商</Th>
                <Th>Base URL</Th>
                <Th>API Key</Th>
                <Th>模型</Th>
                <Th className="text-right">状态</Th>
                <Th className="w-20"><span className="sr-only">操作</span></Th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {channels.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <Td>
                    <div className="font-medium">{c.name}</div>
                    <Mono className="text-[11px] text-muted-foreground">{c.createdAt}</Mono>
                  </Td>
                  <Td><Tag>{c.provider}</Tag></Td>
                  <Td><Mono className="text-muted-foreground">{c.baseUrl}</Mono></Td>
                  <Td><Mono className="text-muted-foreground">{maskKey(c.apiKey)}</Mono></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.models.map((m) => (
                        <Tag key={m} tone="primary" className="font-mono">{m}</Tag>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Tag tone={c.status === 'active' ? 'pass' : 'neutral'}>{c.status === 'active' ? '启用' : '停用'}</Tag>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleChannel(c.id)}
                        aria-label={c.status === 'active' ? `停用 ${c.name}` : `启用 ${c.name}`}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Power className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeChannel(c.id)}
                        aria-label={`删除 ${c.name}`}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-fail-soft hover:text-fail"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {open ? (
        <RegisterKeyModal
          onClose={() => setOpen(false)}
          onRegister={(channel) => {
            addChannel(channel)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function RegisterKeyModal({
  onClose,
  onRegister,
}: {
  onClose: () => void
  onRegister: (channel: ModelChannel) => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('OpenAI')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState('')

  const canSubmit = name.trim() !== '' && baseUrl.trim() !== '' && apiKey.trim() !== '' && models.trim() !== ''

  const submit = () => {
    if (!canSubmit) return
    onRegister({
      id: `ch_${Date.now()}`,
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models: models.split(',').map((m) => m.trim()).filter(Boolean),
      status: 'active',
      createdAt: '刚刚',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">注册 Key</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-foreground">渠道名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：OpenAI 官方"
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-foreground">供应商</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {['OpenAI', 'Anthropic', 'Google', 'Qwen', '自建'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-foreground">Base URL</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 font-mono text-xs"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-foreground">API Key</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              type="password"
              className="h-8 rounded-md border border-input bg-background px-2.5 font-mono text-xs"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-foreground">模型（逗号分隔）</span>
            <input
              value={models}
              onChange={(e) => setModels(e.target.value)}
              placeholder="gpt-5.4-mini, gpt-5"
              className="h-8 rounded-md border border-input bg-background px-2.5 font-mono text-xs"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3.5">
          <Btn variant="outline" size="sm" onClick={onClose}>取消</Btn>
          <Btn variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>注册</Btn>
        </div>
      </div>
    </div>
  )
}
