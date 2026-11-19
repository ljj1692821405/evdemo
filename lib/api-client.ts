/** 前端 API 客户端：统一封装后端请求。 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000'

/**
 * 租户上下文请求头。
 *
 * 后端隔离维度是 (org_id, product_line_id, agent_id)，同一 Agent 内不做用户级隔离。
 * org_id 目前单组织部署，固定 default；产线与 Agent 由调用方传入（来自 useScope）。
 */
export function scopeHeaders(agentId?: string, lineId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'x-org-id': 'default', ...authHeaders() }
  if (lineId) headers['x-product-line-id'] = lineId
  if (agentId) headers['x-agent-id'] = agentId
  return headers
}

export interface ApiResponse<T = any> {
  ok: boolean
  data?: T
  error?: string
}

export interface AuthUser {
  openId: string
  unionId?: string | null
  userId?: string | null
  name: string
  enName?: string | null
  avatarUrl?: string | null
  email?: string | null
  role: string
  orgId: string
  firstLoginAt: string
  lastLoginAt: string
  loginCount: number
}

const SESSION_KEY = 'eval_session_token'

function sessionToken(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(SESSION_KEY) || ''
}

/** 带登录态的请求头。未登录时不加 Authorization，后端按匿名处理。 */
export function authHeaders(): Record<string, string> {
  const token = sessionToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

// ========== 认证 ==========

export async function fetchAuthStatus(): Promise<{ feishuConfigured: boolean; redirectUri: string }> {
  const res = await fetch(`${API_BASE}/api/auth/status`)
  const body = (await res.json()) as ApiResponse<{ feishuConfigured: boolean; redirectUri: string }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取登录配置失败')
  return body.data
}

export async function fetchLoginUrl(state: string, redirect?: string): Promise<{ url: string }> {
  const qs = new URLSearchParams({ state, redirect: redirect || '/' })
  const res = await fetch(`${API_BASE}/api/auth/login-url?${qs}`)
  const body = (await res.json()) as ApiResponse<{ url: string }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取登录地址失败')
  return body.data
}

export async function exchangeFeishuCode(code: string, state: string): Promise<{
  sessionToken: string
  expiresAt: string
  user: AuthUser
  redirect: string
}> {
  const res = await fetch(`${API_BASE}/api/auth/feishu/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  })
  const body = (await res.json()) as ApiResponse<{
    sessionToken: string
    expiresAt: string
    user: AuthUser
    redirect: string
  }>
  if (!body.ok || !body.data) throw new Error(body.error || '飞书登录失败')
  return body.data
}

export async function fetchMe(): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() })
  const body = (await res.json()) as ApiResponse<{ user: AuthUser }>
  if (!body.ok || !body.data) throw new Error(body.error || '未登录')
  return body.data
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: authHeaders() })
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

// ============================================================
// 数据集 API（对接 Week 1-2 后端）
// ============================================================

export interface DatasetDTO {
  id: string
  name: string
  version: string
  caseCount: number
  tags: string[]
  defaultGt: boolean
  updatedAt: string
}

export interface CaseDTO {
  id: string
  datasetId: string
  query: string[]
  tags: string[]
  workspaceSize: string
  gtSource: 'case' | 'dataset' | 'missing'
  gtKeys: string[]
  valid: boolean
  invalidReason?: string
  raw?: Record<string, unknown>
}

/**
 * 获取所有数据集
 */
export async function getDatasets(agentId?: string, lineId?: string): Promise<DatasetDTO[]> {
  const qs = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''
  const res = await fetch(`${API_BASE}/api/datasets${qs}`, { headers: scopeHeaders(agentId, lineId) })
  const body = (await res.json()) as ApiResponse<{ datasets: DatasetDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取数据集失败')
  return body.data.datasets
}

/**
 * 创建数据集
 */
export async function createDataset(input: {
  id: string
  name: string
  agentId: string
  lineId?: string
  version?: string
  tags?: string[]
  defaultGt?: boolean
}): Promise<DatasetDTO> {
  const res = await fetch(`${API_BASE}/api/datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders(input.agentId, input.lineId) },
    body: JSON.stringify({
      id: input.id,
      name: input.name,
      agentId: input.agentId,
      version: input.version ?? 'v1',
      tags: input.tags ?? [],
      defaultGt: input.defaultGt ?? false,
    }),
  })
  const body = (await res.json()) as ApiResponse<DatasetDTO>
  if (!body.ok || !body.data) throw new Error(body.error || '创建数据集失败')
  return body.data
}

