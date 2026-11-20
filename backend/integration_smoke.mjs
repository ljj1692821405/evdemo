/**
 * 前后端联调冒烟测试（Node，直连后端 HTTP，模拟前端 api-client 的请求格式）。
 *
 * 覆盖阶段二全链路：评分器发布 → 版本历史 → diff → 回溯 → 创建实验 → 运行。
 * 用 admin 角色（x-user-role: admin）满足 eval:write 权限。
 *
 * 运行：node integration_smoke.mjs   （需后端已在 127.0.0.1:8000 运行）
 */

const BASE = process.env.API_BASE || 'http://127.0.0.1:8000'
const H = { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-org-id': 'default' }
const STAMP = Date.now()
const SCORER_ID = `sc_itest_${STAMP}`
const EXP_ID = `exp_itest_${STAMP}`

let passed = 0
let failed = 0

function check(cond, label, detail = '') {
  if (cond) {
    passed++
    console.log(`  OK ${label} ${detail}`)
  } else {
    failed++
    console.log(`  XX ${label} ${detail}`)
  }
}

function section(t) {
  console.log(`\n${'='.repeat(56)}\n${t}\n${'='.repeat(56)}`)
}

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  let body = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}

const SCORER_CONFIG_V1 = {
  name: '联调评分器',
  implType: 'llm_judge',
  capabilityRef: { id: 'cap_qa_judge', version: 'v3.0.0' },
  inputs: [{ name: '待评回复', field: 'agent_reply', modality: 'text' }],
  promptTemplate: '# 准绳\n命中即 1 分。',
  judgeModel: 'gpt-4o-mini',
  outputs: ['answer_quality'],
}
const SCORER_CONFIG_V2 = {
  ...SCORER_CONFIG_V1,
  inputs: [
    { name: '待评回复', field: 'agent_reply', modality: 'text' },
    { name: '参考要点', field: 'ground_truth', modality: 'text' },
  ],
  promptTemplate: '# 准绳\n命中且不越权才 1 分。',
}

