import { EPHEMERAL, MOCK, getApiBase } from './config'
import { fxEdits, fxOriginals } from './fixtures'
import { heuristicObservation } from './observation'
import type {
  ChatMessage,
  ChatResponse,
  ClarifyingQuestion,
  FileEdit,
  ObserveResult,
  Reorderable,
  ReorderChild,
  ReorderRequest,
  ReorderResponse,
  SelectedElement,
  StyleEditRequest,
  StyleEditResponse,
  StyleStrategy,
  TextEditRequest,
  TextEditResponse,
} from './types'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Prepend the configured API base (default '' = same-origin) so the overlay can
// target a same-origin backend (Vite plugin / Next dev API route) OR a standalone
// muse-server on another origin. Resolved per-call so configureMuse() takes effect.
const apiUrl = (path: string) => `${getApiBase()}${path}`

export async function museChat(
  targets: SelectedElement[],
  messages: ChatMessage[],
): Promise<ChatResponse> {
  if (MOCK) return mockChat(targets, messages)

  const res = await fetch(apiUrl('/api/muse/chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targets: targets.map((t) => ({
        fileName: t.fileName,
        tag: t.tag,
        classNames: t.classNames,
        text: t.text,
        line: t.line,
      })),
      messages,
    }),
  })
  return (await res.json()) as ChatResponse
}

export async function museObserve(target: SelectedElement): Promise<ObserveResult> {
  if (MOCK) return mockObserve(target)

  const res = await fetch(apiUrl('/api/muse/observe'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: {
        fileName: target.fileName,
        tag: target.tag,
        classNames: target.classNames,
        text: target.text,
        line: target.line,
      },
    }),
  })
  const data = (await res.json()) as Partial<ObserveResult> & { error?: string }
  if (data.error || !data.observation || !Array.isArray(data.chips)) {
    throw new Error(data.error ?? 'Observe failed')
  }
  return { observation: data.observation, chips: data.chips }
}

export async function museWrite(files: FileEdit[]): Promise<void> {
  if (MOCK || EPHEMERAL) {
    await delay(MOCK ? 300 : 0) // no real disk change in mock/ephemeral mode
    return
  }

  const res = await fetch(apiUrl('/api/muse/write'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Write failed')
}

// Deterministic style edit (Canvas Mode). NO model call — the server parses the
// AST, rewrites the targeted element's className/style, and returns the new file
// contents plus their pre-edit originals (for undo). The caller writes them with
// museWrite, exactly like an approved chat proposal.
export async function museStyleEdit(
  requests: StyleEditRequest[],
  strategy?: StyleStrategy,
): Promise<StyleEditResponse> {
  // Ephemeral demo: there's no backend and nothing to write — CanvasMode keeps the
  // live inline preview as the committed state. Backstop in case a path reaches here.
  if (EPHEMERAL) return { edits: [], originals: {}, warnings: [] }
  // Omitting `strategy` lets the server detect it from the host project (Tailwind →
  // utility classes, else inline). JSON.stringify drops the key when undefined.
  const res = await fetch(apiUrl('/api/muse/style-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: requests, strategy }),
  })
  const data = (await res.json()) as Partial<StyleEditResponse> & { error?: string }
  if (data.error) throw new Error(data.error)
  return {
    edits: Array.isArray(data.edits) ? data.edits : [],
    originals: data.originals ?? {},
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    sharedConst: data.sharedConst,
  }
}

// Deterministic text-content edit (Canvas Mode double-click). NO model call — the
// server rewrites the element's single static JSXText and returns the new file
// contents + originals, flowing through the SAME museWrite + history as styles.
export async function museTextEdit(requests: TextEditRequest[]): Promise<TextEditResponse> {
  if (EPHEMERAL) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/text-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: requests }),
  })
  const data = (await res.json()) as Partial<TextEditResponse> & { error?: string }
  if (data.error) throw new Error(data.error)
  return {
    edits: Array.isArray(data.edits) ? data.edits : [],
    originals: data.originals ?? {},
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  }
}