/**
 * 删除数据集
 */
export async function deleteDataset(datasetId: string, agentId?: string, lineId?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}`, {
    method: 'DELETE',
    headers: scopeHeaders(agentId, lineId),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '删除数据集失败')
}

/**
 * 获取某 Agent 下所有 case（一次拉全，前端按 datasetId 过滤）
 */
export async function getAllCases(agentId: string, lineId?: string): Promise<CaseDTO[]> {
  const res = await fetch(`${API_BASE}/api/cases?agent_id=${encodeURIComponent(agentId)}`, {
    headers: scopeHeaders(agentId, lineId),
  })
  const body = (await res.json()) as ApiResponse<{ cases: CaseDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取 case 失败')
  return body.data.cases
}

/**
 * 批量添加 case
 */
export async function addCases(
  datasetId: string,
  agentId: string,
  cases: CaseDTO[],
  lineId?: string,
): Promise<CaseDTO[]> {
  const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders(agentId, lineId) },
    body: JSON.stringify({ agentId, cases }),
  })
  const body = (await res.json()) as ApiResponse<{ cases: CaseDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '添加 case 失败')
  return body.data.cases
}

/**
 * 删除 case
 */
export async function deleteCase(caseId: string, agentId?: string, lineId?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/cases/${caseId}`, {
    method: 'DELETE',
    headers: scopeHeaders(agentId, lineId),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '删除 case 失败')
}

// ========== 流程配置 ==========

export interface FlowDTO {
  flow_id: string
  name: string
  description?: string | null
  version: string
  status: string
  org_id?: string
  product_line_id?: string
  agent_id?: string
  input_schema?: Record<string, unknown>
  simulation_config?: Record<string, unknown>
  output_schema?: Record<string, unknown>
  judge_config?: Record<string, unknown> | null
  created_by?: string
  created_at?: string
  updated_at?: string
}

/** 查询流程配置列表 */
export async function getFlows(agentId?: string, lineId?: string): Promise<FlowDTO[]> {
  const res = await fetch(`${API_BASE}/api/flows`, { headers: scopeHeaders(agentId, lineId) })
  const body = (await res.json()) as ApiResponse<{ flows: FlowDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取流程列表失败')
  return body.data.flows
}

/** 查询单个流程配置 */
export async function getFlow(flowId: string, agentId?: string, lineId?: string): Promise<FlowDTO> {
  const res = await fetch(`${API_BASE}/api/flows/${flowId}`, {
    headers: scopeHeaders(agentId, lineId),
  })
  const body = (await res.json()) as ApiResponse<FlowDTO>
  if (!body.ok || !body.data) throw new Error(body.error || '获取流程配置失败')
  return body.data
}

/** 创建流程配置 */
export async function createFlow(input: {
  flowId: string
  name: string
  agentId?: string
  lineId?: string
  description?: string
  version?: string
  inputSchema: Record<string, unknown>
  simulationConfig: Record<string, unknown>
  outputSchema: Record<string, unknown>
  judgeConfig?: Record<string, unknown>
}): Promise<{ flow_id: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders(input.agentId, input.lineId) },
    body: JSON.stringify({
      flow_id: input.flowId,
      name: input.name,
      description: input.description ?? '',
      version: input.version ?? '1.0',
      input_schema: input.inputSchema,
      simulation_config: input.simulationConfig,
      output_schema: input.outputSchema,
      judge_config: input.judgeConfig,
    }),
  })
  const body = (await res.json()) as ApiResponse<{ flow_id: string; message: string }>
  if (!body.ok || !body.data) throw new Error(body.error || '创建流程失败')
  return body.data
}

