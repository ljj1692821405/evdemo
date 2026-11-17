import type { FieldEntry } from './mock-data'

export type JudgeTool = { name: string; purpose: string }
export type PromptSectionKey = 'role' | 'background' | 'tools' | 'vars' | 'rules' | 'output'
export type PromptSection = { key: PromptSectionKey; title: string; body: string }

export function judgeSections({
  agentBackground,
  extraBackground,
  template,
  fields,
  tools,
}: {
  agentBackground: string
  extraBackground: string
  template: string
  fields: FieldEntry[]
  tools: JudgeTool[]
}): PromptSection[] {
  const sections: PromptSection[] = [{ key: 'role', title: '角色', body: '你是评测裁判，根据以下信息判断 Agent 表现。' }]

  const background = [agentBackground, extraBackground].map((s) => s.trim()).filter(Boolean).join('\n\n')
  if (background) sections.push({ key: 'background', title: '业务背景', body: background })

  if (tools.length > 0 && fields.some((f) => f.context?.kind === 'tools')) {
    sections.push({ key: 'tools', title: '工具清单', body: tools.map((t) => `- ${t.name}：${t.purpose}`).join('\n') })
  }

  if (fields.length > 0) {
    const lines = fields.map((f) => {
      const values = f.context?.kind === 'enum' ? f.context.values.filter((v) => v.value) : []
      const enumText = values.length ? `（${values.map((v) => `${v.value}=${v.meaning}`).join('；')}）` : ''
      return `- ${f.logicalName}：${f.description}${enumText}`
    })
    sections.push({ key: 'vars', title: '变量说明', body: lines.join('\n') })
  }

  sections.push({ key: 'rules', title: '判定规则', body: template })
  sections.push({ key: 'output', title: '输出格式', body: '逐个维度输出结论及理由。' })
  return sections
}
