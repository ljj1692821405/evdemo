import { PageHeader, Tag, Mono } from '@/components/eval/primitives'
import { FieldDictView } from '@/components/eval/field-dict-view'
import { fieldDictVersion } from '@/lib/mock-data'

export const metadata = { title: '字段字典 · 评测平台' }

export default function FieldDictPage() {
  return (
    <div>
      <PageHeader
        index={2}
        title="字段字典"
        back="/datasets"
        meta="T2 · 逻辑名 → L-sim 物理路径"
        actions={<Tag tone="primary"><Mono>{fieldDictVersion}</Mono></Tag>}
      />
      <FieldDictView />
    </div>
  )
}
