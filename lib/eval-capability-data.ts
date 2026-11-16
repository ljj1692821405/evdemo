export type FieldType = 'text' | 'image' | 'video' | 'json'

export type InputField = {
  key: string
  label: string
  type: FieldType
  required: boolean
  description: string
  multiple?: boolean
  defaultMapping?: string
}

export type PipelineStep = { stage: 'preprocess' | 'multimodal' | 'judge' | 'parse'; name: string; desc: string }

export type OutputField = { key: string; type: string; desc: string }

export type ParamDef =
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; step?: number; hint?: string }
  | { key: string; label: string; type: 'select'; default: string; options: string[]; hint?: string }
  | { key: string; label: string; type: 'boolean'; default: boolean; hint?: string }

export type ParamValue = number | string | boolean

export type CapabilityVersion = { version: string; at: string; note: string }

export type SuggestedDim = { key: string; name: string; criteria: string; fields: string[]; rubric: Rubric }

export type EvalCapability = {
  id: string
  code: string
  name: string
  modality: string
  summary: string
  scenarios: string[]
  owner: string
  entrypoint: string
  versions: CapabilityVersion[]
  inputSchema: InputField[]
  pipeline: PipelineStep[]
  outputSchema: OutputField[]
  params: ParamDef[]
  judgeModels: string[]
  suggestedDims: SuggestedDim[]
}

export type RubricOption = { label: string; desc: string; score: number }

export type Rubric =
  | { kind: 'binary'; pass: string; fail: string }
  | { kind: 'scale'; min: number; max: number; anchors: string[] }
  | { kind: 'options'; options: RubricOption[] }

export type RubricKind = Rubric['kind']

export type RubricDim = SuggestedDim & { id: string; weight: number }

export type CapScorerStatus = 'draft' | 'published'

export type CapScorer = {
  id: string
  lineId: string
  capabilityId: string
  capabilityVersion: string
  name: string
  mapping: Record<string, string>
  judgeModel: string
  prompt: string
  params: Record<string, ParamValue>
  dims: RubricDim[]
  datasetId: string
  taskIds: string[]
  status: CapScorerStatus
  version: number
}

export type AnnotItem = { id: string; scorerId: string; values: Record<string, string>; judge: Record<string, number> }

export const rubricKindLabel: Record<RubricKind, string> = {
  binary: '0 / 1',
  scale: '1 ~ 5 分',
  options: '自定义选项',
}

export const fieldTypeLabel: Record<FieldType, string> = { text: 'Text', image: 'Image', video: 'Video', json: 'JSON' }

export const stageLabel: Record<PipelineStep['stage'], string> = {
  preprocess: '输入预处理',
  multimodal: '多模态处理',
  judge: '裁判模型调用',
  parse: '结果解析',
}

export const defaultRubric = (kind: RubricKind): Rubric => {
  if (kind === 'binary') return { kind, pass: '满足判定标准', fail: '不满足判定标准' }
  if (kind === 'scale') return { kind, min: 1, max: 5, anchors: ['完全不符合', '较差', '一般', '较好', '完全符合'] }
  return {
    kind,
    options: [
      { label: 'A', desc: '优秀，可直接使用', score: 1 },
      { label: 'B', desc: '可用，需少量修改', score: 0.6 },
      { label: 'C', desc: '不可用', score: 0 },
    ],
  }
}

export const rubricRange = (r: Rubric) => {
  if (r.kind === 'binary') return { min: 0, max: 1 }
  if (r.kind === 'scale') return { min: r.min, max: r.max }
  const scores = r.options.map((o) => o.score)
  return { min: Math.min(...scores), max: Math.max(...scores) }
}

export const normalizeScore = (r: Rubric, value: number) => {
  const { min, max } = rubricRange(r)
  return max === min ? 0 : (value - min) / (max - min)
}

export const weightedScore = (dims: RubricDim[], values: Record<string, number | undefined>) => {
  let sum = 0
  let weights = 0
  for (const d of dims) {
    const v = values[d.id]
    if (v === undefined) continue
    sum += normalizeScore(d.rubric, v) * d.weight
    weights += d.weight
  }
  return weights === 0 ? null : sum / weights
}

