'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, Send, CheckCircle2, AlertCircle, Loader2, MessageSquare, Image as ImageIcon, X, Upload, FileText, Film, Boxes } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

import { Panel, Tag, Mono, Btn } from './primitives'
import { llmStatus, llmListModels, llmChatStream, type LlmModel } from '@/lib/api-client'

type ProbeState = 'idle' | 'loading' | 'ok' | 'fail'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  images?: string[] // base64 图片数组
  model?: string
  latencyMs?: number
  tokens?: number
}

export function ModelsView() {
  // 渠道状态
  const [status, setStatus] = useState<{
    ready: boolean
    base_url: string
    model: string
    api_key_masked: string
  } | null>(null)
  const [statusState, setStatusState] = useState<ProbeState>('loading')
  const [statusError, setStatusError] = useState<string>('')

  // 模型列表
  const [models, setModels] = useState<LlmModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedModelCapabilities, setSelectedModelCapabilities] = useState<string[]>([])

  // 对话测试
  const [input, setInput] = useState<string>('你好，简单介绍一下你自己。')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState<string>('')
  const [isSending, setIsSending] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<string[]>([]) // base64 图片数组
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false) // 控制自定义下拉框
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 加载渠道状态 + 模型列表
  useEffect(() => {
    setStatusState('loading')
    Promise.all([llmStatus(), llmListModels()])
      .then(([s, m]) => {
        setStatus(s)
        setModels(m)
        
        // 选择默认模型
        const defaultModelId = s.model && m.find(model => model.id === s.model) 
          ? s.model 
          : m[0]?.id ?? ''
        setSelectedModel(defaultModelId)
        
        // 设置默认模型的能力
        const defaultModelObj = m.find(model => model.id === defaultModelId)
        setSelectedModelCapabilities(defaultModelObj?.capabilities ?? [])
        
        setStatusState(s.ready ? 'ok' : 'fail')
        if (!s.ready) setStatusError('渠道未就绪：base_url 或 api_key 缺失')
      })
      .catch((err) => {
        setStatusState('fail')
        setStatusError(err?.message ?? String(err))
      })
  }, [])

  // 自动滚到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatHistory, streaming])

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 处理图片上传
  const handleImageUpload = async (files: FileList | null) => {
    if (!files) return
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp']
    const newImages: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!supportedTypes.includes(file.type)) {
        alert(`不支持的格式：${file.name}，请上传 JPG/PNG/WEBP 格式`)
        continue
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        if (e.target?.result) {
          newImages.push(e.target.result as string)
          if (newImages.length === Array.from(files).filter(f => supportedTypes.includes(f.type)).length) {
            setUploadedImages((prev) => [...prev, ...newImages])
          }
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const removeImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index))
  }


  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !selectedModel || isSending) return

    // 保存用户消息（包含图片）
    const userMsg: ChatMessage = { 
      role: 'user', 
      content: text,
      images: uploadedImages.length > 0 ? [...uploadedImages] : undefined
    }
    setChatHistory((h) => [...h, userMsg])
    setInput('')
    setStreaming('')
    setIsSending(true)

    const started = Date.now()
    let accumulated = ''
    let usage: { total_tokens?: number } | null = null

    try {
      // 构建多模态消息格式
      const buildMessageContent = (msg: ChatMessage) => {
        if (msg.images && msg.images.length > 0) {
          // 多模态消息：图片 + 文本
          return [
            ...msg.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: img }
            })),
            { type: 'text' as const, text: msg.content }
          ]
        }
        // 纯文本消息
        return msg.content
      }

      for await (const event of llmChatStream({
        messages: [
          ...chatHistory.map((m) => ({
            role: m.role,
            content: buildMessageContent(m)
          })),
          { role: 'user', content: buildMessageContent(userMsg) },
        ],
        model: selectedModel,
        temperature: 0.7,
      })) {
        console.log(`[llm] event:`, event.event, event.content?.substring?.(0, 50) || '')
        if (event.event === 'delta' && event.content) {
          accumulated += event.content
          setStreaming(accumulated)
        } else if (event.event === 'usage') {
          usage = { total_tokens: event.total_tokens }
          console.log(`[llm] usage:`, usage)
        } else if (event.event === 'error') {
          throw new Error(event.message || 'LLM 调用失败')
        }
      }

      console.log(`[llm] done, accumulated length: ${accumulated.length}`)
      setChatHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: accumulated || '（空回复）',
          model: selectedModel,
          latencyMs: Date.now() - started,
          tokens: usage?.total_tokens ?? 0,
        },
      ])
      
      // 发送成功后清空已上传的图片
      setUploadedImages([])
    } catch (err: any) {
      setChatHistory((h) => [
        ...h,
        {
          role: 'assistant',
          content: `调用失败：${err?.message ?? String(err)}`,
          model: selectedModel,
          latencyMs: Date.now() - started,
        },
      ])
    } finally {
      setStreaming('')
      setIsSending(false)
    }
  }

  const clearChat = () => {
    setChatHistory([])
    setStreaming('')
  }

  // 按阵营分组：openai / gemini
  const grouped = {
    openai: models.filter((m) => m.provider === 'openai'),
    gemini: models.filter((m) => m.provider === 'gemini'),
  }

  // 模态图标渲染
  const ModalityTags = ({ caps }: { caps: string[] }) => (
    <span className="flex items-center gap-1">
      {caps.includes('text') && (
        <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="文本">
          <FileText className="size-3" />文
        </span>
      )}
      {caps.includes('image') && (
        <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700" title="图片">
          <ImageIcon className="size-3" />图
        </span>
      )}
      {caps.includes('video') && (
        <span className="inline-flex items-center gap-0.5 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700" title="视频">
          <Film className="size-3" />视频
        </span>
      )}
    </span>
  )

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 顶部状态 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {statusState === 'loading' && <Tag>正在探测...</Tag>}
          {statusState === 'ok' && <Tag tone="pass">渠道就绪</Tag>}
          {statusState === 'fail' && <Tag tone="fail">渠道不可用</Tag>}
          <Tag>{models.length} 个模型</Tag>
        </div>
      </div>

      {/* 渠道卡片：只保留 New API */}
      <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-primary" />渠道信息</span>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground">供应商</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Tag tone="primary">New API</Tag>
              {statusState === 'ok' ? (
                <CheckCircle2 className="size-3.5 text-pass" />
              ) : statusState === 'fail' ? (
                <AlertCircle className="size-3.5 text-fail" />
              ) : (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] font-medium text-muted-foreground">Base URL</div>
            <Mono className="mt-1 block text-xs text-foreground">{status?.base_url || '—'}</Mono>
          </div>
          <div>
            <div className="text-[11px] font-medium text-muted-foreground">API Key</div>
            <Mono className="mt-1 block text-xs text-foreground">{status?.api_key_masked || '—'}</Mono>
          </div>
        </div>

        {statusState === 'fail' && statusError ? (
          <div className="mt-3 rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-xs text-fail">
            {statusError}
          </div>
        ) : null}
      </Panel>

      {/* 注册表 + 对话测试 并排 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        {/* 模型注册表 */}
        <Panel title={<span className="flex items-center gap-2"><Boxes className="size-4 text-primary" />模型注册表<span className="text-xs font-normal text-muted-foreground">({models.length} 个)</span></span>}>
          <div className="flex flex-col gap-2">
            {([['openai', 'OpenAI 渠道', 'bg-emerald-500'] , ['gemini', 'Gemini 渠道', 'bg-blue-500']] as const).map(([key, label, dot]) => {
              const list = grouped[key as 'openai' | 'gemini']
              return (
                <details key={key} className="group rounded-md border border-border">
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className={`inline-block size-2 rounded-full ${dot}`} />
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <Tag>{list.length}</Tag>
                      <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">▾</span>
                    </div>
                  </summary>
                  <div className="divide-y divide-border border-t">
                    {list.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <Mono className="text-xs text-foreground">{m.id}</Mono>
                        <div className="flex shrink-0 items-center gap-1">
                          {m.capabilities.includes('text') && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">text</span>}
                          {m.capabilities.includes('image') && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">image</span>}
                          {m.capabilities.includes('video') && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">video</span>}
                          {m.capabilities.includes('video') && m.videoEndpoint === 'gemini-native' && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Gemini渠道</span>
                          )}
                          {m.capabilities.includes('video') && m.videoEndpoint === 'openai' && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">OpenAI渠道</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        </Panel>

        {/* 对话测试 */}
        <Panel
          title={<span className="flex items-center gap-2"><MessageSquare className="size-4 text-primary" />对话测试</span>}
          actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">模型：</span>
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                disabled={isSending || models.length === 0}
                className="h-7 min-w-[200px] rounded-md border-2 border-foreground/40 bg-card px-2 font-mono text-xs text-left flex items-center justify-between hover:bg-muted/50 disabled:opacity-60"
              >
                <span className="truncate">
                  {models.find(m => m.id === selectedModel)?.name || '加载中...'}
                  {selectedModelCapabilities.length > 0 && (
                    <span className="text-muted-foreground"> [{selectedModelCapabilities.join(',')}]</span>
                  )}
                </span>
                <span className="text-xs">▼</span>
              </button>
              
              {isModelDropdownOpen && models.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-md border-2 border-foreground/40 bg-card shadow-lg z-50 max-h-[600px] overflow-y-auto">
                  {models.map((m, idx) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedModel(m.id)
                        setSelectedModelCapabilities(m.capabilities)
                        setIsModelDropdownOpen(false)
                      }}
                      className={`w-full text-left px-2 py-2 text-xs font-mono hover:bg-primary hover:text-primary-foreground transition-colors ${
                        idx < models.length - 1 ? 'border-b border-foreground/10' : ''
                      } ${selectedModel === m.id ? 'bg-primary/20' : ''}`}
                    >
                      {m.name} {m.capabilities.length > 0 && `[${m.capabilities.join(',')}]`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Btn size="sm" onClick={clearChat} disabled={isSending || (chatHistory.length === 0 && !streaming)}>
              清空
            </Btn>
          </div>
        }
        bodyClassName="flex flex-col gap-3 p-0"
      >
        {/* 消息区 */}
        <div
          ref={scrollRef}
          className="max-h-[480px] min-h-[280px] overflow-y-auto border-b bg-muted/20 p-4"
        >
          {chatHistory.length === 0 && !streaming ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
              <MessageSquare className="size-8 opacity-30" />
              <p className="text-xs">填入消息，按 Enter 发送，验证模型是否可用</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'border bg-card text-foreground'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <div className="space-y-2">
                        {msg.images && msg.images.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {msg.images.map((img, idx) => (
                              <img
                                key={idx}
                                src={img}
                                alt={`上传图片 ${idx + 1}`}
                                className="max-w-[200px] max-h-[200px] rounded border border-primary-foreground/20"
                              />
                            ))}
                          </div>
                        )}
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                          {msg.content}
                        </pre>
                      </div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Markdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {msg.content
                            .replace(/\\\[/g, '$$')
                            .replace(/\\\]/g, '$$')
                            .replace(/\\\(/g, '$')
                            .replace(/\\\)/g, '$')}
                        </Markdown>
                      </div>
                    )}
                    {msg.role === 'assistant' && (msg.latencyMs || msg.tokens) ? (
                      <div className="mt-1.5 flex items-center gap-2 border-t pt-1 text-[10px] text-muted-foreground">
                        <Mono>{msg.model}</Mono>
                        {msg.latencyMs ? <span>{msg.latencyMs}ms</span> : null}
                        {msg.tokens ? <span>{msg.tokens} tokens</span> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {streaming ? (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg border border-primary/40 bg-primary-soft/40 px-3 py-2">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Markdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {streaming
                          .replace(/\\\[/g, '$$')
                          .replace(/\\\]/g, '$$')
                          .replace(/\\\(/g, '$')
                          .replace(/\\\)/g, '$')}
                      </Markdown>
                    </div>
                    <span className="ml-0.5 inline-block size-2 animate-pulse rounded-full bg-primary align-middle" />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="space-y-3 p-4 pt-0">
          {/* 图片预览区 */}
          {uploadedImages.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 rounded-md border border-input bg-muted/30">
              {uploadedImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={img}
                    alt={`预览 ${idx + 1}`}
                    className="size-20 rounded border border-input object-cover"
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-2 -right-2 size-5 rounded-full bg-fail text-fail-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 输入框 + 按钮 */}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => handleImageUpload(e.target.files)}
              className="hidden"
            />
            <Btn
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending || statusState !== 'ok' || !selectedModelCapabilities.includes('image')}
              title={selectedModelCapabilities.includes('image') ? '' : '当前模型不支持图像理解'}
              className="self-stretch"
            >
              <Upload className="size-3.5" />
              上传图片
            </Btn>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={1}
              disabled={isSending || statusState !== 'ok'}
              className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring resize-none"
            />
            <Btn
              variant="primary"
              size="sm"
              onClick={sendMessage}
              disabled={isSending || !input.trim() || !selectedModel || statusState !== 'ok'}
              className="self-stretch"
            >
              {isSending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  发送中
                </>
              ) : (
                <>
                  <Send className="size-3.5" />
                  发送
                </>
              )}
            </Btn>
          </div>
        </div>
        </Panel>
      </div>
    </div>
  )
}

