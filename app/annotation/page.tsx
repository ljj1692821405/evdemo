import { PageHeader } from '@/components/eval/primitives'
import { AnnotationWorkspaceView } from '@/components/eval/annotation-workspace-view'

export const metadata = { title: '标注工作台 · 评测平台' }

export default function AnnotationPage() {
  return (
    <div>
      <PageHeader
        index={10}
        title="标注工作台"
        meta="多模态人工评测与标注 · 文生图 / 图生视频动态多模态校验与黄金集对齐"
      />
      <AnnotationWorkspaceView />
    </div>
  )
}
