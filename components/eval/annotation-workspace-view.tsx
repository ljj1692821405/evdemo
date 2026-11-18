'use client'

import { useState } from 'react'
import {
  LayoutTemplate,
  Plus,
  Trash2,
  Eye,
  Check,
  Sparkles,
  FileText,
  ImageIcon,
  Video,
  SplitSquareVertical,
  Columns3,
  Rows3,
  Sliders,
  Database,
  ArrowRight,
  Gavel,
  MoveUp,
  MoveDown,
  Layers,
  Code2,
  GripVertical,
  CheckCircle2,
  Search,
  Minus,
  X as XIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn } from '@/components/eval/primitives'
import {
  useAnnotationTemplateStore,
  type AnnotationTemplate,
  type CanvasWidget,
  type CanvasWidgetType,
} from '@/lib/annotation-template-store'
import { useFieldDict } from '@/lib/field-dict-store'
import { dimensions as defaultDimensions, type Dimension } from '@/lib/mock-data'
import { seedAnnotations } from '@/lib/annotation-store'

// 可拖入的组件元数据
const widgetPalette: {
  type: CanvasWidgetType
  label: string
  icon: React.ElementType
  category: 'media' | 'score' | 'data'
  defaultTitle: string
}[] = [
  { type: 'text_card', label: '文本展示卡', icon: FileText, category: 'media', defaultTitle: '文本内容 (Text Card)' },
  { type: 'image_card', label: '单图展示卡', icon: ImageIcon, category: 'media', defaultTitle: '目标图片 (Image Card)' },
  { type: 'image_compare', label: '双图对比卡', icon: SplitSquareVertical, category: 'media', defaultTitle: '参考图 vs 目标图 (Image Compare)' },
  { type: 'video_player', label: '视频播放器', icon: Video, category: 'media', defaultTitle: '生成视频 (Video Player)' },
  { type: 'diff_viewer', label: 'Diff 比对区', icon: Code2, category: 'media', defaultTitle: '代码/文本差异 (Diff View)' },
  { type: 'score_form', label: 'Rubric 打分表单', icon: Gavel, category: 'score', defaultTitle: '维度评分表单 (Score Form)' },
  { type: 'tag_selector', label: '缺陷标签选择器', icon: Layers, category: 'score', defaultTitle: '缺陷归因标签 (Tags)' },
  { type: 'note_input', label: '人工批注备注框', icon: Sliders, category: 'score', defaultTitle: '审核批注 (Review Note)' },
  { type: 'meta_kv', label: '元数据键值表', icon: Database, category: 'data', defaultTitle: '生成参数 (Meta KV)' },
]