// Probe whether an element's text is editable (single static JSXText) BEFORE
// entering edit mode, so data-bound text shows a calm hint instead of a bounce.
export async function museTextEditable(
  req: Omit<TextEditRequest, 'text'>,
): Promise<{ editable: boolean; reason?: string }> {
  if (EPHEMERAL) return { editable: true } // in-browser edits are always reversible
  try {
    const res = await fetch(apiUrl('/api/muse/text-editable'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = (await res.json()) as { editable?: boolean; reason?: string }
    return { editable: data.editable !== false, reason: data.reason }
  } catch {
    return { editable: true } // probe failed — let the commit be the authority
  }
}

// Deterministic sibling reorder (Canvas Mode drag). NO model call — the server
// moves the element among its siblings by a character-range splice and returns the
// new file contents + originals, flowing through the SAME museWrite + history as
// styles/text. `toIndex` is the source-order slot to land before (count === end).
export async function museReorder(req: ReorderRequest): Promise<ReorderResponse> {
  if (EPHEMERAL) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/reorder'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: [req] }),
  })
  const data = (await res.json()) as Partial<ReorderResponse> & { error?: string }
  if (data.error) throw new Error(data.error)
  return {
    edits: Array.isArray(data.edits) ? data.edits : [],
    originals: data.originals ?? {},
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  }
}

