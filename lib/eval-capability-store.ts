'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

export type InputFieldType = 'text' | 'image' | 'video' | 'json' | 'audio' | 'number' | 'boolean'

export type CapabilityInputField = {
  name: string
  label: string
  type: InputFieldType
  required: boolean
  description: string
  defaultMapping?: string // 建议映射的数据集/字典字段
  placeholder?: string
  accept?: string // 例如 image/*, video/*
}

export type CapabilityOutputMetric = {
  key: string
  name: string
  type: 'score' | 'boolean' | 'enum' | 'json'
  range?: [number, number]
  options?: string[]
  description: string
}

export type DimensionTemplate = {
  key: string
  name: string
  defaultScoreType: 'binary' | 'scale_5' | 'scale_100' | 'custom_options'
  description: string
  suggestedPrompt?: string
  defaultRubric?: string
  requiredInputs: string[] // 需要该能力的哪些 inputField
}

export type RegisteredCapability = {
  id: string
  code: string
  name: string
  category: 'multimodal_gen' | 'agent_action' | 'nlp_quality' | 'safety' | 'custom'
  version: string
  author: string
  updatedAt: string
  intro: string
  scenario: string
  tags: string[]
  inputSchema: CapabilityInputField[]
  outputSchema: {
    metrics: CapabilityOutputMetric[]
    hasEvidenceChain: boolean
    hasArtifactOutput: boolean
  }
  executionConfig: {
    defaultJudgeModel: string
    supportedModels: string[]
    protocol: 'llm_judge' | 'multi_modal_api' | 'script' | 'vlm_inspector'
    timeoutSec: number
    samplePipeline: string[]
  }
  supportedDimensions: DimensionTemplate[]
  isCustom?: boolean
}

