'use client'

import { useShared } from './field-dict-store'

export type ModelModality = 'text' | 'vision' | 'multimodal'

export type ModelService = {
  id: string
  provider: string
  modelId: string
  modality: ModelModality
  contextWindow: number
  pricing: { input: number; output: number }
  status: 'available' | 'offline'
}

export const seedModelServices: ModelService[] = [
  { id: 'ms_gpt54mini', provider: 'OpenAI', modelId: 'gpt-5.4-mini', modality: 'text', contextWindow: 400000, pricing: { input: 0.25, output: 2 }, status: 'available' },
  { id: 'ms_gpt5', provider: 'OpenAI', modelId: 'gpt-5', modality: 'text', contextWindow: 400000, pricing: { input: 1.25, output: 10 }, status: 'available' },
  { id: 'ms_sonnet45', provider: 'Anthropic', modelId: 'claude-sonnet-4.5', modality: 'text', contextWindow: 200000, pricing: { input: 3, output: 15 }, status: 'available' },
  { id: 'ms_gemini25flash', provider: 'Google', modelId: 'gemini-2.5-flash', modality: 'multimodal', contextWindow: 1000000, pricing: { input: 0.3, output: 2.5 }, status: 'available' },
  { id: 'ms_qwen25vl', provider: 'Qwen', modelId: 'qwen-2.5-vl-72b', modality: 'vision', contextWindow: 128000, pricing: { input: 0.4, output: 1.2 }, status: 'available' },
  { id: 'ms_gpt4o_legacy', provider: 'OpenAI', modelId: 'gpt-4o', modality: 'multimodal', contextWindow: 128000, pricing: { input: 2.5, output: 10 }, status: 'offline' },
]

export function useModelServices() {
  const [models] = useShared<ModelService[]>('model-services', seedModelServices)
  return { models }
}