export function AnnotationWorkspaceView() {
  const { templates, activeTemplate, createTemplate, updateTemplate, deleteTemplate, setDefaultTemplate } =
    useAnnotationTemplateStore()
  const dict = useFieldDict()
  const dimensions = defaultDimensions

  const [currentTplId, setCurrentTplId] = useState<string>(activeTemplate?.id || templates[0]?.id || '')
  const currentTemplate = templates.find((t) => t.id === currentTplId) || templates[0]

  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(
    currentTemplate?.widgets[0]?.id || null,
  )
  const [previewMode, setPreviewMode] = useState<boolean>(false)

  // 拖拽状态
  const [draggingWidgetIdx, setDraggingWidgetIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [isDragOverCanvas, setIsDragOverCanvas] = useState<boolean>(false)

  const selectedWidget = currentTemplate?.widgets.find((w) => w.id === selectedWidgetId)

  // 模拟真实样例用于设计器预览
  const sampleCase = seedAnnotations[0]

  const handleAddWidget = (paletteItem: (typeof widgetPalette)[0]) => {
    if (!currentTemplate) return
    const newWidget: CanvasWidget = {
      id: `w_${Date.now()}`,
      type: paletteItem.type,
      title: paletteItem.defaultTitle,
      gridSpan: paletteItem.type === 'image_compare' || paletteItem.type === 'diff_viewer' ? 2 : 1,
      fieldBinding:
        paletteItem.type === 'image_card'
          ? 'agent_reply_image'
          : undefined,
      fieldBindings:
        paletteItem.type === 'text_card'
          ? ['user_query']
          : undefined,
      boundDimensions: paletteItem.type === 'score_form' ? dimensions.slice(0, 2).map((d) => d.key) : undefined,
    }
    const updated = [...currentTemplate.widgets, newWidget]
    updateTemplate(currentTemplate.id, { widgets: updated })
    setSelectedWidgetId(newWidget.id)
  }

  const handleDeleteWidget = (wId: string) => {
    if (!currentTemplate) return
    const updated = currentTemplate.widgets.filter((w) => w.id !== wId)
    updateTemplate(currentTemplate.id, { widgets: updated })
    if (selectedWidgetId === wId) {
      setSelectedWidgetId(updated[0]?.id || null)
    }
  }

  const handleReorderWidget = (fromIdx: number, toIdx: number) => {
    if (!currentTemplate || fromIdx === toIdx) return
    const nextWidgets = [...currentTemplate.widgets]
    const [moved] = nextWidgets.splice(fromIdx, 1)
    nextWidgets.splice(toIdx, 0, moved)
    updateTemplate(currentTemplate.id, { widgets: nextWidgets })
    setDraggingWidgetIdx(null)
    setDragOverIdx(null)
  }

  const handleDropFromPalette = (widgetType: CanvasWidgetType) => {
    const paletteItem = widgetPalette.find((w) => w.type === widgetType)
    if (paletteItem) {
      handleAddWidget(paletteItem)
    }
    setIsDragOverCanvas(false)
  }

  const handleUpdateWidget = (patch: Partial<CanvasWidget>) => {
    if (!currentTemplate || !selectedWidgetId) return
    const updated = currentTemplate.widgets.map((w) => (w.id === selectedWidgetId ? { ...w, ...patch } : w))
    updateTemplate(currentTemplate.id, { widgets: updated })
  }

  const handleCreateNewTemplate = () => {
    const created = createTemplate({
      name: `新建标注模板 v${templates.length + 1}.0`,
      version: 'v1.0',
      category: 'multimodal',
      status: 'draft',
      author: 'PM · 当前用户',
      description: '自定义标注界面排版与打分配置',
      layout: 'split_2',
      widgets: [
        {
          id: `w_init_1`,
          type: 'text_card',
          title: '输入提示词',
          gridSpan: 1,
          fieldBinding: 'user_query',
        },
        {
          id: `w_init_2`,
          type: 'image_card',
          title: '生成产出物',
          gridSpan: 1,
          fieldBinding: 'agent_reply_image',
        },
        {
          id: `w_init_3`,
          type: 'score_form',
          title: '人工复核打分',
          gridSpan: 1,
          boundDimensions: [dimensions[0]?.key || 'default.score'],
        },
      ],
    })
    setCurrentTplId(created.id)
    setSelectedWidgetId(created.widgets[0]?.id || null)
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部通栏：模板切换与发布状态 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LayoutTemplate className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">标注界面设计器 (低代码画布)</h2>
              <Tag tone="primary">{templates.length} 套模板</Tag>
              {currentTemplate?.isDefault && <Tag tone="pass">默认执行模板</Tag>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 模板下拉选择 */}
          <select
            value={currentTemplate?.id}
            onChange={(e) => {
              setCurrentTplId(e.target.value)
              const tpl = templates.find((t) => t.id === e.target.value)
              setSelectedWidgetId(tpl?.widgets[0]?.id || null)
            }}
            className="h-8 rounded-md border border-input bg-card px-2.5 font-medium text-xs"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.version}) {t.isDefault ? '★ 默认' : ''}
              </option>
            ))}
          </select>

          <Btn size="sm" variant="outline" onClick={handleCreateNewTemplate}>
            <Plus className="size-3.5" />
            新建模板
          </Btn>

          <Btn
            size="sm"
            variant={previewMode ? 'primary' : 'outline'}
            onClick={() => setPreviewMode(!previewMode)}
          >
            <Eye className="size-3.5" />
            {previewMode ? '返回设计' : '真实数据预览'}
          </Btn>

          {!currentTemplate?.isDefault && (
            <Btn size="sm" variant="outline" onClick={() => setDefaultTemplate(currentTemplate.id)}>
              <Check className="size-3.5" />
              设为默认
            </Btn>
          )}

          <a href="/review">
            <Btn size="sm" variant="primary">
              前往核对看板执行
              <ArrowRight className="size-3" />
            </Btn>
          </a>
        </div>
      </div>

      {/* 主三栏设计器布局 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr_300px]">
        {/* 左栏：组件与字段库 (Palette) */}
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5 text-xs">
          <div className="flex items-center justify-between border-b pb-2 font-semibold text-foreground">
            <span>组件与控件库</span>
            <Tag tone="neutral">{widgetPalette.length} 种</Tag>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="text-[11px] font-medium text-muted-foreground">媒体与展示组件</span>
              <div className="mt-1.5 flex flex-col gap-1">
                {widgetPalette
                  .filter((w) => w.category === 'media')
                  .map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.type}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/widget-type', item.type)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={() => handleAddWidget(item)}
                        className="flex items-center justify-between rounded-lg border border-input bg-card p-2 text-left hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-3.5 text-primary" />
                          {item.label}
                        </span>
                        <Plus className="size-3 text-muted-foreground" />
                      </button>
                    )
                  })}
              </div>
            </div>

            <div>
              <span className="text-[11px] font-medium text-muted-foreground">人工评分与批注控件</span>
              <div className="mt-1.5 flex flex-col gap-1">
                {widgetPalette
                  .filter((w) => w.category === 'score')
                  .map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.type}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/widget-type', item.type)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={() => handleAddWidget(item)}
                        className="flex items-center justify-between rounded-lg border border-input bg-card p-2 text-left hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-3.5 text-pass" />
                          {item.label}
                        </span>
                        <Plus className="size-3 text-muted-foreground" />
                      </button>
                    )
                  })}
              </div>
            </div>

            <div>
              <span className="text-[11px] font-medium text-muted-foreground">结构化数据字段</span>
              <div className="mt-1.5 flex flex-col gap-1">
                {widgetPalette
                  .filter((w) => w.category === 'data')
                  .map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.type}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/widget-type', item.type)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={() => handleAddWidget(item)}
                        className="flex items-center justify-between rounded-lg border border-input bg-card p-2 text-left hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-grab active:cursor-grabbing"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="size-3.5 text-warn" />
                          {item.label}
                        </span>
                        <Plus className="size-3 text-muted-foreground" />
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>

        {/* 中栏：可视化画布 (Canvas) */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (!isDragOverCanvas) setIsDragOverCanvas(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) {
              setIsDragOverCanvas(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            const wType = e.dataTransfer.getData('text/widget-type') as CanvasWidgetType
            if (wType) {
              handleDropFromPalette(wType)
            }
          }}
          className={cn(
            'flex flex-col gap-3 rounded-xl border p-4 min-h-[600px] transition-all',
            isDragOverCanvas ? 'bg-primary/5 border-primary/50 ring-2 ring-primary/20' : 'bg-muted/20 border-border',
          )}
        >
          {/* 画布顶部工具条 */}
          <div className="flex items-center justify-between border-b pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">画布布局：{currentTemplate?.name}</span>
              <Tag tone="primary">{currentTemplate?.widgets.length} 个控件</Tag>
              {!previewMode && <Tag tone="neutral">可拖拽重排 / 拖入组件</Tag>}
            </div>

            {/* 栅格切换 */}
            <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-xs">
              <button
                type="button"
                onClick={() => updateTemplate(currentTemplate.id, { layout: 'split_2' })}
                className={cn('px-2 py-0.5 rounded text-[11px] font-medium', currentTemplate?.layout === 'split_2' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
              >
                双栏
              </button>
              <button
                type="button"
                onClick={() => updateTemplate(currentTemplate.id, { layout: 'grid_3' })}
                className={cn('px-2 py-0.5 rounded text-[11px] font-medium', currentTemplate?.layout === 'grid_3' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
              >
                三栏
              </button>
              <button
                type="button"
                onClick={() => updateTemplate(currentTemplate.id, { layout: 'stacked' })}
                className={cn('px-2 py-0.5 rounded text-[11px] font-medium', currentTemplate?.layout === 'stacked' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
              >
                单列
              </button>
            </div>
          </div>

          {/* 画布网格容器 */}
          <div
            className={cn(
              'grid gap-3.5 flex-1',
              currentTemplate?.layout === 'grid_3'
                ? 'grid-cols-1 md:grid-cols-3'
                : currentTemplate?.layout === 'split_2'
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1',
            )}
          >
            {currentTemplate?.widgets.map((widget, idx) => {
              const isSelected = selectedWidgetId === widget.id && !previewMode
              const isDragging = draggingWidgetIdx === idx
              const isDragTarget = dragOverIdx === idx
              const colSpan =
                widget.gridSpan === 3
                  ? 'md:col-span-3'
                  : widget.gridSpan === 2
                    ? 'md:col-span-2'
                    : 'md:col-span-1'

              return (
                <div
                  key={widget.id}
                  draggable={!previewMode}
                  onDragStart={(e) => {
                    if (previewMode) return
                    setDraggingWidgetIdx(idx)
                    e.dataTransfer.setData('text/widget-idx', String(idx))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (previewMode || draggingWidgetIdx === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOverIdx !== idx) setDragOverIdx(idx)
                  }}
                  onDragLeave={() => {
                    if (dragOverIdx === idx) setDragOverIdx(null)
                  }}
                  onDrop={(e) => {
                    if (previewMode) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (draggingWidgetIdx !== null) {
                      handleReorderWidget(draggingWidgetIdx, idx)
                    }
                  }}
                  onDragEnd={() => {
                    setDraggingWidgetIdx(null)
                    setDragOverIdx(null)
                  }}
                  onClick={() => !previewMode && setSelectedWidgetId(widget.id)}
                  className={cn(
                    'group relative flex flex-col justify-between rounded-xl border bg-card p-3.5 transition-all text-xs cursor-pointer',
                    colSpan,
                    isDragging && 'opacity-40 scale-95 border-dashed border-primary',
                    isDragTarget && 'ring-2 ring-primary border-primary bg-primary/5',
                    isSelected && !isDragging
                      ? 'border-primary ring-2 ring-primary/20 shadow-md'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  {/* 控件头部 */}
                  <div className="flex items-center justify-between border-b pb-2 mb-2">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      {!previewMode && (
                        <GripVertical className="size-3.5 text-muted-foreground/60 cursor-grab active:cursor-grabbing hover:text-foreground" />
                      )}
                      <span className="size-1.5 rounded-full bg-primary" />
                      {widget.title}
                    </span>

                    {!previewMode && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteWidget(widget.id)
                          }}
                          className="p-1 hover:bg-fail-soft rounded text-fail"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 控件主体（设计态 vs 真实预览态） */}
                  <div className="flex-1 min-h-[100px] flex flex-col justify-center">
                    {/* 1. 文本展示卡 (支持多字段加减与分段展示) */}
                    {widget.type === 'text_card' && (() => {
                      const bindings = widget.fieldBindings?.length
                        ? widget.fieldBindings
                        : widget.fieldBinding
                          ? [widget.fieldBinding]
                          : ['user_query']

                      return (
                        <div className="flex flex-col gap-2">
                          {bindings.map((fName) => {
                            const dictEntry = dict.entries.find((e) => e.logicalName === fName)
                            const sampleVal = (sampleCase.inputs[fName] as string) || (fName === 'user_query' ? sampleCase.inputs.prompt : fName === 'agent_reply' ? 'Agent 交互执行输出示例内容...' : undefined)

                            return (
                              <div key={fName} className="group/item rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed transition-all hover:border-primary/40">
                                <div className="flex items-center justify-between border-b border-border/60 pb-1 mb-1.5 text-muted-foreground">
                                  <span className="flex items-center gap-1.5 font-bold text-foreground">
                                    <FileText className="size-3 text-primary" />
                                    {fName}
                                    {dictEntry?.description && (
                                      <span className="font-normal text-[10px] text-muted-foreground">({dictEntry.description})</span>
                                    )}
                                  </span>

                                  <div className="flex items-center gap-1">
                                    <Tag tone="primary" className="font-mono text-[9px]">{fName}</Tag>
                                    {!previewMode && bindings.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const next = bindings.filter((x) => x !== fName)
                                          handleUpdateWidget({ fieldBindings: next, fieldBinding: next[0] })
                                        }}
                                        className="size-4.5 flex items-center justify-center rounded text-muted-foreground hover:bg-fail-soft hover:text-fail"
                                      >
                                        <XIcon className="size-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="text-foreground whitespace-pre-wrap">
                                  {previewMode ? (
                                    sampleVal || <span className="text-muted-foreground italic">[该样例 {fName} 为空]</span>
                                  ) : (
                                    <span className="text-muted-foreground">运行时填充 `{`{{${fName}}}`}` 真实数据</span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* 2. 单图展示卡 */}
                    {widget.type === 'image_card' && (
                      <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 p-2 min-h-[160px] overflow-hidden">
                        {previewMode ? (
                          <img
                            src={sampleCase.inputs.generated_image}
                            alt="生成的图片"
                            className="max-h-48 rounded object-contain shadow-xs"
                          />
                        ) : (
                          <div className="text-center text-muted-foreground flex flex-col items-center gap-1">
                            <ImageIcon className="size-8 text-primary/40" />
                            <span>绑定图片字段：{widget.fieldBinding || 'agent_reply_image'}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3. 双图对比卡 */}
                    {widget.type === 'image_compare' && (
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-2 min-h-[160px]">
                        <div className="flex flex-col items-center justify-center border-r pr-2">
                          <span className="text-[10px] text-muted-foreground mb-1">参考源图 (Reference)</span>
                          {previewMode ? (
                            <img
                              src={sampleCase.inputs.reference_image}
                              alt="参考图"
                              className="max-h-36 rounded object-contain"
                            />
                          ) : (
                            <Tag tone="neutral">{widget.secondaryFieldBinding || 'ref_image_url'}</Tag>
                          )}
                        </div>
                        <div className="flex flex-col items-center justify-center pl-2">
                          <span className="text-[10px] text-muted-foreground mb-1">生成目标图 (Generated)</span>
                          {previewMode ? (
                            <img
                              src={sampleCase.inputs.generated_image}
                              alt="生成图"
                              className="max-h-36 rounded object-contain"
                            />
                          ) : (
                            <Tag tone="primary">{widget.fieldBinding || 'agent_reply_image'}</Tag>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 4. 视频播放器 */}
                    {widget.type === 'video_player' && (
                      <div className="flex flex-col items-center justify-center rounded-lg bg-muted/40 p-4 min-h-[140px] text-muted-foreground gap-1">
                        <Video className="size-8 text-primary/40" />
                        <span>绑定视频字段：{widget.fieldBinding || 'video_clip_url'}</span>
                      </div>
                    )}

                    {/* 5. Diff 比对区 */}
                    {widget.type === 'diff_viewer' && (
                      <div className="rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
                        <div className="text-fail">- 原始待修改指令或内容</div>
                        <div className="text-pass">+ Agent 实际改写后落盘代码与文本</div>
                      </div>
                    )}

                    {/* 6. Rubric 评分表单 */}
                    {widget.type === 'score_form' && (
                      <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-2.5">
                        <span className="text-[11px] font-semibold text-foreground">
                          已挂载评测维度 ({widget.boundDimensions?.length || 0})
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {widget.boundDimensions?.map((dKey) => (
                            <Tag key={dKey} tone="primary">
                              {dKey}
                            </Tag>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-muted-foreground">评分控件：</span>
                          <span className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                className="size-6 rounded border bg-card text-[11px] font-bold hover:bg-primary hover:text-white"
                              >
                                {s}
                              </button>
                            ))}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 7. 缺陷标签选择器 */}
                    {widget.type === 'tag_selector' && (
                      <div className="flex flex-wrap gap-1.5 p-1">
                        {['肢体形变', '图文不符', '文字乱码', '画风漂移', '时序闪烁'].map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-input bg-card px-2 py-1 text-[11px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 8. 备注输入框 */}
                    {widget.type === 'note_input' && (
                      <input
                        type="text"
                        disabled={!previewMode}
                        placeholder={widget.config?.placeholder || '输入核验意见...'}
                        className="h-8 w-full rounded border border-input bg-card px-2.5 text-xs text-foreground"
                      />
                    )}

                    {/* 9. 元数据表 */}
                    {widget.type === 'meta_kv' && (
                      <div className="grid grid-cols-2 gap-1 rounded bg-muted/40 p-2 font-mono text-[10px]">
                        <div>seed: 4289102</div>
                        <div>cfg_scale: 7.5</div>
                        <div>sampler: DPM++ 2M</div>
                        <div>steps: 30</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右栏：组件属性配置 (Inspector) */}
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5 text-xs">
          <div className="flex items-center justify-between border-b pb-2 font-semibold text-foreground">
            <span>组件属性绑定</span>
            {selectedWidget && <Tag tone="primary">{selectedWidget.type}</Tag>}
          </div>

          {selectedWidget ? (
            <div className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">组件标题</span>
                <input
                  type="text"
                  value={selectedWidget.title}
                  onChange={(e) => handleUpdateWidget({ title: e.target.value })}
                  className="h-8 rounded border border-input bg-background px-2.5 text-xs font-medium"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">栅格列宽占比</span>
                <select
                  value={selectedWidget.gridSpan}
                  onChange={(e) => handleUpdateWidget({ gridSpan: Number(e.target.value) as 1 | 2 | 3 })}
                  className="h-8 rounded border border-input bg-background px-2 text-xs"
                >
                  <option value={1}>1 列 (标准宽度)</option>
                  <option value={2}>2 列 (宽幅双列)</option>
                  <option value={3}>3 列 (整行通栏)</option>
                </select>
              </label>

              {/* 1. 文本展示卡专用的「多字段多选绑定」配置 */}
              {selectedWidget.type === 'text_card' && (() => {
                const currentBindings = selectedWidget.fieldBindings?.length
                  ? selectedWidget.fieldBindings
                  : selectedWidget.fieldBinding
                    ? [selectedWidget.fieldBinding]
                    : ['user_query']

                const toggleField = (fName: string) => {
                  const exists = currentBindings.includes(fName)
                  let next: string[]
                  if (exists) {
                    if (currentBindings.length === 1) return // 至少保留 1 个字段
                    next = currentBindings.filter((x) => x !== fName)
                  } else {
                    next = [...currentBindings, fName]
                  }
                  handleUpdateWidget({ fieldBindings: next, fieldBinding: next[0] })
                }

                return (
                  <div className="flex flex-col gap-1.5 border-t pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                        <FileText className="size-3 text-primary" />
                        展示字段多选绑定 (可多选组合)
                      </span>
                      <Tag tone="primary" className="font-mono text-[10px]">
                        已选 {currentBindings.length} 个字段
                      </Tag>
                    </div>

                    <div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-lg border bg-muted/20 p-1.5">
                      {dict.entries.map((f) => {
                        const isBound = currentBindings.includes(f.logicalName)
                        return (
                          <button
                            key={f.logicalName}
                            type="button"
                            onClick={() => toggleField(f.logicalName)}
                            className={cn(
                              'group flex items-start justify-between gap-2 rounded-lg border p-2 text-left transition-all',
                              isBound
                                ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                                : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <Mono className={cn('font-bold text-xs', isBound ? 'text-primary' : 'text-foreground')}>
                                  {f.logicalName}
                                </Mono>
                                {f.avgTokens > 0 && (
                                  <span className="font-mono text-[10px] text-muted-foreground/80">
                                    ~{f.avgTokens} tok
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                                {f.description}
                              </div>
                            </div>

                            <div className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded border mt-0.5 transition-colors',
                              isBound ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-card group-hover:border-primary/50'
                            )}>
                              {isBound ? (
                                <Check className="size-3 font-bold" />
                              ) : (
                                <Plus className="size-2.5 text-muted-foreground/40 group-hover:text-primary" />
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* 2. 单图/视频/Diff 等组件的「单字段单选绑定」配置 */}
              {(selectedWidget.type === 'image_card' ||
                selectedWidget.type === 'video_player' ||
                selectedWidget.type === 'image_compare' ||
                selectedWidget.type === 'diff_viewer') && (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                      <Database className="size-3 text-primary" />
                      主数据字段绑定 (单选)
                    </span>
                    <Tag tone="primary" className="font-mono text-[10px]">
                      {selectedWidget.fieldBinding || '未绑定'}
                    </Tag>
                  </div>

                  <div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-lg border bg-muted/20 p-1.5">
                    {dict.entries.map((f) => {
                      const isBound = selectedWidget.fieldBinding === f.logicalName
                      return (
                        <button
                          key={f.logicalName}
                          type="button"
                          onClick={() => handleUpdateWidget({ fieldBinding: f.logicalName })}
                          className={cn(
                            'group flex items-start justify-between gap-2 rounded-lg border p-2 text-left transition-all',
                            isBound
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                              : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Mono className={cn('font-bold text-xs', isBound ? 'text-primary' : 'text-foreground')}>
                                {f.logicalName}
                              </Mono>
                              {f.avgTokens > 0 && (
                                <span className="font-mono text-[10px] text-muted-foreground/80">
                                  ~{f.avgTokens} tok
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                              {f.description}
                            </div>
                          </div>

                          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border mt-0.5">
                            {isBound ? (
                              <Check className="size-3 text-primary font-bold" />
                            ) : (
                              <span className="size-1.5 rounded-full bg-transparent group-hover:bg-muted-foreground/30" />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 双图对比卡所需的第二字段 (参考图绑定) */}
              {selectedWidget.type === 'image_compare' && (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                      <ImageIcon className="size-3 text-primary" />
                      参考图字段绑定 (Reference Image)
                    </span>
                    <Tag tone="neutral" className="font-mono text-[10px]">
                      {selectedWidget.secondaryFieldBinding || '未绑定'}
                    </Tag>
                  </div>

                  <div className="flex flex-col gap-1 max-h-44 overflow-y-auto rounded-lg border bg-muted/20 p-1.5">
                    {dict.entries.map((f) => {
                      const isBound = selectedWidget.secondaryFieldBinding === f.logicalName
                      return (
                        <button
                          key={f.logicalName}
                          type="button"
                          onClick={() => handleUpdateWidget({ secondaryFieldBinding: f.logicalName })}
                          className={cn(
                            'group flex items-start justify-between gap-2 rounded-lg border p-2 text-left transition-all',
                            isBound
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                              : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <Mono className={cn('font-bold text-xs', isBound ? 'text-primary' : 'text-foreground')}>
                              {f.logicalName}
                            </Mono>
                            <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                              {f.description}
                            </div>
                          </div>

                          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border mt-0.5">
                            {isBound ? (
                              <Check className="size-3 text-primary font-bold" />
                            ) : (
                              <span className="size-1.5 rounded-full bg-transparent group-hover:bg-muted-foreground/30" />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 评分表单绑定的评测维度 */}
              {selectedWidget.type === 'score_form' && (
                <fieldset className="flex flex-col gap-1.5 border-t pt-2">
                  <legend className="text-[11px] font-medium text-muted-foreground mb-1">
                    挂载评测维度 (复用 Rubric)
                  </legend>
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {dimensions.map((dim) => {
                      const checked = selectedWidget.boundDimensions?.includes(dim.key) || false
                      return (
                        <label
                          key={dim.key}
                          className={cn(
                            'flex items-center gap-2 rounded border p-2 cursor-pointer transition-colors',
                            checked ? 'border-primary/50 bg-primary/5 text-foreground' : 'text-muted-foreground hover:bg-muted/40',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const currentDims = selectedWidget.boundDimensions || []
                              const nextDims = e.target.checked
                                ? [...currentDims, dim.key]
                                : currentDims.filter((k) => k !== dim.key)
                              handleUpdateWidget({ boundDimensions: nextDims })
                            }}
                            className="rounded accent-primary"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-xs">{dim.name}</div>
                            <Mono className="text-[10px] text-muted-foreground">{dim.key}</Mono>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              )}

              <div className="pt-2 border-t flex justify-end">
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDeleteWidget(selectedWidget.id)}
                  className="text-fail hover:bg-fail-soft"
                >
                  <Trash2 className="size-3.5" />
                  删除此控件
                </Btn>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              点击画布中的组件进行属性与字段绑定
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
