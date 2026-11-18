/** 前端 API 客户端：统一封装后端请求。 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

export interface ApiResponse<T = any> {
  ok: boolean
  data?: T
  error?: string
}

export interface LLMChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  }>
  model?: string
  temperature?: number
  stream?: boolean
  json_mode?: boolean
}

export interface LLMChatResponse {
  model: string
  content: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  latency_ms: number
}

export interface SSEEvent {
  event: 'meta' | 'delta' | 'usage' | 'done' | 'error'
  [key: string]: any
}

/**
 * 发起非流式 LLM 调用
 */
export async function llmChat(req: LLMChatRequest): Promise<LLMChatResponse> {
  const res = await fetch(`${API_BASE}/api/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const body = (await res.json()) as ApiResponse<LLMChatResponse>
  if (!body.ok || !body.data) throw new Error(body.error || 'LLM 调用失败')
  return body.data
}

/**
 * 发起流式 LLM 调用，返回 SSE 事件流
 */
export async function* llmChatStream(req: LLMChatRequest): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${API_BASE}/api/llm/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // 流结束时处理剩余缓冲区
        if (buffer.trim()) {
          const json = buffer.trim().replace(/^data:\s*/, '')
          if (json) {
            try {
              yield JSON.parse(json) as SSEEvent
            } catch {
              // 忽略解析失败的行
            }
          }
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const json = line.slice(6).trim()
        if (!json) continue
        try {
          yield JSON.parse(json) as SSEEvent
        } catch {
          // 忽略解析失败的行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 获取可用模型列表（带能力标识）
 */
export async function llmListModels(): Promise<Array<{ id: string; name: string; capabilities: string[] }>> {
  const res = await fetch(`${API_BASE}/api/llm/models`)
  const body = (await res.json()) as ApiResponse<{ models: Array<{ id: string; name: string; capabilities: string[] }> }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取模型列表失败')
  return body.data.models
}

/**
 * 获取 LLM 渠道状态（base_url、默认模型、打码 key）
 */
export async function llmStatus(): Promise<{
  ready: boolean
  base_url: string
  model: string
  api_key_masked: string
}> {
  const res = await fetch(`${API_BASE}/api/llm/status`)
  const body = (await res.json()) as ApiResponse<{
    ready: boolean
    base_url: string
    model: string
    api_key_masked: string
  }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取渠道状态失败')
  return body.data
}

/**
 * LLM 连通性探测
 */
export async function llmProbe(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/llm/probe`)
  const body = (await res.json()) as ApiResponse
  return body.data
}