const commonOutput: OutputField[] = [
  { key: 'status', type: "'ok' | 'error' | 'skipped'", desc: '执行状态' },
  { key: 'overall', type: 'number (0~1)', desc: '按维度权重归一化后的总分' },
  { key: 'dimensions[]', type: '{ key, value, normalized, reason }', desc: '各评分维度结构化结果' },
  { key: 'metrics', type: 'Record<string, number>', desc: '能力自带的结构化指标' },
  { key: 'error', type: '{ code, message } | null', desc: '错误信息' },
]

export const capabilities: EvalCapability[] = [
  {
    id: 'cap_t2i',
    code: 'eval.text_to_image',
    name: '文生图评价',
    modality: 'Text → Image',
    summary: '评估文生图结果与 Prompt 的语义一致性、角色一致性、画面质量与安全合规，支持多张生成图批量评分。',
    scenarios: ['营销海报 / 素材生成', 'IP 角色一致性回归', '生图模型选型对比'],
    owner: '多模态平台组',
    entrypoint: 'capabilities.t2i:evaluate',
    versions: [
      { version: 'v1.0', at: '10-08 14:20', note: '首次注册：语义一致性 + 画质' },
      { version: 'v1.1', at: '10-27 10:05', note: '新增参考角色图输入，支持角色一致性' },
      { version: 'v1.2', at: '11-12 16:40', note: '多图批量评分；输出新增 clip_score 指标' },
    ],
    inputSchema: [
      { key: 'prompt', label: '生成 Prompt', type: 'text', required: true, description: '用户输入的生图描述', defaultMapping: 'user_query' },
      { key: 'reference_image', label: '参考角色图', type: 'image', required: false, description: '用于角色一致性判定，可为空', defaultMapping: 'ref_image_url' },
      { key: 'generated_images', label: '生成图片', type: 'image', required: true, multiple: true, description: '待评估的生成结果，支持多张', defaultMapping: 'output_images' },
      { key: 'style_spec', label: '风格约束', type: 'json', required: false, description: '画幅、风格、禁止元素等结构化约束', defaultMapping: 'style_spec' },
    ],
    pipeline: [
      { stage: 'preprocess', name: '字段校验与归一化', desc: '校验必填字段，统一图片格式与分辨率（长边 1024）' },
      { stage: 'multimodal', name: '图像特征抽取', desc: '计算 CLIP 相似度、人脸 / 角色 embedding、NSFW 检测' },
      { stage: 'judge', name: 'VLM 裁判评分', desc: '按评分规则逐维度调用视觉裁判模型，输出分值与理由' },
      { stage: 'parse', name: '结果解析与聚合', desc: '解析 JSON 输出，按维度权重聚合为统一输出契约' },
    ],
    outputSchema: [...commonOutput, { key: 'metrics.clip_score', type: 'number', desc: '图文 CLIP 相似度' }],
    params: [
      { key: 'temperature', label: '裁判温度', type: 'number', default: 0, min: 0, max: 1, step: 0.1 },
      { key: 'image_detail', label: '图像精度', type: 'select', default: 'high', options: ['low', 'high', 'auto'] },
      { key: 'aggregate', label: '多图聚合', type: 'select', default: 'mean', options: ['mean', 'min', 'best_of_n'], hint: '多张生成图如何合并为一个分值' },
      { key: 'nsfw_gate', label: '安全一票否决', type: 'boolean', default: true, hint: '命中 NSFW 时总分直接记 0' },
    ],
    judgeModels: ['openai/gpt-5', 'google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5'],
    suggestedDims: [
      { key: 'semantic', name: '语义一致性', criteria: '画面主体、动作、场景是否完整体现 Prompt 描述', fields: ['prompt', 'generated_images'], rubric: defaultRubric('scale') },
      { key: 'character', name: '角色一致性', criteria: '发型、服饰、配色等关键特征是否与参考角色图一致', fields: ['reference_image', 'generated_images'], rubric: { kind: 'binary', pass: '关键特征一致', fail: '存在明显偏差' } },
      { key: 'quality', name: '画面质量', criteria: '构图、清晰度、是否存在肢体 / 文字畸变', fields: ['generated_images'], rubric: defaultRubric('options') },
    ],
  },
  {
    id: 'cap_i2v',
    code: 'eval.image_to_video',
    name: '图生视频评价',
    modality: 'Image → Video',
    summary: '评估图生视频结果的首帧保真、运镜执行、时序连贯与物理合理性，支持抽帧与整段视频联合判定。',
    scenarios: ['商品展示短视频', '运镜指令遵循回归', '视频模型版本对比'],
    owner: '多模态平台组',
    entrypoint: 'capabilities.i2v:evaluate',
    versions: [
      { version: 'v0.9', at: '10-20 11:30', note: '首次注册：首帧保真 + 时序连贯' },
      { version: 'v1.0', at: '11-10 09:15', note: '新增运镜要求输入与运镜执行维度' },
    ],
    inputSchema: [
      { key: 'first_frame', label: '首帧图', type: 'image', required: true, description: '图生视频的输入图', defaultMapping: 'input_image_url' },
      { key: 'video', label: '生成视频', type: 'video', required: true, description: '待评估视频（mp4，≤ 20s）', defaultMapping: 'output_video_url' },
      { key: 'camera_motion', label: '运镜要求', type: 'text', required: false, description: '如「缓慢推近」「右摇 30°」', defaultMapping: 'camera_instruction' },
      { key: 'gen_params', label: '生成参数', type: 'json', required: false, description: '时长、帧率、种子等，用于结果归因', defaultMapping: 'gen_params' },
    ],
    pipeline: [
      { stage: 'preprocess', name: '视频解码与校验', desc: '校验时长 / 编码，按 2 fps 均匀抽帧' },
      { stage: 'multimodal', name: '时序特征计算', desc: '首帧 SSIM、光流估计运镜轨迹、帧间闪烁检测' },
      { stage: 'judge', name: '视频裁判评分', desc: '关键帧序列 + 运镜要求送入视频理解模型逐维度评分' },
      { stage: 'parse', name: '结果解析与聚合', desc: '合并规则指标与裁判结果，输出统一契约' },
    ],
    outputSchema: [
      ...commonOutput,
      { key: 'metrics.first_frame_ssim', type: 'number', desc: '首帧结构相似度' },
      { key: 'metrics.flicker_rate', type: 'number', desc: '帧间闪烁比例' },
    ],
    params: [
      { key: 'fps_sample', label: '抽帧频率 (fps)', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { key: 'max_frames', label: '最大帧数', type: 'number', default: 32, min: 8, max: 64, step: 8 },
      { key: 'temperature', label: '裁判温度', type: 'number', default: 0, min: 0, max: 1, step: 0.1 },
      { key: 'include_audio', label: '包含音轨', type: 'boolean', default: false },
    ],
    judgeModels: ['google/gemini-2.5-pro', 'openai/gpt-5'],
    suggestedDims: [
      { key: 'fidelity', name: '首帧保真', criteria: '视频开头是否保持首帧主体、构图与色调', fields: ['first_frame', 'video'], rubric: defaultRubric('scale') },
      { key: 'camera', name: '运镜执行', criteria: '镜头运动是否符合运镜要求的方向与幅度', fields: ['video', 'camera_motion'], rubric: { kind: 'binary', pass: '运镜符合要求', fail: '运镜缺失或方向错误' } },
      { key: 'temporal', name: '时序连贯', criteria: '是否存在闪烁、形变、物体突然出现 / 消失', fields: ['video'], rubric: defaultRubric('scale') },
    ],
  },
]

export const datasets = [
  { id: 'ds_t2i_ip', name: '角色 IP 生图集 · 120 条', fields: ['user_query', 'ref_image_url', 'output_images', 'style_spec', 'model_name'] },
  { id: 'ds_i2v_goods', name: '商品图生视频集 · 64 条', fields: ['input_image_url', 'output_video_url', 'camera_instruction', 'gen_params', 'model_name'] },
  { id: 'ds_mix', name: '多模态混合回归集 · 200 条', fields: ['user_query', 'ref_image_url', 'output_images', 'input_image_url', 'output_video_url', 'camera_instruction', 'style_spec', 'gen_params'] },
]

export const evalTasks = [
  { id: 'task_t2i_weekly', name: '生图模型周回归' },
  { id: 'task_i2v_release', name: '视频模型发版前评测' },
  { id: 'task_ab', name: '模型选型 A/B' },
]

export const capabilityById = (id: string) => capabilities.find((c) => c.id === id)

export const latestVersion = (c: EvalCapability) => c.versions.at(-1)!.version

export const defaultParams = (c: EvalCapability) =>
  Object.fromEntries(c.params.map((p) => [p.key, p.default])) as Record<string, ParamValue>

export const defaultMapping = (c: EvalCapability) =>
  Object.fromEntries(c.inputSchema.map((f) => [f.key, f.defaultMapping ?? ''])) as Record<string, string>

export const dimsFromCapability = (c: EvalCapability): RubricDim[] => {
  const w = Math.round((1 / c.suggestedDims.length) * 100) / 100
  return c.suggestedDims.map((d) => ({ ...d, id: `${c.id}_${d.key}`, weight: w }))
}

export const defaultPromptFor = (c: EvalCapability) =>
  `你是${c.name}裁判。请仅依据评分规则逐维度评分，并给出简短理由。\n输出 JSON：{ "dimensions": [{ "key", "value", "reason" }] }`

export const scorerFromCapability = (c: EvalCapability, lineId: string, id: string): CapScorer => ({
  id,
  lineId,
  capabilityId: c.id,
  capabilityVersion: latestVersion(c),
  name: `${c.name}评分器`,
  mapping: defaultMapping(c),
  judgeModel: c.judgeModels[0],
  prompt: defaultPromptFor(c),
  params: defaultParams(c),
  dims: dimsFromCapability(c),
  datasetId: c.id === 'cap_t2i' ? 'ds_t2i_ip' : 'ds_i2v_goods',
  taskIds: [],
  status: 'draft',
  version: 1,
})

const t2i = capabilities[0]
const i2v = capabilities[1]

export const seedCapScorers: CapScorer[] = [
  { ...scorerFromCapability(t2i, 'pl_doc', 'csc_t2i'), status: 'published', taskIds: ['task_t2i_weekly'] },
  { ...scorerFromCapability(i2v, 'pl_doc', 'csc_i2v'), taskIds: ['task_i2v_release'] },
]

export const seedAnnotItems: AnnotItem[] = [
  {
    id: 'ann_t2i_01',
    scorerId: 'csc_t2i',
    values: {
      prompt: '短发青绿色的女探险家，橙色围巾、棕色皮夹克，日出时站在雪山山脊上，手持黄铜指南针',
      reference_image: '/annot/t2i-ref.png',
      generated_images: '/annot/t2i-gen-a.png',
      style_spec: JSON.stringify({ aspect: '1:1', style: 'anime', forbid: ['文字水印'] }, null, 2),
    },
    judge: { csc_t2i_semantic: 5, csc_t2i_character: 1, csc_t2i_quality: 1 },
  },
  {
    id: 'ann_t2i_02',
    scorerId: 'csc_t2i',
    values: {
      prompt: '短发青绿色的女探险家，橙色围巾、棕色皮夹克，夜晚提灯走在森林里',
      reference_image: '/annot/t2i-ref.png',
      generated_images: '/annot/t2i-gen-b.png',
      style_spec: JSON.stringify({ aspect: '1:1', style: 'anime', forbid: ['文字水印'] }, null, 2),
    },
    judge: { csc_t2i_semantic: 3, csc_t2i_character: 0, csc_t2i_quality: 0.6 },
  },
  {
    id: 'ann_i2v_01',
    scorerId: 'csc_i2v',
    values: {
      first_frame: '/annot/i2v-frame.png',
      video: '/annot/i2v-video.png',
      camera_motion: '镜头缓慢推近至杯口，保持蒸汽可见',
      gen_params: JSON.stringify({ duration: 5, fps: 24, seed: 4182, model: 'video-gen-v3' }, null, 2),
    },
    judge: { csc_i2v_fidelity: 4, csc_i2v_camera: 1, csc_i2v_temporal: 4 },
  },
]
