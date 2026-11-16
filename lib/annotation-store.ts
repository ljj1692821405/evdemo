'use client'

import { useCallback } from 'react'
import { useShared } from './field-dict-store'
import { type Verdict } from './mock-data'

export type AnnotationScoreValue = {
  score: number | string | boolean
  verdict: Verdict
  note?: string
}

export type AnnotationItem = {
  id: string
  caseId: string
  turnNo: number
  taskType: 't2i' | 'i2v' | 'general'
  taskName: string
  createdAt: string
  status: 'pending' | 'annotated' | 'conflict'
  inputs: {
    prompt?: string
    negative_prompt?: string
    generated_image?: string
    reference_image?: string
    first_frame?: string
    video_clip?: string
    motion_prompt?: string
    target_duration?: number
    [key: string]: unknown
  }
  judgeResults: Record<string, {
    score: number | string
    verdict: Verdict
    reason: string
    model: string
  }>
  humanScores: Record<string, AnnotationScoreValue>
  reviewNote?: string
}

export const seedAnnotations: AnnotationItem[] = [
  {
    id: 'anno_t2i_001',
    caseId: 'case_t2i_101',
    turnNo: 1,
    taskType: 't2i',
    taskName: '文生图评测 · 赛博风格角色生成',
    createdAt: '2026-11-16 10:20',
    status: 'pending',
    inputs: {
      prompt: 'A cyberpunk female hacker with neon blue short hair, wearing glowing cybernetic goggles and a dark leather jacket, standing in rain-soaked futuristic Tokyo street at night, cinematic lighting, 8k, detailed reflections.',
      negative_prompt: 'blurry, distorted face, extra limbs, low resolution, bad anatomy, deformed fingers',
      generated_image: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=900&auto=format&fit=crop&q=80',
      reference_image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
    },
    judgeResults: {
      't2i.alignment': { score: 5, verdict: 'pass', reason: '成功生成带有霓虹蓝短发、发光眼镜与皮夹克特征的赛博女性，背景夜雨街道与反光完美符合 Prompt。', model: 'google/gemini-2.5-flash' },
      't2i.aesthetic': { score: 4, verdict: 'pass', reason: '画面光影通透，雨水反光层次细腻，五官结构清晰无变形，仅背景极远景招牌有轻微噪点。', model: 'google/gemini-2.5-flash' },
      't2i.identity_consistency': { score: 4, verdict: 'pass', reason: '与参考图相比，保留了相似的脸型五官比例与眼神神态，发色与装扮做了赛博化改造。', model: 'google/gemini-2.5-flash' },
    },
    humanScores: {},
  },
  {
    id: 'anno_t2i_002',
    caseId: 'case_t2i_102',
    turnNo: 1,
    taskType: 't2i',
    taskName: '文生图评测 · 商业产品静物摄影',
    createdAt: '2026-11-16 11:05',
    status: 'annotated',
    inputs: {
      prompt: 'Luxury matte black perfume bottle with gold metallic cap, splashing amber liquid droplets around it, dark minimalist studio background with soft rim lighting.',
      negative_prompt: 'ugly, lowres, text, watermark, bad lighting',
      generated_image: 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=900&auto=format&fit=crop&q=80',
    },
    judgeResults: {
      't2i.alignment': { score: 5, verdict: 'pass', reason: '完美呈现磨砂黑香水瓶与金色金属盖，琥珀色飞溅水珠生动且光影考究。', model: 'google/gemini-2.5-flash' },
      't2i.aesthetic': { score: 5, verdict: 'pass', reason: '商业级高精度打光与边缘高光，无任何杂质噪点与结构伪影。', model: 'google/gemini-2.5-flash' },
    },
    humanScores: {
      't2i.alignment': { score: 5, verdict: 'pass', note: '实体与质感完美符合预期' },
      't2i.aesthetic': { score: 5, verdict: 'pass', note: '光影非常高级' },
    },
    reviewNote: '高分标杆样例',
  },
  {
    id: 'anno_i2v_001',
    caseId: 'case_i2v_201',
    turnNo: 1,
    taskType: 'i2v',
    taskName: '图生视频评测 · 自然风景云海流动与镜头推进',
    createdAt: '2026-11-16 14:10',
    status: 'pending',
    inputs: {
      first_frame: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=80',
      video_clip: 'https://assets.mixkit.co/videos/preview/mixkit-clouds-and-blue-sky-2408-large.mp4',
      motion_prompt: 'Slow drone forward push, majestic mountain peaks surrounded by flowing misty clouds under golden sunset light, cinematic smooth movement.',
      target_duration: 5.0,
    },
    judgeResults: {
      'i2v.first_frame': { score: 5, verdict: 'pass', reason: '前 0.5 秒完全继承首帧山峰轮廓、色彩饱和度与光影方向，过渡极其平顺。', model: 'google/gemini-2.5-flash' },
      'i2v.motion_quality': { score: 4, verdict: 'pass', reason: '云雾流动方向符合空气动力学规律，山体稳固无晃动与融化伪影。', model: 'google/gemini-2.5-flash' },
      'i2v.camera_panning': { score: 5, verdict: 'pass', reason: '平稳向前推进镜头，视角推近速度均匀，充分体现空间景深。', model: 'google/gemini-2.5-flash' },
    },
    humanScores: {},
  },
  {
    id: 'anno_i2v_002',
    caseId: 'case_i2v_202',
    turnNo: 1,
    taskType: 'i2v',
    taskName: '图生视频评测 · 人物回眸微动作',
    createdAt: '2026-11-16 15:30',
    status: 'pending',
    inputs: {
      first_frame: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=900&auto=format&fit=crop&q=80',
      video_clip: 'https://assets.mixkit.co/videos/preview/mixkit-woman-smiling-at-the-camera-386-large.mp4',
      motion_prompt: 'The woman slowly turns her head to face camera, soft gentle smile, wind blowing hair slightly, shallow depth of field.',
      target_duration: 4.0,
    },
    judgeResults: {
      'i2v.first_frame': { score: 4, verdict: 'pass', reason: '初始画面高度还原，发丝边缘有微小压缩抖动。', model: 'google/gemini-2.5-flash' },
      'i2v.motion_quality': { score: 3, verdict: 'na', reason: '转头过程中发丝遮挡面部时眼角有瞬时轻微形变。', model: 'google/gemini-2.5-flash' },
      'i2v.camera_panning': { score: 4, verdict: 'pass', reason: '镜头保持主体聚焦，微动运镜符合要求。', model: 'google/gemini-2.5-flash' },
    },
    humanScores: {},
  },
]

export function useAnnotationStore() {
  const [items, setItems] = useShared<AnnotationItem[]>('annotation-items', seedAnnotations)

  const updateItemScore = useCallback(
    (id: string, dimKey: string, scoreVal: AnnotationScoreValue) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item
          const nextScores = { ...item.humanScores, [dimKey]: scoreVal }
          return {
            ...item,
            humanScores: nextScores,
            status: Object.keys(nextScores).length > 0 ? 'annotated' : item.status,
          }
        }),
      )
    },
    [setItems],
  )

  const updateItemNote = useCallback(
    (id: string, note: string) => {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, reviewNote: note } : item)))
    },
    [setItems],
  )

  return {
    items,
    updateItemScore,
    updateItemNote,
  }
}
