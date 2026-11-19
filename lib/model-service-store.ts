'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

/**
 * 模型渠道类型（保留用于向后兼容）。
 * 真实渠道数据由后端 /api/llm/status 和 /api/llm/models 提供，
 * 前端不再存储 apiKey、baseUrl 等敏感信息。
 */
export type ModelChannel = {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  models: string[]
  status: 'active' | 'disabled'
  createdAt: string
}

/** 不再提供本地假数据，渠道信息统一由后端返回。 */
export const seedChannels: ModelChannel[] = []

export const maskKey = (key: string) => {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}

export function useModelServices() {
  const [channels, setChannels] = useShared<ModelChannel[]>('model-channels', seedChannels)

  const addChannel = useCallback(
    (channel: ModelChannel) => setChannels((prev) => [channel, ...prev]),
    [setChannels],
  )

  const removeChannel = useCallback(
    (id: string) => setChannels((prev) => prev.filter((c) => c.id !== id)),
    [setChannels],
  )

  const toggleChannel = useCallback(
    (id: string) =>
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: c.status === 'active' ? 'disabled' : 'active' } : c)),
      ),
    [setChannels],
  )

  return { channels, addChannel, removeChannel, toggleChannel }
}