/** 更新流程配置 */
export async function updateFlow(
  flowId: string,
  updates: Partial<{
    name: string
    description: string
    version: string
    status: string
    input_schema: Record<string, unknown>
    simulation_config: Record<string, unknown>
    output_schema: Record<string, unknown>
    judge_config: Record<string, unknown>
  }>,
  agentId?: string,
  lineId?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/flows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders(agentId, lineId) },
    body: JSON.stringify(updates),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '更新流程失败')
}

/** 删除流程配置（软删除） */
export async function deleteFlow(flowId: string, agentId?: string, lineId?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/flows/${flowId}`, {
    method: 'DELETE',
    headers: scopeHeaders(agentId, lineId),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '删除流程失败')
}

/** 流程历史版本 */
export async function getFlowVersions(flowId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${API_BASE}/api/flows/${flowId}/versions?limit=${limit}`, {
    headers: scopeHeaders(),
  })
  const body = (await res.json()) as ApiResponse<{ versions: Array<Record<string, unknown>> }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取流程版本失败')
  return body.data.versions
}

/** 回滚到指定版本 */
export async function rollbackFlow(flowId: string, version: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/flows/${flowId}/rollback/${version}`, {
    method: 'POST',
    headers: scopeHeaders(),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '回滚流程失败')
}



// ========== 评测任务 ==========

/** 任务状态枚举 —— 与后端契约一致，勿单边改名 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'

export interface TaskDTO {
  taskId: string
  flowId: string
  status: TaskStatus
  totalCases: number
  completedCases: number
  failedCases: number
  /** 后端已算好的进度百分比（0-100），直接用 */
  progress: number
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

/** 提交评测任务：立刻返回 taskId，仿真在后台跑，需轮询 getTask */
export async function createTask(input: {
  flowId: string
  inputData: Array<Record<string, unknown>>
  agentId?: string
  lineId?: string
  createdBy?: string
}): Promise<{ taskId: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders(input.agentId, input.lineId) },
    body: JSON.stringify({
      flowId: input.flowId,
      inputData: input.inputData,
      createdBy: input.createdBy ?? 'system',
    }),
  })
  const body = (await res.json()) as ApiResponse<{ taskId: string; message: string }>
  if (!body.ok || !body.data) throw new Error(body.error || '提交任务失败')
  return body.data
}

/** 查询任务列表 */
export async function getTasks(
  opts: { status?: TaskStatus; limit?: number; offset?: number; agentId?: string; lineId?: string } = {},
): Promise<TaskDTO[]> {
  const qs = new URLSearchParams()
  if (opts.status) qs.set('status', opts.status)
  qs.set('limit', String(opts.limit ?? 50))
  qs.set('offset', String(opts.offset ?? 0))
  const res = await fetch(`${API_BASE}/api/tasks?${qs}`, {
    headers: scopeHeaders(opts.agentId, opts.lineId),
  })
  const body = (await res.json()) as ApiResponse<{ tasks: TaskDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取任务列表失败')
  return body.data.tasks
}

/** 查询单个任务（轮询用） */
export async function getTask(taskId: string): Promise<TaskDTO> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, { headers: scopeHeaders() })
  const body = (await res.json()) as ApiResponse<TaskDTO>
  if (!body.ok || !body.data) throw new Error(body.error || '查询任务失败')
  return body.data
}

/** 取消任务（仅 pending 可取消） */
export async function cancelTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: scopeHeaders(),
  })
  const body = (await res.json()) as ApiResponse
  if (!body.ok) throw new Error(body.error || '取消任务失败')
}

// ========== 评测结果 ==========

export interface ResultDTO {
  id: number
  taskId: string
  flowId: string
  inputData?: Record<string, unknown>
  /** 列表接口可能不含此项（较大），详情接口才有 */
  rawOutput?: Record<string, unknown>
  processedOutput?: Record<string, unknown>
  status: string
  latencyMs: number
  errorMessage?: string
  createdAt?: string
}

/** 查询结果列表 */
export async function getResults(
  opts: { taskId?: string; flowId?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<ResultDTO[]> {
  const qs = new URLSearchParams()
  if (opts.taskId) qs.set('task_id', opts.taskId)
  if (opts.flowId) qs.set('flow_id', opts.flowId)
  if (opts.status) qs.set('status', opts.status)
  qs.set('limit', String(opts.limit ?? 50))
  qs.set('offset', String(opts.offset ?? 0))
  const res = await fetch(`${API_BASE}/api/results?${qs}`, { headers: scopeHeaders() })
  const body = (await res.json()) as ApiResponse<{ results: ResultDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取结果失败')
  return body.data.results
}

/** 查询单条结果详情（含 rawOutput） */
export async function getResult(resultId: number): Promise<ResultDTO> {
  const res = await fetch(`${API_BASE}/api/results/${resultId}`, { headers: scopeHeaders() })
  const body = (await res.json()) as ApiResponse<ResultDTO>
  if (!body.ok || !body.data) throw new Error(body.error || '获取结果详情失败')
  return body.data
}


// ========== LLM 评判 ==========

export interface JudgementDTO {
  id: number
  resultId: string
  caseId?: string
  dimension: string
  score: number
  pass: boolean
  evidence?: string
  reason?: string
  createdAt?: string
}

/** 对单条结果跑一次裁判 */
export async function judgeResult(input: {
  resultId: number
  rubric?: string
  model?: string
  dimension?: string
}): Promise<JudgementDTO & { judgementId: number }> {
  const res = await fetch(`${API_BASE}/api/judges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders() },
    body: JSON.stringify({
      result_id: input.resultId,
      rubric: input.rubric ?? '',
      model: input.model ?? '',
      dimension: input.dimension ?? 'answer_quality',
    }),
  })
  const body = (await res.json()) as ApiResponse<JudgementDTO & { judgementId: number }>
  if (!body.ok || !body.data) throw new Error(body.error || '评判失败')
  return body.data
}

