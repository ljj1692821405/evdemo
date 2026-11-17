'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

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

export const seedChannels: ModelChannel[] = [
  {
    id: 'ch_openai',
    name: 'OpenAI 官方',
    provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-proj-9f2a1c7d4b8e',
    models: ['gpt-5.4-mini', 'gpt-5'],
    status: 'active',
    createdAt: '11-10 09:20',
  },
  {
    id: 'ch_anthropic',
    name: 'Anthropic 官方',
    provider: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-ant-3c5e8b1f6a2d',
    models: ['claude-sonnet-4.5'],
    status: 'active',
    createdAt: '11-11 14:05',
  },
  {
    id: 'ch_google',
    name: 'Google AI Studio',
    provider: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'AIzaSyD7h2k9m4n6p',
    models: ['gemini-2.5-flash'],
    status: 'active',
    createdAt: '11-12 10:40',
  },
  {
    id: 'ch_relay',
    name: '自建中转',
    provider: '自建',
    baseUrl: 'https://llm.internal/v1',
    apiKey: 'sk-relay-8d1f4a7c2e9b',
    models: ['qwen-2.5-vl-72b', 'gpt-4o'],
    status: 'disabled',
    createdAt: '11-08 16:30',
  },
]

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