// Probe whether an element's siblings can be reordered (host parent + host-only
// children) BEFORE showing the drag handle, so a non-reorderable run shows no
// handle (or a calm hint) instead of a drag that silently does nothing. Fails
// CLOSED on a transport error (no handle) — unlike museTextEditable's fail-open,
// because the handle needs the probe's `count` for its divergence guard, and a
// re-select simply re-probes. The engine still fails closed on any commit, so a
// missed handle is the safe failure, never a bad write.
export async function museReorderable(
  req: Omit<ReorderRequest, 'toIndex'>,
): Promise<Reorderable> {
  try {
    const res = await fetch(apiUrl('/api/muse/reorderable'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = (await res.json()) as {
      reorderable?: boolean
      count?: number
      children?: ReorderChild[]
      reason?: string
      error?: string
    }
    if (data.reorderable && Array.isArray(data.children)) {
      return { reorderable: true, count: data.count ?? data.children.length, children: data.children }
    }
    return { reorderable: false, reason: data.reason ?? data.error ?? 'not reorderable' }
  } catch {
    return { reorderable: false, reason: 'check failed' }
  }
}

export type DesignGet = { exists: boolean; content?: string; path?: string }

// Does the app have a design brief (DESIGN.md)? Drives the target-strip icon.
export async function museDesignGet(): Promise<DesignGet> {
  if (MOCK) return { exists: true, content: MOCK_DESIGN_MD, path: 'DESIGN.md' }
  const res = await fetch(apiUrl('/api/muse/design'))
  const data = (await res.json()) as DesignGet & { error?: string }
  if (data.error) throw new Error(data.error) // surface server errors, not a false "no brief"
  return data
}

// Generate a DESIGN.md from the app's code (concise). ~45s — caller shows a
// pending state. Returns the written brief.
export async function museDesignGenerate(): Promise<{ content: string; path?: string }> {
  if (MOCK) {
    await delay(1200)
    return { content: MOCK_DESIGN_MD, path: 'DESIGN.md' }
  }
  const res = await fetch(apiUrl('/api/muse/design/generate'), { method: 'POST' })
  const data = (await res.json()) as { content?: string; path?: string; error?: string }
  if (data.error || !data.content) throw new Error(data.error ?? 'Generation failed')
  return { content: data.content, path: data.path }
}

// A small sample brief for mock mode so the card renders without a backend.
const MOCK_DESIGN_MD = `---
name: Muse Design System
colors:
  brand: "#7f2f2f"
  paper: "#f7f4ee"
  ink: "#1c1917"
typography:
  display: { fontFamily: "Inter" }
  body: { fontFamily: "Inter" }
---

## Brand & Style
Warm and tool-like. One deep brick accent on a warm paper canvas, Inter throughout, fast easeOut motion.`

// =============================================================================
// Mock mode — credit-free dev iteration on the thread shell.
//
// What it does, in order:
//   1. Variable latency (400 / 800 / 1200ms) so the thinking bubble actually
//      lingers and the UI doesn't snap.
//   2. Classifies the latest user message into one of ~7 intent categories.
//   3. For most intents, proposes a confident edit (matching PR0's "almost
//      always: don't ask" rule). The diff is synthesized from the SELECTED
//      element's actual classNames + tag, so it looks like Muse really edited
//      your element.
//   4. Only for vague big asks ("redesign this hero", first turn only) does it
//      fire ask_clarifying_questions.
//   5. Each intent has 2–3 canned variations (different class mutations +
//      rationales), picked at random — so repeated tries don't loop.
//   6. After an apply, follow-up messages keep proposing variations instead of
//      bouncing back to ask.
//
// If a target has no fileName (unmappable), falls back to the original
// fxOriginals/fxEdits fixtures so the gallery and unmappable cases still work.
// =============================================================================

const MOCK_LATENCIES = [400, 800, 1200] as const
const pickOne = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randomDelay = () => delay(pickOne(MOCK_LATENCIES))

type Intent =
  | 'pop'         // make it stronger, louder, stand out
  | 'premium'     // refined, elegant, luxurious
  | 'simplify'    // remove, reduce, clean up
  | 'soften'      // calmer, quieter, more subtle
  | 'tighter'     // denser, more compact
  | 'spacious'    // more breathing room, airier
  | 'redesign-big'// vague large-scope ask — the rare "ask" case
  | 'generic'     // fall-through

function classifyIntent(text: string): Intent {
  const t = text.toLowerCase()
  if (/\b(redesign|overhaul|rebuild|start over|from scratch)\b/.test(t)) return 'redesign-big'
  if (/\b(pop|punch|punchier|bold|confident|stronger|louder|stand out|wow)\b/.test(t)) return 'pop'
  if (/\b(premium|luxury|luxurious|refined|elegant|sophisticat|high.?end|editorial|apple|stripe)\b/.test(t)) return 'premium'
  if (/\b(simpl|clean|less|reduce|strip|remove)\b/.test(t)) return 'simplify'
  if (/\b(tight|denser|compact|condens|smaller)\b/.test(t)) return 'tighter'
  if (/\b(spaci|breathing|airy|airier|loose|roomy|bigger)\b/.test(t)) return 'spacious'
  if (/\b(soft|calmer|calm|quiet|subtle|muted|tone.?down)\b/.test(t)) return 'soften'
  if (/\bminimal\b/.test(t)) return 'simplify'
  return 'generic'
}

/** A mock preset — a deterministic className transform + a rationale to match. */
type Preset = {
  mutate: (cls: string, tag: string) => string
  rationale: string
}

// Tiny mutation helpers ---------------------------------------------------
const dropClass = (cls: string, re: RegExp) => cls.replace(re, '').replace(/\s+/g, ' ').trim()
const addClass = (cls: string, add: string) =>
  cls.split(/\s+/).filter(Boolean).concat(add.split(/\s+/).filter(Boolean)).join(' ')
const swapClass = (cls: string, re: RegExp, to: string) =>
  re.test(cls) ? cls.replace(re, to) : ensure(cls, to)
const ensure = (cls: string, token: string) =>
  cls.split(/\s+/).includes(token) ? cls : addClass(cls, token)

// Per-intent preset libraries --------------------------------------------
const POP: Preset[] = [
  {
    rationale: 'Pushed the type weight and tracking — denser shape, stronger anchor. Dial it back if it shouts.',
    mutate: (cls, tag) => {
      let c = cls
      c = swapClass(c, /\bfont-(thin|extralight|light|normal|medium)\b/, 'font-bold')
      c = ensure(c, 'font-bold')
      c = swapClass(c, /\btracking-(wide|wider|widest|normal)\b/, 'tracking-tight')
      c = ensure(c, 'tracking-tight')
      if (tag === 'h1') c = swapClass(c, /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/, 'text-6xl')
      return c
    },
  },
  {
    rationale: 'Bigger, with a clearer ring around it — pulls the eye without changing the color story.',
    mutate: (cls) => {
      let c = ensure(cls, 'ring-2')
      c = ensure(c, 'ring-slate-900')
      c = ensure(c, 'shadow-md')
      return c
    },
  },
  {
    rationale: 'Filled accent with a denser type pairing — a touch more presence at the same scale.',
    mutate: (cls) => {
      let c = swapClass(cls, /\bbg-(white|slate|zinc|gray|stone)-(50|100|200)\b/, 'bg-slate-900')
      c = ensure(c, 'text-white')
      c = ensure(c, 'font-semibold')
      return c
    },
  },
]

const PREMIUM: Preset[] = [
  {
    rationale: 'Lighter weight, larger scale, tighter tracking — the Apple / Stripe register.',
    mutate: (cls, tag) => {
      let c = swapClass(cls, /\bfont-(bold|semibold|extrabold|black)\b/, 'font-light')
      c = ensure(c, 'tracking-tight')
      if (tag === 'h1' || tag === 'h2') c = swapClass(c, /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/, 'text-6xl')
      c = ensure(c, 'leading-tight')
      return c
    },
  },
  {
    rationale: 'More padding, softer corners, restrained color — the kind of button you only see on really good marketing sites.',
    mutate: (cls) => {
      let c = swapClass(cls, /\brounded-(none|sm|md|lg|xl|2xl)\b/, 'rounded-full')
      c = swapClass(c, /\bpx-\d+(\.\d+)?\b/, 'px-8')
      c = swapClass(c, /\bpy-\d+(\.\d+)?\b/, 'py-3.5')
      c = ensure(c, 'tracking-tight')
      return c
    },
  },
]

const SIMPLIFY: Preset[] = [
  {
    rationale: 'Stripped the ornament — borders, shadows, ring all gone. Only the essential shape remains.',
    mutate: (cls) => {
      let c = dropClass(cls, /\bshadow(-\w+)?(\/\d+)?\b/g)
      c = dropClass(c, /\bring(-\d+)?(-\w+)?(-\d+)?(\/\d+)?\b/g)
      c = dropClass(c, /\bborder(-\d+)?(-\w+)?(-\d+)?(\/\d+)?\b/g)
      return c
    },
  },
  {
    rationale: 'Pulled the size and weight down — same intent, less voice.',
    mutate: (cls, tag) => {
      let c = swapClass(cls, /\bfont-(bold|extrabold|black)\b/, 'font-medium')
      if (tag === 'h1') c = swapClass(c, /\btext-(4xl|5xl|6xl|7xl|8xl)\b/, 'text-3xl')
      c = dropClass(c, /\btracking-(wide|widest|wider)\b/)
      return c
    },
  },
]

const SOFTEN: Preset[] = [
  {
    rationale: 'Dropped the contrast — same shape, quieter voice. Reads as supporting, not headline.',
    mutate: (cls) => {
      let c = swapClass(cls, /\btext-(slate|zinc|gray|stone)-(900|800|700)\b/, 'text-slate-500')
      c = swapClass(c, /\btext-black\b/, 'text-slate-500')
      c = swapClass(c, /\bfont-(bold|semibold)\b/, 'font-normal')
      return c
    },
  },
]

const TIGHTER: Preset[] = [
  {
    rationale: 'Compacted the padding + tracking. Same hierarchy, denser footprint.',
    mutate: (cls) => {
      let c = swapClass(cls, /\bpx-\d+(\.\d+)?\b/, 'px-3')
      c = swapClass(c, /\bpy-\d+(\.\d+)?\b/, 'py-1.5')
      c = swapClass(c, /\btracking-(wide|wider|widest|normal)\b/, 'tracking-tight')
      c = ensure(c, 'tracking-tight')
      return c
    },
  },
]

const SPACIOUS: Preset[] = [
  {
    rationale: 'Opened up the spacing — more breathing room around the type. Reads as more confident, less crammed.',
    mutate: (cls) => {
      let c = swapClass(cls, /\bpx-\d+(\.\d+)?\b/, 'px-8')
      c = swapClass(c, /\bpy-\d+(\.\d+)?\b/, 'py-5')
      c = ensure(c, 'leading-relaxed')
      return c
    },
  },
]

const GENERIC: Preset[] = [
  {
    rationale: 'Refined the proportions a touch — slightly tighter tracking, more honest weight. Subtle.',
    mutate: (cls) => {
      let c = ensure(cls, 'tracking-tight')
      c = swapClass(c, /\bfont-bold\b/, 'font-semibold')
      return c
    },
  },
  {
    rationale: 'Tightened the padding ratio and unified the rounding. Minor adjustment — should read more considered.',
    mutate: (cls) => {
      let c = swapClass(cls, /\brounded-(sm|md)\b/, 'rounded-lg')
      c = swapClass(c, /\bpy-\d+\b/, 'py-3')
      return c
    },
  },
]

const INTENT_PRESETS: Record<Exclude<Intent, 'redesign-big'>, Preset[]> = {
  pop: POP,
  premium: PREMIUM,
  simplify: SIMPLIFY,
  soften: SOFTEN,
  tighter: TIGHTER,
  spacious: SPACIOUS,
  generic: GENERIC,
}

// Short option labels per intent, zipped positionally with that intent's
// presets. Each preset becomes one hoverable option card.
const OPTION_LABELS: Record<Exclude<Intent, 'redesign-big'>, string[]> = {
  pop: ['Heavier', 'Outlined', 'Filled'],
  premium: ['Refined', 'Tailored'],
  simplify: ['Stripped', 'Quieter'],
  soften: ['Muted'],
  tighter: ['Compact'],
  spacious: ['Airy'],
  generic: ['Considered', 'Tidied'],
}

const INTENT_LEADIN: Record<Exclude<Intent, 'redesign-big'>, string> = {
  pop: 'A few ways to give it more presence — hover to preview, click to apply.',
  premium: 'Two takes on a more premium feel — hover to see each in place.',
  simplify: 'A couple of ways to pare it back — hover to preview.',
  soften: 'Quieter, more supporting — hover to preview.',
  tighter: 'Denser and more compact — hover to preview.',
  spacious: 'More breathing room — hover to preview.',
  generic: 'A couple of small refinements — hover to preview.',
}

// Clarifying questions for the rare ASK path -----------------------------
const REDESIGN_QUESTION: ClarifyingQuestion = {
  question: "Big scope. Which direction should it take?",
  options: [
    {
      label: 'Editorial & quiet',
      description: 'Lots of breathing room, restrained color, serif feel. The Stripe / Linear register.',
    },
    {
      label: 'Punchy & loud',
      description: 'High contrast, dense type, confident accents. Vercel / Cursor energy.',
    },
    {
      label: 'Playful & warm',
      description: 'Rounded shapes, warmer palette, looser proportions. Notion / Linear-y.',
    },
  ],
}

// Snippet synthesis ------------------------------------------------------
// Build a minimal "before" snippet around the user's actual selected element
// so the diff reads as though Muse edited THEIR element, not a fixture.
function snippetFor(target: SelectedElement, classNames: string): string {
  const text = (target.text || '...').slice(0, 60)
  const indent = '      '
  return `${indent}<${target.tag} className="${classNames}">\n${indent}  ${text}\n${indent}</${target.tag}>`
}

// Pick a file key the way the runChat allowlist will accept — must match the
// originals key exactly (server sends relative forward-slashed paths).
function fileKeyFor(target: SelectedElement): string | null {
  if (!target.fileName) return null
  return target.fileName.replace(/\\/g, '/').replace(/^\.\//, '')
}

// Build one option's edits by applying a preset to each (de-duped by file)
// target, synthesizing a before/after snippet around the real element. Returns
// the edits plus the shared `originals` (the "before" is preset-independent).
function buildOptionEdits(
  byFile: Map<string, SelectedElement>,
  preset: Preset,
): { edits: FileEdit[]; originals: Record<string, string> } {
  const originals: Record<string, string> = {}
  const edits: FileEdit[] = []
  for (const [key, t] of byFile) {
    originals[key] = snippetFor(t, t.classNames || '')
    edits.push({ fileName: key, newContent: snippetFor(t, preset.mutate(t.classNames || '', t.tag)) })
  }
  return { edits, originals }
}

function mockProposeOptions(
  targets: SelectedElement[],
  intent: Exclude<Intent, 'redesign-big'>,
): ChatResponse {
  const usable = targets.filter((t) => fileKeyFor(t))
  if (usable.length === 0) {
    // Unmappable (gallery / source-not-found): fall back to canned fixtures as
    // a single option so the flow still renders.
    return {
      content: [
        {
          type: 'tool_use',
          id: 'mock-opt-' + Math.random().toString(36).slice(2, 8),
          name: 'propose_options',
          input: {
            rationale: GENERIC[0].rationale,
            options: [{ id: 'opt-0', label: 'Refined', description: GENERIC[0].rationale, edits: fxEdits }],
          },
        },
      ],
      originals: fxOriginals,
    }
  }

  // One target per file (a batch edits one element per file).
  const byFile = new Map<string, SelectedElement>()
  for (const t of usable) {
    const key = fileKeyFor(t)!
    if (!byFile.has(key)) byFile.set(key, t)
  }

  const presets = INTENT_PRESETS[intent].slice(0, 3)
  const labels = OPTION_LABELS[intent]
  const mergedOriginals: Record<string, string> = {}
  const options = presets.map((preset, i) => {
    const { edits, originals } = buildOptionEdits(byFile, preset)
    Object.assign(mergedOriginals, originals) // shared "before" across options
    return {
      id: `opt-${i}`,
      label: labels[i] ?? `Option ${i + 1}`,
      description: preset.rationale,
      edits,
    }
  })

  return {
    content: [
      {
        type: 'tool_use',
        id: 'mock-opt-' + Math.random().toString(36).slice(2, 8),
        name: 'propose_options',
        input: { rationale: INTENT_LEADIN[intent], options },
      },
    ],
    originals: mergedOriginals,
  }
}

function mockAsk(): ChatResponse {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'mock-ask-' + Math.random().toString(36).slice(2, 8),
        name: 'ask_clarifying_questions',
        input: { questions: [REDESIGN_QUESTION] },
      },
    ],
    // For the ask path we don't have an edit yet, but runChat expects an
    // originals map — use the canned fixtures as a placeholder. The follow-up
    // propose call (after answering) will replace them.
    originals: fxOriginals,
  }
}