// 预置已注册能力库（支持文生图、图生视频等通用评测能力）
export const seedCapabilities: RegisteredCapability[] = [
  {
    id: 'cap_t2i',
    code: 'eval.t2i.universal',
    name: '文生图评价 (Text-to-Image)',
    category: 'multimodal_gen',
    version: 'v2.1.0',
    author: '多模态组 · 陈晓',
    updatedAt: '2026-11-14',
    intro: '通用文生图综合质量与指令对齐度评测能力，支持提示词遵从度、视觉美感度、图文一致性、角色/风格一致性多维判定。',
    scenario: '文生图模型回归、营销物料生成质检、LoRA 风格适配评测、生图 Agent 产出核验。',
    tags: ['多模态', '文生图', '视觉评测', 'VLM 裁判'],
    inputSchema: [
      { name: 'prompt', label: '正向提示词 (Prompt)', type: 'text', required: true, description: '生图输入的主要正向提示词文本', defaultMapping: 'user_query', placeholder: 'e.g. A cyberpunk cat wearing neon goggles in futuristic Shanghai' },
      { name: 'negative_prompt', label: '负向提示词 (Negative Prompt)', type: 'text', required: false, description: '排除的负向词', defaultMapping: 'negative_prompt', placeholder: 'e.g. blurry, low quality, deformed hands' },
      { name: 'generated_image', label: '生成图片 (Generated Image)', type: 'image', required: true, description: '模型输出的目标图片 URL 或 Base64', defaultMapping: 'agent_reply_image', placeholder: 'https://...' },
      { name: 'reference_image', label: '参考图 / 角色垫图 (Reference Image)', type: 'image', required: false, description: '角色一致性或风格迁移的参考源图', defaultMapping: 'ref_image_url', placeholder: 'https://...' },
      { name: 'generation_params', label: '生成元参数 (Gen Params)', type: 'json', required: false, description: '种子、CFG Scale、步数等参数字典', defaultMapping: 'extra.gen_params' },
    ],
    outputSchema: {
      metrics: [
        { key: 'prompt_alignment', name: '提示词对齐分', type: 'score', range: [1, 5], description: '图文元素吻合度与实体完整度' },
        { key: 'visual_quality', name: '画面美学分', type: 'score', range: [1, 5], description: '分辨率、光影、构图与伪影失真检验' },
        { key: 'ref_consistency', name: '参考图一致性', type: 'score', range: [1, 5], description: '主体特征与参考图保持程度' },
        { key: 'safe_check', name: '合规安全', type: 'boolean', description: '是否包含违规有害内容' },
      ],
      hasEvidenceChain: true,
      hasArtifactOutput: true,
    },
    executionConfig: {
      defaultJudgeModel: 'google/gemini-2.5-flash',
      supportedModels: ['google/gemini-2.5-flash', 'openai/gpt-5', 'anthropic/claude-sonnet-4.5', 'qwen/qwen-2.5-vl-72b'],
      protocol: 'vlm_inspector',
      timeoutSec: 45,
      samplePipeline: ['图片加载与格式校验', 'VLM 视觉特征提取', '提示词实体拆解与细粒度对齐检测', '评分 Prompt 构建与裁判调用', '结构化证据与分数提取'],
    },
    supportedDimensions: [
      {
        key: 't2i.alignment',
        name: '文图对齐与元素遵从',
        defaultScoreType: 'scale_5',
        description: '评估生成的图像是否完整体现提示词中描述的主体、动作、修饰词及空间关系',
        suggestedPrompt: '请扮演专业视觉评测员。仔细比对用户 Prompt 与生成的图片：\n1. 检查 Prompt 中的核心实体是否存在\n2. 检查属性修饰（颜色、数量、材质）是否准确\n3. 检查空间关系（如左边、背景、手持）是否符合描述\n给出 1~5 分评分并输出详细分析理由。',
        defaultRubric: '5分: 完美对齐所有实体及细节修饰；4分: 核心实体完整，存在极微小次要修饰偏差；3分: 主体存在但存在明显修饰错误；2分: 严重缺少核心实体；1分: 完全无关。',
        requiredInputs: ['prompt', 'generated_image'],
      },
      {
        key: 't2i.aesthetic',
        name: '画质与视觉美感',
        defaultScoreType: 'scale_5',
        description: '评估图像清晰度、构图、光影表现力，以及是否存在肢体畸变、伪影或结构崩塌',
        suggestedPrompt: '请检验该图片的视觉质量：重点观察人体肢体（如手指、五官）、光影连贯性、纹理清晰度及有无明显伪影噪点。',
        defaultRubric: '5分: 超高清无瑕疵，构图优美光影自然；4分: 画质清晰，仅放大后有轻微小伪影；3分: 存在局部轻微变形（如手部微瑕）；2分: 严重畸变或模糊；1分: 结构完全崩塌。',
        requiredInputs: ['generated_image'],
      },
      {
        key: 't2i.identity_consistency',
        name: '角色/参考图一致性',
        defaultScoreType: 'scale_5',
        description: '在提供参考图场景下，比对生成图与参考图的角色人脸五官、发型、服装或关键资产的一致度',
        suggestedPrompt: '请对比参考图（Reference Image）与生成图（Generated Image）中的关键主体，评判角色 ID 与核心特征的保留程度。',
        defaultRubric: '5分: 角色特征完全一致；4分: 识别为同一角色但存在微小发型或光影变化；3分: 相似度一般；2分: 明显不是同一主体；1分: 完全无关联。',
        requiredInputs: ['reference_image', 'generated_image'],
      },
    ],
  },
  {
    id: 'cap_i2v',
    code: 'eval.i2v.temporal',
    name: '图生视频评价 (Image-to-Video)',
    category: 'multimodal_gen',
    version: 'v1.4.0',
    author: '视频智能组 · 赵星',
    updatedAt: '2026-11-15',
    intro: '图生视频与文生视频时空连续性评测能力，涵盖首帧保真度、动态运动合理性、镜头运镜符合度及时间序列无闪烁度。',
    scenario: '视频大模型预训练/微调回归、短视频生成 Agent 自动化评测、运镜控制能力验收。',
    tags: ['多模态', '图生视频', '时序评测', '动态连贯性'],
    inputSchema: [
      { name: 'first_frame', label: '首帧起始图 (First Frame Image)', type: 'image', required: true, description: '作为视频起点的关键帧图片', defaultMapping: 'start_frame_url', placeholder: 'https://...' },
      { name: 'video_clip', label: '生成视频 (Generated Video URL/Path)', type: 'video', required: true, description: '生成的视频文件 URL (mp4/webm)', defaultMapping: 'agent_reply_video', placeholder: 'https://...' },
      { name: 'motion_prompt', label: '运镜与动作要求 (Motion Prompt)', type: 'text', required: false, description: '对镜头运动（推拉摇移）和主体动态的文字要求', defaultMapping: 'user_motion_query', placeholder: 'e.g. Camera slowly zooms in, person turns head and smiles gently' },
      { name: 'target_duration', label: '目标时长(秒)', type: 'number', required: false, description: '期望的视频生成秒数', defaultMapping: 'target_duration_sec', placeholder: '4.0' },
    ],
    outputSchema: {
      metrics: [
        { key: 'first_frame_fidelity', name: '首帧保真度', type: 'score', range: [1, 5], description: '视频开头与给定首帧图片的像素/特征贴合度' },
        { key: 'motion_naturalness', name: '动作流畅与物理规律', type: 'score', range: [1, 5], description: '运动幅度、加速度平滑性与物理常识' },
        { key: 'camera_control', name: '运镜指令符合度', type: 'score', range: [1, 5], description: '推拉摇移旋转等镜头控制执行准确率' },
        { key: 'temporal_consistency', name: '时序连贯与无闪烁', type: 'score', range: [1, 5], description: '主体形态在时间轴上的稳定程度' },
      ],
      hasEvidenceChain: true,
      hasArtifactOutput: true,
    },
    executionConfig: {
      defaultJudgeModel: 'google/gemini-2.5-flash',
      supportedModels: ['google/gemini-2.5-flash', 'openai/gpt-5', 'anthropic/claude-sonnet-4.5'],
      protocol: 'multi_modal_api',
      timeoutSec: 90,
      samplePipeline: ['视频抽帧 (1fps / 4fps)', '首帧与起始帧 SSIM/CLIP 距离比对', '光流运动场计算与物理平滑性分析', '多帧序列交由多模态裁判评估运镜与闪烁', '汇总时空评测报告与分值'],
    },
    supportedDimensions: [
      {
        key: 'i2v.first_frame',
        name: '首帧启动保真度',
        defaultScoreType: 'scale_5',
        description: '视频起始画面与输入的第一帧图片在构图、颜色、主体细节上的忠实还原度',
        suggestedPrompt: '比对首帧图（First Frame）与视频的前 0.5 秒画面，评估视频是否平滑承接首帧且未发生瞬间形变突变。',
        defaultRubric: '5分: 完美无缝衔接首帧；4分: 存在极轻微亮度色彩抖动但主体不变；3分: 发生轻微主体位移；2分: 首帧突变失真；1分: 与首帧完全不同。',
        requiredInputs: ['first_frame', 'video_clip'],
      },
      {
        key: 'i2v.motion_quality',
        name: '动作流畅度与时序连续性',
        defaultScoreType: 'scale_5',
        description: '评估整段视频中主体的运动是否自然、是否存在时序闪烁（Flickering）、形体异变或物理违背',
        suggestedPrompt: '观察整段视频的动态表现，检查物体在移动过程中是否发生肢体融化、多肢、画面撕裂闪烁或违背重力等反常识物理现象。',
        defaultRubric: '5分: 极度丝滑自然，完全符合真实物理；4分: 动作自然，存在极轻微边缘闪烁；3分: 存在中等程度伪影或卡顿；2分: 严重形体融化畸变；1分: 无法辨识的混乱画面。',
        requiredInputs: ['video_clip'],
      },
      {
        key: 'i2v.camera_panning',
        name: '运镜与指令遵从',
        defaultScoreType: 'scale_5',
        description: '检验视频画面的镜头推拉摇移（Pan/Tilt/Zoom）是否符合 Motion Prompt 中的指令约定',
        suggestedPrompt: '根据输入的运镜描述（Motion Prompt），检查视频中的相机视角变化方向、运动节奏与主体焦点是否完全达标。',
        defaultRubric: '5分: 精确执行指定运镜轨迹；4分: 运镜方向正确但幅度略有偏差；3分: 运镜动作微弱或不明确；2分: 运镜方向完全相反；1分: 完全静止或剧烈抖动。',
        requiredInputs: ['motion_prompt', 'video_clip'],
      },
    ],
  },
]

