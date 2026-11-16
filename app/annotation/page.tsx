import { PageHeader } from '@/components/eval/primitives'
import { AnnotationWorkspaceView } from '@/components/eval/annotation-workspace-view'

export const metadata = { title: '标注工作台 · 评测平台' }

export default function AnnotationPage() {
  return (
    <div>
      <PageHeader
        index={8}
        title="标注工作台"
        back="/review"
      />
      <AnnotationWorkspaceView />
    </div>
  )
}
