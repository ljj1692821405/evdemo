'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'

export type CanvasWidgetType =
  | 'text_card' // 文本展示卡 (Prompt, Query, Reply)
  | 'image_card' // 单图展示卡 (生成图片)
  | 'image_compare' // 双图对比卡 (参考图 vs 生成图)
  | 'video_player' // 视频播放器 (生成视频)
  | 'video_first_frame' // 首帧与视频对比
  | 'diff_viewer' // 文本/代码 Diff 对比
  | 'meta_kv' // 元数据与参数键值对
  | 'score_form' // 人工评分表单 (绑定 Rubric)
  | 'tag_selector' // 缺陷/标签多选控件
  | 'note_input' // 人工核验备注框

export type CanvasWidget = {
  id: string
  type: CanvasWidgetType
  title: string
  gridSpan: 1 | 2 | 3 // 占几列 (1~3)
  fieldBinding?: string // 绑定的字典字段 (如 generated_image, user_query)
  secondaryFieldBinding?: string // 对比卡所需的第二个字段 (如 reference_image)
  boundDimensions?: string[] // 评分表单绑定的评测维度 keys
  config?: {
    height?: number
    showMeta?: boolean
    placeholder?: string
    aspectRatio?: 'square' | 'video' | 'auto'
  }
}

export type AnnotationTemplate = {
  id: string
  name: string
  version: string
  category: 'multimodal' | 'nlp_agent' | 'custom'
  status: 'draft' | 'published'
  updatedAt: string
  author: string
  description: string
  layout: 'split_2' | 'grid_3' | 'stacked'
  widgets: CanvasWidget[]
  isDefault?: boolean
}

export const seedTemplates: AnnotationTemplate[] = [
  {
    id: 'tpl_t2i_standard',
    name: '文生图多模态评测模板',
    version: 'v1.2',
    category: 'multimodal',
    status: 'published',
    updatedAt: '2026-11-18',
    author: 'PM · 李林',
    description: '标准文生图人工核对界面，包含提示词与参考图对比、生成图片高精度预览及多维打分表单',
    layout: 'split_2',
    isDefault: true,
    widgets: [
      {
        id: 'w_prompt',
        type: 'text_card',
        title: '用户输入提示词 (Prompt)',
        gridSpan: 1,
        fieldBinding: 'user_query',
        config: { showMeta: true },
      },
      {
        id: 'w_compare',
        type: 'image_compare',
        title: '参考角色图 vs 目标生成图',
        gridSpan: 2,
        fieldBinding: 'agent_reply_image',
        secondaryFieldBinding: 'ref_image_url',
        config: { aspectRatio: 'square' },
      },
      {
        id: 'w_scorer',
        type: 'score_form',
        title: '人工评分与多维判定',
        gridSpan: 1,
        boundDimensions: ['t2i.alignment', 't2i.aesthetic', 't2i.identity_consistency'],
      },
      {
        id: 'w_note',
        type: 'note_input',
        title: '人工核查批注与归因',
        gridSpan: 1,
        config: { placeholder: '输入缺陷理由或特殊 Case 标记...' },
      },
    ],
  },
  {
    id: 'tpl_nlp_agent',
    name: 'Agent 意图与澄清审计模板',
    version: 'v1.0',
    category: 'nlp_agent',
    status: 'published',
    updatedAt: '2026-11-17',
    author: 'PM · 王明',
    description: '通用文本类 Agent 审计模板，包含用户诉求、Agent 交互轨迹、下发澄清卡与二元判分',
    layout: 'grid_3',
    widgets: [
      {
        id: 'w_nlp_query',
        type: 'text_card',
        title: '用户诉求 (User Query)',
        gridSpan: 1,
        fieldBinding: 'user_query',
      },
      {
        id: 'w_nlp_reply',
        type: 'text_card',
        title: 'Agent 最终回复 (Reply)',
        gridSpan: 1,
        fieldBinding: 'agent_reply',
      },
      {
        id: 'w_nlp_cards',
        type: 'text_card',
        title: '下发澄清卡/确认卡',
        gridSpan: 1,
        fieldBinding: 'interactive_cards',
      },
      {
        id: 'w_nlp_diff',
        type: 'diff_viewer',
        title: '工作区修改对比 (Diff)',
        gridSpan: 2,
        fieldBinding: 'scoped_modified_diff',
      },
      {
        id: 'w_nlp_score',
        type: 'score_form',
        title: '意图路线与合规评分',
        gridSpan: 1,
        boundDimensions: ['text.intent', 'text.clarification', 'text.safety'],
      },
    ],
  },
]

export function useAnnotationTemplateStore() {
  const [templates, setTemplates] = useShared<AnnotationTemplate[]>('annotation-templates-v2', seedTemplates)

  const activeTemplate = templates.find((t) => t.isDefault) || templates[0]

  const createTemplate = useCallback(
    (input: Omit<AnnotationTemplate, 'id' | 'updatedAt'>) => {
      const created: AnnotationTemplate = {
        ...input,
        id: `tpl_${Date.now()}`,
        updatedAt: '刚刚',
      }
      setTemplates((prev) => [created, ...prev])
      return created
    },
    [setTemplates],
  )

  const updateTemplate = useCallback(
    (id: string, patch: Partial<AnnotationTemplate>) => {
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: '刚刚' } : t)),
      )
    },
    [setTemplates],
  )

  const deleteTemplate = useCallback(
    (id: string) => {
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    },
    [setTemplates],
  )

  const setDefaultTemplate = useCallback(
    (id: string) => {
      setTemplates((prev) =>
        prev.map((t) => ({ ...t, isDefault: t.id === id })),
      )
    },
    [setTemplates],
  )

  return {
    templates,
    activeTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
  }
}
