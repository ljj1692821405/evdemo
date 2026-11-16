import { PageHeader, Tag, Mono } from '@/components/eval/primitives'
import { FieldDictView } from '@/components/eval/field-dict-view'
import { PreprocessPipeline } from '@/components/eval/preprocess-pipeline'
import { fieldDictVersion } from '@/lib/mock-data'

export const metadata = { title: '字段字典 · 评测平台' }

export default function FieldDictPage() {
  return (
    <div>
      <PageHeader
        index={2}
        title="字段字典"
        back="/datasets"
        actions={<Tag tone="primary"><Mono>{fieldDictVersion}</Mono></Tag>}
      />
      <div className="px-6 pt-6">
        <PreprocessPipeline />
      </div>
      <FieldDictView />
    </div>
  )
}
