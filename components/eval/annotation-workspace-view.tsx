'use client'

import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Gavel,
  ImageIcon,
  Video,
  FileText,
  Sliders,
  Check,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tag, Mono, Btn, VerdictBadge } from '@/components/eval/primitives'
import { useAnnotationStore, type AnnotationItem } from '@/lib/annotation-store'
import { type Verdict } from '@/lib/mock-data'

export function AnnotationWorkspaceView() {
  const { items, updateItemScore, updateItemNote } = useAnnotationStore()
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [activeTaskFilter, setActiveTaskFilter] = useState<'all' | 't2i' | 'i2v'>('all')

  const filteredItems = items.filter((item) => activeTaskFilter === 'all' || item.taskType === activeTaskFilter)
  const currentItem: AnnotationItem | undefined = filteredItems[selectedIdx] || filteredItems[0]

  if (!currentItem) {
    return <div className="p-8 text-center text-muted-foreground text-sm">暂无待标注样本</div>
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部统计与筛选 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gavel className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">人工标注工作台</h2>
            <div className="text-xs text-muted-foreground mt-0.5">
              <span>待核验 <strong className="font-mono text-foreground">{filteredItems.length}</strong> 条</span>
              <span>·</span>
              <span>文生图 / 图生视频多模态样本</span>
            </div>
          </div>
        </div>

        {/* 筛选 Tab */}
        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {[
            { id: 'all', label: `全部 (${items.length})` },
            { id: 't2i', label: `文生图 (${items.filter((i) => i.taskType === 't2i').length})` },
            { id: 'i2v', label: `图生视频 (${items.filter((i) => i.taskType === 'i2v').length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTaskFilter(tab.id as any)
                setSelectedIdx(0)
              }}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                activeTaskFilter === tab.id
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 主三栏布局：左侧样本列表，中间多模态动态展示，右侧打分面板 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr_340px]">
        {/* 左侧待标注用例列表 */}
        <div className="flex flex-col rounded-xl border bg-card">
          <div className="border-b px-3.5 py-2.5 text-xs font-semibold text-muted-foreground">
            标注队列 · {filteredItems.length} 项
          </div>
          <div className="divide-y overflow-y-auto max-h-[720px]">
            {filteredItems.map((item, idx) => {
              const isSelected = item.id === currentItem.id
              const isAnnotated = Object.keys(item.humanScores).length > 0

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 p-3 text-left transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40 text-foreground',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{item.caseId}</span>
                    {isAnnotated ? (
                      <Tag tone="pass" className="text-[10px]">已标注</Tag>
                    ) : (
                      <Tag tone="warn" className="text-[10px]">待标注</Tag>
                    )}
                  </div>
                  <div className="text-xs truncate font-medium text-muted-foreground">{item.taskName}</div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    <span className="uppercase font-mono">{item.taskType}</span>
                    <span>{item.createdAt.split(' ')[1]}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 中间多模态动态展示区 */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-5">
            {/* 顶栏控制 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-sm text-foreground">{currentItem.caseId}</span>
                <span className="text-xs font-medium text-muted-foreground">{currentItem.taskName}</span>
                <Tag tone={currentItem.taskType === 't2i' ? 'primary' : 'pass'} className="text-[10px] whitespace-nowrap">
                  {currentItem.taskType === 't2i' ? '文生图' : '图生视频'}
                </Tag>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={selectedIdx === 0}
                  onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" /> 上一条
                </button>
                <span className="font-mono text-xs text-muted-foreground px-1 whitespace-nowrap">
                  {selectedIdx + 1} / {filteredItems.length}
                </span>
                <button
                  type="button"
                  disabled={selectedIdx === filteredItems.length - 1}
                  onClick={() => setSelectedIdx((i) => Math.min(filteredItems.length - 1, i + 1))}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                >
                  下一条 <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            {/* 动态输入渲染：文生图展示 */}
            {currentItem.taskType === 't2i' && (
              <div className="mt-4 space-y-4">
                {/* 文本输入部分 */}
                <div className="rounded-lg bg-muted/30 p-3.5 space-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <FileText className="size-3.5 text-primary" />
                      Prompt:
                    </span>
                    <p className="mt-1 text-foreground leading-relaxed bg-background/80 p-2.5 rounded border border-border/60">
                      {currentItem.inputs.prompt}
                    </p>
                  </div>
                  {currentItem.inputs.negative_prompt && (
                    <div>
                      <span className="font-medium text-muted-foreground">Negative Prompt:</span>
                      <p className="mt-0.5 text-muted-foreground text-[11px] bg-background/50 p-2 rounded">
                        {currentItem.inputs.negative_prompt}
                      </p>
                    </div>
                  )}
                </div>

                {/* 图像比对渲染 */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* 生成图 */}
                  <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <ImageIcon className="size-4 text-primary" />
                        生成图片 (Generated Image)
                      </span>
                    </div>
                    <div className="relative aspect-square w-full overflow-hidden rounded-md border bg-black/5 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={currentItem.inputs.generated_image}
                        alt="生成图片"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>

                  {/* 参考图（若有） */}
                  {currentItem.inputs.reference_image ? (
                    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 p-3">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span className="flex items-center gap-1.5">
                          <Layers className="size-4 text-muted-foreground" />
                          参考图 (Reference Image)
                        </span>
                      </div>
                      <div className="relative aspect-square w-full overflow-hidden rounded-md border bg-black/5 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={currentItem.inputs.reference_image}
                          alt="参考图"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* 动态输入渲染：图生视频展示 */}
            {currentItem.taskType === 'i2v' && (
              <div className="mt-4 space-y-4">
                {/* 运镜与动作要求文本 */}
                <div className="rounded-lg bg-muted/30 p-3.5 space-y-2 text-xs">
                  <div>
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Sliders className="size-3.5 text-pass" />
                      Motion Prompt:
                    </span>
                    <p className="mt-1 text-foreground leading-relaxed bg-background/80 p-2.5 rounded border border-border/60">
                      {currentItem.inputs.motion_prompt || '自然运动'}
                    </p>
                  </div>
                </div>

                {/* 首帧与生成视频并排展示 */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* 首帧图 */}
                  <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <ImageIcon className="size-4 text-muted-foreground" />
                        首帧 (First Frame)
                      </span>
                    </div>
                    <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black/5 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={currentItem.inputs.first_frame}
                        alt="首帧图"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>

                  {/* 生成视频 */}
                  <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <Video className="size-4 text-pass" />
                        生成视频 ({currentItem.inputs.target_duration}s)
                      </span>
                    </div>
                    <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-black flex items-center justify-center">
                      <video
                        src={currentItem.inputs.video_clip}
                        controls
                        autoPlay
                        loop
                        muted
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧评分配置与判定面板 */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-1.5">
                <Gavel className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">人工判定</h3>
              </div>
              <Tag tone="neutral">1~5 分</Tag>
            </div>

            {/* 遍历维度打分 */}
            <div className="space-y-4">
              {Object.entries(currentItem.judgeResults).map(([dimKey, judgeVal]) => {
                const humanVal = currentItem.humanScores[dimKey]
                const currentScore = (humanVal?.score as number) || 0
                const isConflict = humanVal && humanVal.verdict !== judgeVal.verdict

                return (
                  <div key={dimKey} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-xs text-foreground">{getDimName(dimKey)}</div>
                        <span className="font-mono text-[10px] text-muted-foreground">{dimKey}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Tag tone="neutral" className="text-[10px]">裁判 {judgeVal.score}分</Tag>
                        <VerdictBadge verdict={judgeVal.verdict} className="text-[10px]" />
                      </div>
                    </div>

                    {/* 裁判模型理由 */}
                    <div className="rounded bg-background p-2 text-[11px] text-muted-foreground border border-border/60 leading-relaxed">
                      <span className="font-medium text-primary">裁判理由: </span>
                      {judgeVal.reason}
                    </div>

                    {/* 人工打分 1~5 按钮组 */}
                    <div className="pt-1">
                      <div className="text-[11px] font-medium text-foreground mb-1 flex items-center justify-between">
                        <span>人工核定:</span>
                        {isConflict ? <Tag tone="warn" className="text-[9px]">存在分歧</Tag> : null}
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {[1, 2, 3, 4, 5].map((score) => {
                          const active = currentScore === score
                          const verdict: Verdict = score >= 4 ? 'pass' : score === 3 ? 'na' : 'fail'

                          return (
                            <button
                              key={score}
                              type="button"
                              onClick={() => {
                                updateItemScore(currentItem.id, dimKey, {
                                  score,
                                  verdict,
                                  note: humanVal?.note,
                                })
                              }}
                              className={cn(
                                'flex flex-col items-center justify-center rounded-md border py-1.5 text-xs font-semibold transition-all',
                                active
                                  ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                                  : 'bg-card text-foreground hover:bg-muted border-input',
                              )}
                            >
                              <span>{score}分</span>
                              <span className={cn('text-[9px] font-normal', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                                {score >= 4 ? 'Pass' : score === 3 ? 'NA' : 'Fail'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 备注与提交 */}
            <div className="border-t pt-3 space-y-2">
              <label className="text-xs font-medium text-foreground block">审核备注</label>
              <textarea
                rows={2}
                placeholder="记录归因或修改建议"
                value={currentItem.reviewNote || ''}
                onChange={(e) => updateItemNote(currentItem.id, e.target.value)}
                className="w-full rounded border border-input bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              />
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">
                  已完成 {Object.keys(currentItem.humanScores).length}/{Object.keys(currentItem.judgeResults).length}
                </span>
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    if (selectedIdx < filteredItems.length - 1) {
                      setSelectedIdx((i) => i + 1)
                    }
                  }}
                >
                  <Check className="size-3.5" />
                  保存并下一条
                </Btn>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getDimName(key: string) {
  const map: Record<string, string> = {
    't2i.alignment': '文图对齐与元素遵从',
    't2i.aesthetic': '画质与视觉美感',
    't2i.identity_consistency': '角色/参考图一致性',
    'i2v.first_frame': '首帧启动保真度',
    'i2v.motion_quality': '动作流畅度与时序连续性',
    'i2v.camera_panning': '运镜与指令遵从',
  }
  return map[key] || key
}