async function main() {
  section('0. 后端健康检查')
  {
    const { status, body } = await jfetch('/api/health')
    check(status === 200 && body?.ok, 'GET /api/health', `-> ${status}`)
  }

  section('1. 发布评分器 v1（前端 publishScorerVersion 等价请求）')
  {
    const { status, body } = await jfetch(`/api/scorers/${SCORER_ID}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: SCORER_CONFIG_V1, trial_passed: true, note: '联调首发' }),
    })
    check(status === 200 && body?.data?.version === 1, '发布 v1', `-> ${status}`)
  }

  section('2. 发布门禁：trial_passed=false 必须被拒')
  {
    const { status, body } = await jfetch(`/api/scorers/${SCORER_ID}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: SCORER_CONFIG_V1, trial_passed: false }),
    })
    check(status === 400 && body?.code === 'TRIAL_REQUIRED', '未试跑被拒', `-> ${status}`)
  }

  section('3. 发布 v2 + 版本历史')
  {
    const pub = await jfetch(`/api/scorers/${SCORER_ID}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: SCORER_CONFIG_V2, trial_passed: true, note: '加参考要点' }),
    })
    check(pub.body?.data?.version === 2, '发布 v2', `-> v${pub.body?.data?.version}`)

    const list = await jfetch(`/api/scorers/${SCORER_ID}/versions`)
    const versions = (list.body?.data?.versions || []).map((v) => v.version)
    check(JSON.stringify(versions) === '[2,1]', '历史倒序 [2,1]', JSON.stringify(versions))
  }

  section('4. 版本差异 diff')
  {
    const { status, body } = await jfetch(`/api/scorers/${SCORER_ID}/diff?from=1&to=2`)
    const fields = (body?.data?.changes || []).map((c) => c.field)
    check(status === 200 && fields.includes('inputs'), '识别入参变化', JSON.stringify(fields))
    const added = (body?.data?.inputs?.added || []).map((i) => i.name)
    check(JSON.stringify(added) === '["参考要点"]', '新增入参=参考要点', JSON.stringify(added))
  }

  section('5. 回溯 restore（只读，不写库）')
  {
    const { status, body } = await jfetch(`/api/scorers/${SCORER_ID}/versions/1/restore`, { method: 'POST' })
    check(status === 200 && body?.data?.draftVersion === 3, 'restore 返回 draftVersion=3', `-> ${body?.data?.draftVersion}`)
    const list = await jfetch(`/api/scorers/${SCORER_ID}/versions`)
    check(list.body?.data?.total === 2, 'restore 未产生新版本', `total=${list.body?.data?.total}`)
  }

  section('6. 创建实验（createExperiment 等价请求）')
  {
    // 缺版本整体拒绝
    const bad = await jfetch('/api/experiments', {
      method: 'POST',
      body: JSON.stringify({ name: 'bad', scorer_refs: [{ id: SCORER_ID, version: 99 }], snapshot_id: 's' }),
    })
    check(bad.status === 400 && bad.body?.code === 'SCORER_VERSION_MISSING', '缺版本被拒', `-> ${bad.status}`)

    const ok = await jfetch('/api/experiments', {
      method: 'POST',
      body: JSON.stringify({
        experiment_id: EXP_ID,
        name: '联调实验',
        scorer_refs: [{ id: SCORER_ID, version: 1 }],
        snapshot_id: 'snap_itest',
        field_dict_version: 'fd_v1',
        weights: { answer_quality: 1.0 },
      }),
    })
    check(ok.status === 200 && ok.body?.data?.status === 'draft', '创建实验成功', `-> ${ok.status}`)
  }

  section('7. 实验 resolved + 运行')
  {
    const resolved = await jfetch(`/api/experiments/${EXP_ID}/resolved`)
    check((resolved.body?.data?.resolvedScorers || []).length === 1, 'resolved 解析出 1 个评分器')

    const run = await jfetch(`/api/experiments/${EXP_ID}/runs`, { method: 'POST', body: JSON.stringify({ units: 3 }) })
    check(run.status === 200 && run.body?.data?.runId, '创建运行成功', run.body?.data?.runId)

    const exp = await jfetch(`/api/experiments/${EXP_ID}`)
    check(exp.body?.data?.status === 'running', '实验状态变 running')
  }

  section('8. 权限：匿名（无 x-user-role）写操作被拒')
  {
    const res = await fetch(`${BASE}/api/scorers/${SCORER_ID}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'member' },
      body: JSON.stringify({ config: SCORER_CONFIG_V1, trial_passed: true }),
    })
    check(res.status === 403, 'member 发布被拒', `-> ${res.status}`)
  }

  section('9. 前端真实数据流：发布评分器 → 引用创建实验 → 运行')
  {
    const fid = `sc_flow_${STAMP}`
    const fexp = `exp_flow_${STAMP}`
    // 9.1 未发布就引用 → 创建应被拒（对应前端「本地已创建，后端未入库」降级）
    const beforePub = await jfetch('/api/experiments', {
      method: 'POST',
      body: JSON.stringify({ name: '未发布引用', scorer_refs: [{ id: fid, version: 1 }], snapshot_id: 's' }),
    })
    check(beforePub.status === 400 && beforePub.body?.code === 'SCORER_VERSION_MISSING', '未发布评分器引用被拒', `-> ${beforePub.status}`)

    // 9.2 发布评分器 v1（前端 publishScorerVersion）
    const pub = await jfetch(`/api/scorers/${fid}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: SCORER_CONFIG_V1, trial_passed: true }),
    })
    check(pub.body?.data?.version === 1, '发布评分器 v1', `-> v${pub.body?.data?.version}`)

    // 9.3 用已发布版本创建实验（前端 createExperiment）
    const ok = await jfetch('/api/experiments', {
      method: 'POST',
      body: JSON.stringify({
        experiment_id: fexp,
        name: '真实流实验',
        scorer_refs: [{ id: fid, version: 1 }],
        snapshot_id: 'snap_flow',
        weights: { answer_quality: 1.0 },
      }),
    })
    check(ok.status === 200, '引用已发布版本创建实验成功', `-> ${ok.status}`)

    // 9.4 登记运行（前端 createExperimentRun）
    const run = await jfetch(`/api/experiments/${fexp}/runs`, { method: 'POST', body: JSON.stringify({ units: 5 }) })
    check(run.status === 200 && run.body?.data?.runId, '登记运行成功', run.body?.data?.runId)

    // 9.5 实验列表读后端（前端 listExperiments）：应能查到刚建的实验，且字段够前端映射
    const list = await jfetch('/api/experiments')
    const found = (list.body?.data?.experiments || []).find((e) => e.experimentId === fexp)
    check(!!found, '列表包含新建实验', fexp)
    check(
      !!found && Array.isArray(found.scorerRefs) && found.scorerRefs[0]?.id === fid,
      '列表项字段齐全（scorerRefs/createdAt 可映射）',
      found ? `refs=${found.scorerRefs?.length}` : '',
    )

    // 收尾
    await jfetch(`/api/experiments/${fexp}`, { method: 'DELETE' })
  }

  section('10. 能力版本：发布自增 vN.0.0（前端 publishCapabilityVersion / listCapabilityVersions）')
  {
    const cid = `cap_itest_${STAMP}`
    const capCfg = (execType) => ({
      name: '联调能力',
      executionType: execType,
      entrypoint: { target: 'evaluators.itest:Judge', timeoutSec: 30 },
      inputSchema: [{ name: 'q', label: '问题', type: 'text', required: true }],
      outputSchema: { metrics: [{ key: 'score', name: '分', type: 'score' }], hasEvidenceChain: true, hasArtifactOutput: false },
    })

    // 10.1 首次发布 → v1.0.0
    const p1 = await jfetch(`/api/capabilities/${cid}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: capCfg('llm_judge'), name: '联调能力', execution_type: 'llm_judge', trial_passed: true }),
    })
    check(p1.status === 200 && p1.body?.data?.version === 'v1.0.0', '首发 v1.0.0', `-> ${p1.body?.data?.version}`)

    // 10.2 改 executionType 再发布 → v2.0.0（语义版本自增）
    const p2 = await jfetch(`/api/capabilities/${cid}/publish`, {
      method: 'POST',
      body: JSON.stringify({ config: capCfg('vlm_judge'), name: '联调能力', execution_type: 'vlm_judge', trial_passed: true }),
    })
    check(p2.body?.data?.version === 'v2.0.0', '自增 v2.0.0', `-> ${p2.body?.data?.version}`)

    // 10.3 列表（前端面板读取）
    const list = await jfetch(`/api/capabilities/${cid}/versions`)
    const vs = (list.body?.data?.versions || []).map((v) => v.version)
    check(JSON.stringify(vs) === '["v2.0.0","v1.0.0"]', '历史倒序 [v2,v1]', JSON.stringify(vs))
  }

  section('收尾：清理联调数据')
  await jfetch(`/api/experiments/${EXP_ID}`, { method: 'DELETE' })
  // 版本表没有 DELETE 接口（append-only），联调残留用 scorer_id 前缀区分，不影响正式数据
  console.log('  实验已删除；评分器版本为 append-only，保留（id 带 itest 前缀便于识别）')

  console.log(`\n结果：通过 ${passed}，失败 ${failed}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('联调脚本异常：', e)
  process.exit(1)
})
