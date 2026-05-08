import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import {
  Send,
  Plus,
  Sparkles,
  Trash2,
  Menu,
  X,
  Image as ImageIcon,
  MessageSquare,
  Copy,
  Check,
  Square,
  Brain,
  Zap,
  Wand2,
  Github,
} from 'lucide-react'
import './App.css'

type Role = 'user' | 'assistant' | 'system'

interface ChatMessage {
  id: string
  role: Role
  content: string
  imageUrl?: string
  modelId?: string
  createdAt: number
}

interface Conversation {
  id: string
  title: string
  modelId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

type ModelKind = 'text' | 'image'

interface ModelDef {
  id: string
  name: string
  tagline: string
  kind: ModelKind
  pollinationsModel?: string
  imageModel?: string
  reasoningEffort?: 'low' | 'medium' | 'high'
  temperature?: number
  icon: typeof Brain
  accent: string
}

const MODELS: ModelDef[] = [
  {
    id: 'lumina-fast',
    name: 'Lumina Fast',
    tagline: 'Cepat & ringan - GPT-OSS 20B',
    kind: 'text',
    pollinationsModel: 'openai-fast',
    icon: Zap,
    accent: 'from-amber-300 to-rose-400',
  },
  {
    id: 'lumina-reason',
    name: 'Lumina Reason',
    tagline: 'Penalaran mendalam',
    kind: 'text',
    pollinationsModel: 'openai-fast',
    reasoningEffort: 'high',
    icon: Brain,
    accent: 'from-violet-400 to-fuchsia-400',
  },
  {
    id: 'lumina-gemini',
    name: 'Lumina Gemini',
    tagline: 'Multibahasa & kreatif',
    kind: 'text',
    pollinationsModel: 'gemini',
    icon: Sparkles,
    accent: 'from-sky-300 to-emerald-300',
  },
  {
    id: 'lumina-creative',
    name: 'Lumina Creative',
    tagline: 'Imajinatif - suhu tinggi',
    kind: 'text',
    pollinationsModel: 'openai-fast',
    temperature: 1.1,
    icon: Wand2,
    accent: 'from-pink-300 to-purple-400',
  },
  {
    id: 'lumina-image',
    name: 'Lumina Image',
    tagline: 'Generator gambar (Flux)',
    kind: 'image',
    imageModel: 'flux',
    icon: ImageIcon,
    accent: 'from-cyan-300 to-indigo-400',
  },
]

const STORAGE_KEY = 'lumina_chat_state_v1'

const SUGGESTED_PROMPTS = [
  { title: 'Ide bisnis', body: 'Beri 5 ide bisnis online modal kecil yang cocok untuk anak muda Indonesia.' },
  { title: 'Belajar coding', body: 'Jelaskan async/await di JavaScript dengan analogi sederhana dan contoh kode.' },
  { title: 'Tulis email', body: 'Bantu saya menulis email permohonan magang yang sopan dan menarik.' },
  { title: 'Resep cepat', body: 'Sarankan resep makan malam 30 menit dengan ayam dan sayur.' },
]

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function newConversation(modelId: string): Conversation {
  return {
    id: uid(),
    title: 'Chat baru',
    modelId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function loadState(): { conversations: Conversation[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { conversations: [], activeId: null }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.conversations)) {
      return { conversations: parsed.conversations, activeId: parsed.activeId ?? null }
    }
  } catch {
    /* noop */
  }
  return { conversations: [], activeId: null }
}

function saveState(conversations: Conversation[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeId }))
  } catch {
    /* noop */
  }
}