// 扩展后的评分器评分规则类型
export type ScorerRubricType = 'binary' | 'scale_5' | 'scale_100' | 'custom_options'

export type RubricOption = {
  key: string
  label: string
  score: number
  tone: 'pass' | 'fail' | 'na' | 'warn'
  description?: string
}

export type ScorerCapabilityBinding = {
  capabilityId: string
  capabilityCode: string
  capabilityVersion: string
  selectedDimensions: string[] // 选择绑定的能力维度 key
  fieldMappings: Record<string, string> // capability input name -> dataset/dict field name
  rubrics: Record<string, {
    scoreType: ScorerRubricType
    customOptions?: RubricOption[]
    threshold: number
    weight: number
    promptInstruction?: string
    criteriaText?: string
  }>
}

export function useCapabilityRegistry() {
  const [caps, setCaps] = useShared<RegisteredCapability[]>('capability-registry', seedCapabilities)

  const registerCapability = useCallback(
    (cap: RegisteredCapability) => {
      setCaps((prev) => {
        const idx = prev.findIndex((c) => c.id === cap.id || c.code === cap.code)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = cap
          return next
        }
        return [...prev, cap]
      })
    },
    [setCaps],
  )

  const deleteCapability = useCallback(
    (id: string) => {
      setCaps((prev) => prev.filter((c) => c.id !== id))
    },
    [setCaps],
  )

  return {
    capabilities: caps,
    findCapability: (idOrCode: string) => caps.find((c) => c.id === idOrCode || c.code === idOrCode),
    registerCapability,
    deleteCapability,
  }
}
