'use client'

import useSWR from 'swr'
import { simJobs as fallbackJobs, type SimJob, type SimJobStatus } from './mock-data'
import { useScope } from './tenant-store'
import { createTask, getTasks, type TaskDTO, type TaskStatus } from './api-client'

/**
 * 仿真任务 store：把后端真实的 /api/tasks 接进前端。
 *
 * 设计沿用 dataset-store 的成熟套路：
 * - SWR 拉取 + 运行中自动轮询（后端是异步执行，必须轮询查进度）
 * - 后端不可用（没启动 / 没建库）时回退到 mock 列表，界面不空白
 * - 保留 SimJob 这个前端类型，视图层一行不用改
 *
 * 默认流程 flow_default_sim 由 init_db 预置，member 角色即可提交，无需先建 flow。
 */

export const DEFAULT_FLOW_ID = 'flow_default_sim'

const swrOptions = { revalidateOnFocus: false, keepPreviousData: true }

/** 后端任务状态 → 前端 SimJobStatus。两边枚举已对齐，cancelled 归到 failed 展示。 */
function mapStatus(s: TaskStatus): SimJobStatus {
  if (s === 'cancelled') return 'failed'
  return s as SimJobStatus
}

/** 后端 TaskDTO → 前端 SimJob，补齐视图需要但后端没有的字段。 */
function taskToJob(t: TaskDTO): SimJob {
  return {
    id: t.taskId,
    datasetId: '', // 后端任务不绑数据集概念，视图里显示「—」
    script: t.flowId,
    status: mapStatus(t.status),
    done: t.completedCases,
    total: t.totalCases,
    failed: t.failedCases,
    startedAt: t.createdAt ? t.createdAt.slice(5, 16) : '刚刚',
    errors: [],
  }
}

async function fetchJobs(agentId: string, lineId: string): Promise<SimJob[]> {
  try {
    const tasks = await getTasks({ limit: 50, agentId, lineId })
    return tasks.map(taskToJob)
  } catch {
    // 后端不可用：回退 mock，保证页面可用（和 dataset-store 的回退种子同思路）
    return fallbackJobs
  }
}

export function useSimulations() {
  const { agent, line } = useScope()
  const agentId = agent?.id ?? ''
  const lineId = line?.id ?? ''
  const key = `sim-tasks:${lineId}:${agentId}`

  const { data, mutate } = useSWR<SimJob[]>(key, () => fetchJobs(agentId, lineId), {
    ...swrOptions,
    // 有任务在跑时每 2s 轮询一次后端进度；都结束了就停
    refreshInterval: (list) =>
      (list ?? []).some((j) => j.status === 'running' || j.status === 'pending') ? 2000 : 0,
  })

  const jobs = data ?? []

  return {
    jobs,
    loading: !data,
    reload: () => mutate(),

    /** 提交一个真实仿真任务：POST /api/tasks，立即刷新列表开始轮询 */
    submit: async (cases: Array<Record<string, unknown>>) => {
      await createTask({
        flowId: DEFAULT_FLOW_ID,
        inputData: cases,
        agentId,
        lineId,
      })
      await mutate()
    },
  }
}