function buildImageUrl(prompt: string, model = 'flux') {
  const seed = Math.floor(Math.random() * 1_000_000)
  const params = new URLSearchParams({
    width: '1024',
    height: '1024',
    nologo: 'true',
    enhance: 'true',
    model,
    seed: String(seed),
  })
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`
}

async function* streamPollinations(
  messages: { role: Role; content: string }[],
  model: ModelDef,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    messages,
    model: model.pollinationsModel ?? 'openai-fast',
    stream: true,
    private: true,
    referrer: 'lumina-chat',
  }
  if (model.reasoningEffort) body.reasoning_effort = model.reasoningEffort
  if (typeof model.temperature === 'number') body.temperature = model.temperature

  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error('API error ' + res.status + ': ' + text.slice(0, 200))
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 2)
      if (!event.startsWith('data:')) continue
      const data = event.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length) yield delta
      } catch {
        /* ignore non-JSON */
      }
    }
  }
}

function PreBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => {
          const text = ref.current?.innerText ?? ''
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-zinc-200 flex items-center gap-1"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Tersalin' : 'Salin'}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

function MessageBubble({
  message,
  modelDef,
  isStreaming,
}: {
  message: ChatMessage
  modelDef: ModelDef | undefined
  isStreaming: boolean
}) {
  const isUser = message.role === 'user'
  const Icon = modelDef?.icon ?? Sparkles
  const accent = modelDef?.accent ?? 'from-violet-400 to-fuchsia-400'
  return (
    <div className={'fade-in flex gap-3 ' + (isUser ? 'flex-row-reverse' : '')}>
      <div
        className={
          'shrink-0 w-9 h-9 rounded-full grid place-items-center ' +
          (isUser
            ? 'bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/10 text-white/90'
            : 'bg-gradient-to-br ' + accent + ' text-zinc-900')
        }
      >
        {isUser ? <span className="text-[11px] font-semibold">YOU</span> : <Icon size={18} />}
      </div>
      <div className={'max-w-[min(720px,calc(100%-3rem))] ' + (isUser ? 'text-right' : '')}>
        {!isUser && <div className="text-xs text-zinc-500 mb-1">{modelDef?.name ?? 'Lumina'}</div>}
        <div
          className={
            'inline-block text-left rounded-2xl px-4 py-3 ' +
            (isUser
              ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_8px_24px_-8px_rgba(167,139,250,0.5)]'
              : 'glass text-zinc-100')
          }
        >
          {message.imageUrl ? (
            <div className="space-y-2">
              <img
                src={message.imageUrl}
                alt={message.content}
                loading="lazy"
                className="rounded-xl max-w-full border border-white/10 shadow-lg"
              />
              <div className="text-sm text-zinc-300 italic">{message.content}</div>
            </div>
          ) : (
            <div className="md">
              {message.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    pre: ({ children }) => <PreBlock>{children}</PreBlock>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <div className="flex items-center gap-1 py-1.5">
                  <span className="dot-pulse w-1.5 h-1.5 rounded-full bg-zinc-300 inline-block" />
                  <span className="dot-pulse w-1.5 h-1.5 rounded-full bg-zinc-300 inline-block" />
                  <span className="dot-pulse w-1.5 h-1.5 rounded-full bg-zinc-300 inline-block" />
                </div>
              )}
              {isStreaming && message.content && <span className="caret" />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelCard({
  model,
  selected,
  onClick,
}: {
  model: ModelDef
  selected: boolean
  onClick: () => void
}) {
  const Icon = model.icon
  return (
    <button
      onClick={onClick}
      className={
        'relative text-left p-3 rounded-xl border transition ' +
        (selected
          ? 'border-violet-400/50 bg-white/5 shadow-[0_0_0_1px_rgba(167,139,250,0.35)_inset]'
          : 'border-white/10 hover:border-white/20 hover:bg-white/5')
      }
    >
      <div className="flex items-center gap-2.5">
        <span
          className={
            'w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-gradient-to-br ' +
            model.accent +
            ' text-zinc-900'
          }
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-100 truncate">{model.name}</div>
          <div className="text-[11px] text-zinc-400 truncate">{model.tagline}</div>
        </div>
      </div>
    </button>
  )
}

function App() {
  const initial = useMemo(loadState, [])
  const [conversations, setConversations] = useState<Conversation[]>(initial.conversations)
  const [activeId, setActiveId] = useState<string | null>(initial.activeId)
  const [selectedModelId, setSelectedModelId] = useState<string>(MODELS[0].id)
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )
  const activeModel = useMemo(
    () => MODELS.find((m) => m.id === (active?.modelId ?? selectedModelId)) ?? MODELS[0],
    [active, selectedModelId],
  )
  const ActiveIcon = activeModel.icon

  useEffect(() => {
    saveState(conversations, activeId)
  }, [conversations, activeId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [active?.messages.length, streamingId])

  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [])

  function startNewConversation(modelId = selectedModelId) {
    const c = newConversation(modelId)
    setConversations((prev) => [c, ...prev])
    setActiveId(c.id)
    setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function deleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  function clearAll() {
    if (!window.confirm('Hapus semua percakapan?')) return
    setConversations([])
    setActiveId(null)
  }

  function selectModel(id: string) {
    setSelectedModelId(id)
    if (active && active.messages.length === 0) {
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, modelId: id } : c)),
      )
    }
  }

  function pickConversation(id: string) {
    setActiveId(id)
    setError(null)
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  async function send() {
    const text = draft.trim()
    if (!text || streamingId) return
    setError(null)

    let convo = active
    if (!convo) {
      convo = newConversation(selectedModelId)
      const created = convo
      setConversations((prev) => [created, ...prev])
      setActiveId(created.id)
    }
    const model = MODELS.find((m) => m.id === convo.modelId) ?? MODELS[0]

    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      modelId: model.id,
      createdAt: Date.now(),
    }

    const targetId = convo.id
    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetId
          ? {
              ...c,
              title: c.messages.length === 0 ? text.slice(0, 48) : c.title,
              messages: [...c.messages, userMsg, assistantMsg],
              updatedAt: Date.now(),
            }
          : c,
      ),
    )
    setDraft('')
    setStreamingId(assistantMsg.id)

    if (model.kind === 'image') {
      try {
        const url = buildImageUrl(text, model.imageModel)
        const ok = await new Promise<boolean>((resolve) => {
          const img = new window.Image()
          img.onload = () => resolve(true)
          img.onerror = () => resolve(false)
          img.src = url
        })
        if (!ok) throw new Error('Gagal menghasilkan gambar.')
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: text, imageUrl: url } : m,
                  ),
                  updatedAt: Date.now(),
                }
              : c,
          ),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Terjadi kesalahan.'
        setError(msg)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: msg } : m,
                  ),
                }
              : c,
          ),
        )
      } finally {
        setStreamingId(null)
      }
      return
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const history: { role: Role; content: string }[] = [
        {
          role: 'system',
          content:
            'Kamu adalah Lumina, asisten AI yang ramah, jujur, dan jelas. Jawab dalam bahasa yang sama dengan pengguna. Format jawaban dengan markdown jika berguna.',
        },
        ...convo.messages
          .filter((m) => m.content && !(m.role === 'assistant' && m.id === assistantMsg.id))
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ]

      let acc = ''
      for await (const chunk of streamPollinations(history, model, ctrl.signal)) {
        acc += chunk
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: acc } : m,
                  ),
                }
              : c,
          ),
        )
      }
      if (!acc) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, content: '_(Tidak ada respons. Coba kirim ulang atau ganti model.)_' }
                      : m,
                  ),
                }
              : c,
          ),
        )
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // user stopped
      } else {
        const msg = e instanceof Error ? e.message : 'Terjadi kesalahan.'
        setError(msg)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: msg } : m,
                  ),
                }
              : c,
          ),
        )
      }
    } finally {
      setStreamingId(null)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="relative flex h-full text-zinc-100">
      <div className="aurora" aria-hidden />

      <aside
        className={
          'relative z-10 transition-[width,transform] duration-300 ease-out ' +
          (sidebarOpen ? 'w-72' : 'w-0') +
          ' shrink-0 border-r border-white/5 overflow-hidden'
        }
      >
        <div className="w-72 h-full glass flex flex-col">
          <div className="p-4 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 grid place-items-center shadow-lg">
              <Sparkles size={18} className="text-zinc-900" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold tracking-tight">Lumina AI</div>
              <div className="text-[11px] text-zinc-400">Chat banyak model gratis</div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-md hover:bg-white/10"
              aria-label="Tutup menu"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-3 pb-3">
            <button
              onClick={() => startNewConversation()}
              className="btn-shine w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white text-zinc-900 hover:bg-zinc-100 text-sm font-medium transition shadow-md"
            >
              <Plus size={16} /> Chat baru
            </button>
          </div>

          <div className="px-3 pb-2 text-[11px] uppercase tracking-wider text-zinc-500">
            Pilih model
          </div>
          <div className="px-3 grid gap-1.5">
            {MODELS.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                selected={(active?.modelId ?? selectedModelId) === m.id}
                onClick={() => selectModel(m.id)}
              />
            ))}
          </div>

          <div className="px-3 pt-4 pb-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center justify-between">
            <span>Riwayat</span>
            {conversations.length > 0 && (
              <button
                onClick={clearAll}
                className="text-zinc-500 hover:text-rose-300 transition"
                title="Hapus semua"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll px-2 pb-3">
            {conversations.length === 0 ? (
              <div className="text-xs text-zinc-500 px-2 py-3">Belum ada chat.</div>
            ) : (
              conversations.map((c) => {
                const m = MODELS.find((mm) => mm.id === c.modelId)
                return (
                  <div
                    key={c.id}
                    className={
                      'group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition ' +
                      (activeId === c.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-300 hover:bg-white/5')
                    }
                    onClick={() => pickConversation(c.id)}
                  >
                    <MessageSquare size={14} className="text-zinc-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{c.title || 'Chat baru'}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{m?.name ?? 'Model'}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(c.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-300 p-1 rounded-md"
                      aria-label="Hapus"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="border-t border-white/5 px-4 py-3 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>v1.0</span>
            <a
              href="https://pollinations.ai"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-300 transition flex items-center gap-1"
            >
              Powered by Pollinations
            </a>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="glass border-b border-white/5 px-4 md:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((s) => !s)}
            className="p-2 rounded-lg hover:bg-white/10 transition"
            aria-label="Toggle menu"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={
                'w-7 h-7 rounded-lg grid place-items-center bg-gradient-to-br ' +
                activeModel.accent +
                ' text-zinc-900 shrink-0'
              }
            >
              <ActiveIcon size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{activeModel.name}</div>
              <div className="text-[11px] text-zinc-400 truncate">{activeModel.tagline}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/jekpotgold"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition"
            >
              <Github size={14} /> GitHub
            </a>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto thin-scroll">
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-5">
            {!active || active.messages.length === 0 ? (
              <div className="pt-6 md:pt-16">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 grid place-items-center shadow-xl">
                    <Sparkles size={22} className="text-zinc-900" />
                  </div>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                      Halo, saya{' '}
                      <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-rose-300 bg-clip-text text-transparent">
                        Lumina
                      </span>
                    </h1>
                    <p className="text-sm text-zinc-400">
                      Tanyakan apa saja - pilih model di sebelah kiri
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-6">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p.title}
                      onClick={() => {
                        setDraft(p.body)
                        setTimeout(() => inputRef.current?.focus(), 0)
                      }}
                      className="text-left glass rounded-xl px-4 py-3 hover:bg-white/10 transition border border-white/5 hover:border-white/15"
                    >
                      <div className="text-sm font-medium text-zinc-100">{p.title}</div>
                      <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{p.body}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  modelDef={MODELS.find((md) => md.id === (m.modelId ?? active.modelId))}
                  isStreaming={streamingId === m.id}
                />
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="max-w-3xl w-full mx-auto px-4 md:px-6 pb-2">
            <div className="text-xs px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200">
              {error}
            </div>
          </div>
        )}

        <div className="border-t border-white/5 glass">
          <div className="max-w-3xl mx-auto px-3 md:px-6 py-3 md:py-4">
            <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-zinc-900/60 focus-within:border-white/25 transition px-3 py-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  activeModel.kind === 'image'
                    ? 'Deskripsikan gambar yang ingin kamu buat...'
                    : 'Tanyakan ' + activeModel.name + '...'
                }
                rows={1}
                className="auto flex-1 bg-transparent outline-none text-sm md:text-[15px] text-zinc-100 placeholder:text-zinc-500 max-h-44 py-2"
              />
              {streamingId ? (
                <button
                  onClick={stop}
                  className="shrink-0 p-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 transition"
                  aria-label="Berhenti"
                  title="Berhenti"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!draft.trim()}
                  className={
                    'btn-shine shrink-0 p-2.5 rounded-xl transition ' +
                    (draft.trim()
                      ? 'bg-gradient-to-br from-violet-400 to-fuchsia-500 text-zinc-900 hover:brightness-110'
                      : 'bg-white/5 text-zinc-500 cursor-not-allowed')
                  }
                  aria-label="Kirim"
                  title="Kirim (Enter)"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
            <div className="mt-2 px-1 text-[11px] text-zinc-500 flex items-center justify-between">
              <span>Tekan Enter untuk kirim, Shift+Enter untuk baris baru</span>
              <span className="hidden md:inline">
                Model: <span className="text-zinc-300">{activeModel.name}</span>
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
