// Shared types for the Muse overlay <-> backend.
import type { StyleProperty } from './style/properties'
export type { StyleProperty } from './style/properties'

export type SelectedElement = {
  fileName: string // absolute path from React _debugSource
  line: number
  tag: string
  classNames: string
  text: string
  key: string // stable id for dedupe / badges (fileName:line:col:tag)
  node?: Element // client-only: live DOM node for drawing outlines/badges (never sent to backend)
}

// --- Canvas Mode (direct manipulation) ---
// An element resolved for deterministic editing: like SelectedElement but always
// carries the column too (the style editor disambiguates several JSX elements on
// one line by column).
export type CanvasElement = {
  fileName: string
  line: number
  column: number
  tag: string
  key: string // fileName:line:col:tag
  node: HTMLElement
}

// One deterministic style change, in the shared property vocabulary.
export type StyleMutation = { property: StyleProperty; value: string }

// How a value is written: prefer Tailwind utilities, or always inline style.
// Mirrors StyleStrategy in server/styleEdit.ts.
export type StyleStrategy = 'tailwind-first' | 'inline'

// A request to the /api/muse/style-edit endpoint: which element, which changes.
export type StyleEditRequest = {
  fileName: string
  line: number
  column: number
  // DOM tag + resolved class attribute of the target. The server uses them (with
  // column) to locate the element even when a dev transform has shifted
  // _debugSource line numbers. See locateOpening in server/styleEdit.ts.
  tag?: string
  classNames?: string
  mutations: StyleMutation[]
}

// The endpoint's reply: computed file rewrites + their pre-edit contents (for
// undo) + any non-fatal warnings (dynamic className fallbacks, skips).
export type StyleEditResponse = {
  edits: FileEdit[]
  originals: Record<string, string>
  warnings: string[]
}

// --- Tool I/O (mirrors the schemas in server/musePlugin.ts) ---
export type QuestionOption = { label: string; description: string }
export type ClarifyingQuestion = { question: string; options: QuestionOption[] }
export type AskInput = { questions: ClarifyingQuestion[] }

export type FileEdit = { fileName: string; newContent: string }
export type ProposeInput = { edits: FileEdit[]; rationale: string }

// A single design direction Muse proposes. Each option is a complete, applyable
// edit (one or more full-file rewrites). Multiple options let the user hover to
// preview each take on the live element, then click the one they want.
export type ProposedOption = {
  id: string
  label: string // short name — "Editorial", "Punchy"
  description: string // one-line pitch for a non-technical user
  edits: FileEdit[]
}
export type ProposeOptionsInput = { rationale: string; options: ProposedOption[] }

// --- Observation opener (POST /api/muse/observe) ---
// A one-line read of a freshly-selected element + 3 tag-aware starter prompts.
// Rendered as the opener of every new target context.
export type ObserveResult = { observation: string; chips: string[] }

// --- Anthropic content blocks (the subset we care about) ---
export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: 'ask_clarifying_questions' | 'propose_edit' | 'propose_options'
  input: unknown
}
export type ContentBlock = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown }

export type ChatResponse = {
  content?: ContentBlock[]
  stop_reason?: string
  originals?: Record<string, string> // fileName -> original contents, for diffing
  error?: string
}

// One applied batch — covers every file changed in a single apply, so undo/redo
// restores the whole multi-file change as a unit.
export type HistoryEntry = {
  files: Array<{ fileName: string; before: string; after: string }>
  // Elements selected when the edit was applied — restored on undo/redo so the
  // panel reopens ready for follow-up edits.
  elements: SelectedElement[]
  label: string
}

// Anthropic message shape we send back and forth.
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'user'; content: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> }
  | { role: 'assistant'; content: ContentBlock[] }

// --- Thread render model (UI-facing) ---
// The thread is the timeline of bubbles shown in the panel. It runs parallel
// to `messages` (the Anthropic-facing transcript): every meaningful event the
// user should *see* becomes a ThreadMessage, even ones that don't appear in
// the transcript (target handoffs, applied confirmations, errors).
//
// Bubbles are append-only history; the most recent `clarify` / `option-set`
// is the "active" one (renders its action UI) — older ones freeze when a
// new turn moves past them.
export type ThreadMessage =
  | { id: string; kind: 'user'; text: string }
  | {
      id: string
      kind: 'observation'
      // The element this opener is about. Carried in full (not just its key) so
      // clicking one of its starter chips can re-target Muse to THIS element,
      // even if the active target has since moved on.
      target: SelectedElement
      observation: string
      chips: string[]
      // True while the instant heuristic is showing and the LLM read is still
      // in flight; flips false when the read lands (or the fetch gives up).
      pending: boolean
    }
  | {
      id: string
      kind: 'clarify'
      toolUseId: string
      questions: ClarifyingQuestion[]
      // Frozen snapshot of the user's answers, captured the moment this
      // clarify stops being active (next turn fires). Inactive rendering
      // reads from here instead of the live store map, which gets cleared
      // for the next clarify.
      answeredWith?: Record<number, string>
    }
  | { id: string; kind: 'option-set'; toolUseId: string; options: ProposedOption[]; rationale: string }
  | { id: string; kind: 'applied'; fileCount: number; rationale: string }
  | { id: string; kind: 'target-handoff'; target: SelectedElement }
  | { id: string; kind: 'error'; text: string }
  // The app's design system (DESIGN.md). `offer` → no brief yet, prompt to make
  // one; `generating` → the LLM is writing it; `view` → show the brief (content set).
  | { id: string; kind: 'design'; status: 'offer' | 'generating' | 'view'; content?: string; path?: string }