// Pull out the most recent user-authored text for intent classification.
// Handles both plain-string messages and tool_result wrappers.
function latestUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        const block = c as { type?: string; content?: unknown }
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          return block.content
        }
      }
    }
  }
  return ''
}

// Has any prior assistant turn already proposed an edit? If yes, follow-ups
// keep proposing — don't bounce back to clarifying questions.
function alreadyProposedOnce(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        const block = c as { type?: string; name?: string }
        if (block.type === 'tool_use' && (block.name === 'propose_options' || block.name === 'propose_edit'))
          return true
      }
    }
  }
  return false
}

async function mockChat(targets: SelectedElement[], messages: ChatMessage[]): Promise<ChatResponse> {
  await randomDelay()

  const text = latestUserText(messages)
  const intent = classifyIntent(text)

  // The one "ask" case: a vague big-scope ask on the very first turn. Once
  // we've already proposed at least once, even a vague follow-up should keep
  // proposing variations rather than asking again — matches PR0 voice rules.
  if (intent === 'redesign-big' && !alreadyProposedOnce(messages)) {
    return mockAsk()
  }

  // Offer the intent's directions as hoverable options (fall through to generic).
  const intentForPresets: Exclude<Intent, 'redesign-big'> =
    intent === 'redesign-big' ? 'generic' : intent
  return mockProposeOptions(targets, intentForPresets)
}