/** 对整批任务结果批量评判 */
export async function judgeBatch(input: {
  taskId: string
  rubric?: string
  model?: string
  dimension?: string
}): Promise<{
  taskId: string
  judged: number
  failed: number
  failures: Array<{ resultId: unknown; error: string }>
  summary: { judged: number; passed: number; passRate: number; avgScore: number }
}> {
  const res = await fetch(`${API_BASE}/api/judges/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...scopeHeaders() },
    body: JSON.stringify({
      task_id: input.taskId,
      rubric: input.rubric ?? '',
      model: input.model ?? '',
      dimension: input.dimension ?? 'answer_quality',
    }),
  })
  const body = (await res.json()) as ApiResponse<any>
  if (!body.ok || !body.data) throw new Error(body.error || '批量评判失败')
  return body.data
}

/** 查询评判记录 */
export async function getJudgements(resultId?: number): Promise<JudgementDTO[]> {
  const qs = resultId ? `?result_id=${resultId}` : ''
  const res = await fetch(`${API_BASE}/api/judges${qs}`, { headers: scopeHeaders() })
  const body = (await res.json()) as ApiResponse<{ judgements: JudgementDTO[] }>
  if (!body.ok || !body.data) throw new Error(body.error || '获取评判记录失败')
  return body.data.judgements
}

// ========== 当前用户权限 ==========

export interface CapabilitiesDTO {
  role: string
  isAdmin: boolean
  permissions: string[]
}

/** 当前用户的角色与权限点，用于隐藏/禁用按钮 */
export async function getCapabilities(): Promise<CapabilitiesDTO> {
  const res = await fetch(`${API_BASE}/api/auth/capabilities`, { headers: authHeaders() })
  const body = (await res.json()) as ApiResponse<CapabilitiesDTO>
  if (!body.ok || !body.data) throw new Error(body.error || '获取权限失败')
  return body.data
}

