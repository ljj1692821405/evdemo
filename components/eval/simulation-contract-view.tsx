'use client'

import { useState } from 'react'
import {
  FileCheck2,
  Plus,
  Trash2,
  Database,
  ArrowRight,
  Upload,
  Check,
  Code2,
  FileText,
  ImageIcon,
  Video,
  Layers,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, Th, Td } from './primitives'
import { useScope } from '@/lib/tenant-store'
import {
  useSimulationContracts,
  type ContractFieldType,
  type ContractInputField,
  type ContractOutputField,
} from '@/lib/simulation-contract-store'
import { useFieldDict } from '@/lib/field-dict-store'

const fieldTypeIcons: Record<ContractFieldType, React.ElementType> = {
  text: FileText,
  image: ImageIcon,
  video: Video,
  json: Layers,
  code: Code2,
  number: Sparkles,
}

export function SimulationContractView() {
  const { line, agent } = useScope()
  const { activeContract, addInputField, removeInputField, addOutputField, removeOutputField, updateContract } =
    useSimulationContracts(agent?.id)
  const dict = useFieldDict()

  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input')

  // 新增入参字段表单状态
  const [newInKey, setNewInKey] = useState('')
  const [newInLabel, setNewInLabel] = useState('')
  const [newInType, setNewInType] = useState<ContractFieldType>('text')
  const [newInReq, setNewInReq] = useState(true)

  // 新增出参字段表单状态
  const [newOutKey, setNewOutKey] = useState('')
  const [newOutLabel, setNewOutLabel] = useState('')
  const [newOutType, setNewOutType] = useState<ContractFieldType>('text')
  const [newOutPath, setNewOutPath] = useState('sim_traj.turns[].')

  const handleAddIn = () => {
    if (!newInKey.trim() || !agent) return
    addInputField(agent.id, {
      key: newInKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      label: newInLabel.trim() || newInKey.trim(),
      type: newInType,
      required: newInReq,
    })
    setNewInKey('')
    setNewInLabel('')
  }

  const handleAddOut = () => {
    if (!newOutKey.trim() || !agent) return
    const key = newOutKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    addOutputField(agent.id, {
      key,
      label: newOutLabel.trim() || key,
      type: newOutType,
      sourcePath: newOutPath.trim() || `sim_traj.turns[].${key}`,
      syncToDict: true,
    })
    // 自动同步沉淀到字段字典
    if (!dict.names.includes(key)) {
      dict.add({
        logicalName: key,
        paths: [newOutPath.trim() || `sim_traj.turns[].${key}`],
        avgTokens: 50,
        description: newOutLabel.trim() || key,
      })
    }
    setNewOutKey('')
    setNewOutLabel('')
    setNewOutPath('sim_traj.turns[].')
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部操作条 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileCheck2 className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">产线仿真契约注册台</h2>
              <Tag tone="primary">{agent?.name || '当前 Agent'}</Tag>
              <Tag tone="neutral" className="font-mono">{activeContract.scriptName}</Tag>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a href="/datasets">
            <Btn size="sm" variant="outline">
              <Upload className="size-3.5" />
              前往数据集上传校验
            </Btn>
          </a>
          <a href="/field-dict">
            <Btn size="sm" variant="primary">
              <Database className="size-3.5" />
              查看沉淀字段字典
              <ArrowRight className="size-3" />
            </Btn>
          </a>
        </div>
      </div>

      {/* 契约分栏双面板 (入参契约 vs 结果契约) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 左面板：Case 入参契约 (Input Schema) */}
        <div className="flex flex-col rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary" />
              <span className="text-xs font-bold text-foreground">Case 入参格式契约 (Input Schema)</span>
              <Tag tone="primary">{activeContract.inputContract.length} 项约束</Tag>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3">
            {/* 新增入参字段行 */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_90px_70px_auto] gap-2 items-center rounded-lg border border-dashed p-2.5 bg-muted/10">
              <input
                type="text"
                placeholder="字段键名 (如: query)"
                value={newInKey}
                onChange={(e) => setNewInKey(e.target.value)}
                className="h-7.5 rounded border border-input bg-card px-2 font-mono text-xs"
              />
              <input
                type="text"
                placeholder="中文说明"
                value={newInLabel}
                onChange={(e) => setNewInLabel(e.target.value)}
                className="h-7.5 rounded border border-input bg-card px-2 text-xs"
              />
              <select
                value={newInType}
                onChange={(e) => setNewInType(e.target.value as ContractFieldType)}
                className="h-7.5 rounded border border-input bg-card px-1.5 text-xs font-medium"
              >
                <option value="text">文本</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
                <option value="json">JSON</option>
              </select>
              <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newInReq}
                  onChange={(e) => setNewInReq(e.target.checked)}
                  className="rounded accent-primary"
                />
                <span>必填</span>
              </label>
              <Btn size="sm" variant="primary" onClick={handleAddIn} disabled={!newInKey.trim()}>
                <Plus className="size-3" />
                添加
              </Btn>
            </div>

            {/* 入参列表 */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>入参键名 (Key)</Th>
                    <Th>业务说明</Th>
                    <Th className="w-16">类型</Th>
                    <Th className="w-16 text-center">要求</Th>
                    <Th className="w-10 text-center"><span className="sr-only">操作</span></Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeContract.inputContract.map((field) => {
                    const Icon = fieldTypeIcons[field.type] || FileText
                    return (
                      <tr key={field.key} className="hover:bg-muted/30">
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <Icon className="size-3.5 text-primary" />
                            <Mono className="font-bold">{field.key}</Mono>
                          </div>
                        </Td>
                        <Td><span className="text-foreground">{field.label}</span></Td>
                        <Td><Tag tone="neutral">{field.type}</Tag></Td>
                        <Td className="text-center">
                          {field.required ? (
                            <Tag tone="warn" className="font-bold">必填</Tag>
                          ) : (
                            <Tag tone="neutral">可选</Tag>
                          )}
                        </Td>
                        <Td className="text-center">
                          <button
                            type="button"
                            onClick={() => agent && removeInputField(agent.id, field.key)}
                            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-fail-soft hover:text-fail transition-colors"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 右面板：仿真产出结果契约 (Output Schema) */}
        <div className="flex flex-col rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-pass" />
              <span className="text-xs font-bold text-foreground">仿真产出结果契约 (Output Schema)</span>
              <Tag tone="pass">{activeContract.outputContract.length} 项产物</Tag>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3">
            {/* 新增出参字段行 */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_90px_auto] gap-2 items-center rounded-lg border border-dashed p-2.5 bg-muted/10">
              <input
                type="text"
                placeholder="产出字段键名 (如: generated_image)"
                value={newOutKey}
                onChange={(e) => setNewOutKey(e.target.value)}
                className="h-7.5 rounded border border-input bg-card px-2 font-mono text-xs"
              />
              <input
                type="text"
                placeholder="中文说明"
                value={newOutLabel}
                onChange={(e) => setNewOutLabel(e.target.value)}
                className="h-7.5 rounded border border-input bg-card px-2 text-xs"
              />
              <select
                value={newOutType}
                onChange={(e) => setNewOutType(e.target.value as ContractFieldType)}
                className="h-7.5 rounded border border-input bg-card px-1.5 text-xs font-medium"
              >
                <option value="text">文本</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
                <option value="json">JSON</option>
                <option value="code">代码</option>
              </select>
              <Btn size="sm" variant="primary" onClick={handleAddOut} disabled={!newOutKey.trim()}>
                <Plus className="size-3" />
                注册产物
              </Btn>
            </div>

            {/* 出参列表 */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>产出键名 (Key)</Th>
                    <Th>业务说明</Th>
                    <Th className="w-16">类型</Th>
                    <Th>沉淀路径 (Path)</Th>
                    <Th className="w-10 text-center"><span className="sr-only">操作</span></Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeContract.outputContract.map((field) => {
                    const Icon = fieldTypeIcons[field.type] || FileText
                    return (
                      <tr key={field.key} className="hover:bg-muted/30">
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <Icon className="size-3.5 text-pass" />
                            <Mono className="font-bold">{field.key}</Mono>
                          </div>
                        </Td>
                        <Td><span className="text-foreground">{field.label}</span></Td>
                        <Td><Tag tone="primary">{field.type}</Tag></Td>
                        <Td><Mono className="text-[10px] text-muted-foreground">{field.sourcePath}</Mono></Td>
                        <Td className="text-center">
                          <button
                            type="button"
                            onClick={() => agent && removeOutputField(agent.id, field.key)}
                            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-fail-soft hover:text-fail transition-colors"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