// Mock observation — stands in for /api/muse/observe with no credits. Grounds
// the read in a REAL class token off the element so it reads like Muse actually
// looked, and so it visibly differs from the synchronous heuristic it replaces.
// Chips reuse the heuristic's (already tag-aware). Slight delay so the swap is
// perceptible in the demo.
const NOTABLE_CLASS = [
  /\btext-(4xl|5xl|6xl|7xl|8xl|9xl)\b/,
  /\bfont-(thin|light|normal|medium|semibold|bold|extrabold|black)\b/,
  /\b(rounded(-\w+)?|rounded-full)\b/,
  /\bshadow(-\w+)?\b/,
  /\bbg-[\w/-]+\b/,
  /\btracking-(tight|wide|wider|widest)\b/,
  /\bp[xy]?-\d+(\.\d+)?\b/,
] as const

function notableToken(cls: string): string | null {
  for (const re of NOTABLE_CLASS) {
    const m = cls.match(re)
    if (m) return m[0]
  }
  const first = cls.split(/\s+/).filter(Boolean)[0]
  return first ?? null
}

async function mockObserve(target: SelectedElement): Promise<ObserveResult> {
  await delay(700)
  const { chips } = heuristicObservation(target)
  const token = notableToken(target.classNames || '')
  const observation = token
    ? `That ${token} is setting the tone here — worth deciding if it's pulling its weight.`
    : `A bare <${target.tag || 'element'}> with almost no styling — a blank canvas, basically.`
  return { observation, chips }
}

