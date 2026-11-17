'use client'

import { useShared } from './field-dict-store'
import { resolveConfig, seedAssets, seedConfigs, type AgentConfig, type Asset, type AssetKind, type AssetSource, type AssetVersion, type AssetRef } from './capability-data'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`
const now = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const bumpMinor = (v: string) => {
  const [maj, min] = v.replace(/^v/, '').split('.').map(Number)
  return `v${maj}.${(min ?? 0) + 1}`
}
const bumpAssetVersion = (v: string) => `v${Number(v.replace(/^v/, '')) + 1}`

export type NewAsset = { kind: AssetKind; code: string; name: string; source: AssetSource } & Omit<AssetVersion, 'version' | 'at' | 'note'>

export function useAgentTools(agentId: string | undefined) {
  const { assets, currentOf } = useCapabilities()
  const cfg = agentId ? currentOf(agentId) : undefined
  const tools = cfg
    ? resolveConfig(cfg, assets)
        .filter((i) => i.asset.kind === 'tool')
        .map((i) => ({ name: i.asset.code, purpose: i.ver.intro, version: i.ver.version }))
    : []
  return { tools, configVersion: cfg?.version }
}

export function useCapabilities() {
  const [assets, setAssets] = useShared<Asset[]>('cap-assets', seedAssets)
  const [configs, setConfigs] = useShared<AgentConfig[]>('cap-configs', seedConfigs)

  const configsOf = (agentId: string) => configs.filter((c) => c.agentId === agentId)
  const currentOf = (agentId: string) => configsOf(agentId).at(-1)

  const publish = (agentId: string, note: string, mutate: (refs: AssetRef[]) => AssetRef[]) => {
    const cur = currentOf(agentId)
    const version = cur ? bumpMinor(cur.version) : 'v1.0'
    const next: AgentConfig = { id: uid('cfg'), agentId, version, at: now(), author: '我', note, refs: mutate(cur?.refs ?? []) }
    setConfigs((cs) => [...cs, next])
    return version
  }

  return {
    assets,
    configs,
    configsOf,
    currentOf,
    registerAsset: (agentId: string, input: NewAsset) => {
      const { kind, code, name, source, ...ver } = input
      const id = uid(kind === 'skill' ? 'sk' : 'tl')
      const asset: Asset = { id, kind, code, name, source, agentId, versions: [{ ...ver, version: 'v1', at: now(), note: '首次登记' }] }
      setAssets((as) => [...as, asset])
      publish(agentId, `新增 ${kind === 'skill' ? 'Skill' : 'Tool'} ${code}`, (refs) => [...refs, { assetId: id, version: 'v1' }])
      return id
    },
    releaseAssetVersion: (asset: Asset, patch: Omit<AssetVersion, 'version' | 'at'>) => {
      const version = bumpAssetVersion(asset.versions.at(-1)!.version)
      setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, versions: [...a.versions, { ...patch, version, at: now() }] } : a)))
      publish(asset.agentId, `${asset.code} 升级至 ${version}：${patch.note}`, (refs) =>
        refs.some((r) => r.assetId === asset.id) ? refs.map((r) => (r.assetId === asset.id ? { ...r, version } : r)) : [...refs, { assetId: asset.id, version }],
      )
      return version
    },
    detachAsset: (asset: Asset) => publish(asset.agentId, `移除 ${asset.code}`, (refs) => refs.filter((r) => r.assetId !== asset.id)),
  }
}
