import { PageHeader } from '@/components/eval/primitives'
import { FieldDictVersionTag, FieldDictView } from '@/components/eval/field-dict-view'
import { PreprocessPipeline } from '@/components/eval/preprocess-pipeline'

export const metadata = { title: '字段字典 · 评测平台' }

export default function FieldDictPage() {
  return (
    <div>
      <PageHeader index={3} title="字段字典" actions={<FieldDictVersionTag />} />
      <FieldDictView />
      <div className="px-6 pb-6">
        <PreprocessPipeline />
      </div>
    </div>
  )
}
