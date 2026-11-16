import { PageHeader } from '@/components/eval/primitives'
import { FieldDictVersionTag, FieldDictView } from '@/components/eval/field-dict-view'
import { PreprocessPipeline } from '@/components/eval/preprocess-pipeline'

export const metadata = { title: '字段字典 · 评测平台' }

export default function FieldDictPage() {
  return (
    <div>
      <PageHeader index={2} title="字段字典" back="/datasets" actions={<FieldDictVersionTag />} />
      <div className="px-6 pt-6">
        <PreprocessPipeline />
      </div>
      <FieldDictView />
    </div>
  )
}
