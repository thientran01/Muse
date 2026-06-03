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

// A measured viewport rect — what the hover/selection overlays draw against.
export type Rect = { top: number; left: number; width: number; height: number }

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
  // 'element' (default) edits this element; 'const' rewrites the shared
  // `const X = {…}` an element's `style={X}` points at, changing every instance.
  scope?: 'element' | 'const'
}

// A target whose style is `style={X}` where X is a static same-file const — surfaced
// so the client can offer to edit X's definition (all instances), not just this one.
// `sameFileCount` is the exact blast radius when `exported` is false; when exported the
// const escapes the file, so a count would understate it.
export type SharedConst = { name: string; sameFileCount: number; exported: boolean }

// The endpoint's reply: computed file rewrites + their pre-edit contents (for
// undo) + any non-fatal warnings (dynamic className fallbacks, skips).
export type StyleEditResponse = {
  edits: FileEdit[]
  originals: Record<string, string>
  warnings: string[]
  // Present when the edited element's style is a shared const (see SharedConst).
  sharedConst?: SharedConst
}

// A request to /api/muse/text-edit: which element, and its new text content.
export type TextEditRequest = {
  fileName: string
  line: number
  column: number
  tag?: string
  classNames?: string
  text: string // the NEW text content
  // The element's rendered text BEFORE the edit. Sent so a prop-text edit (`{prop}`
  // whose literal lives at a usage site) can disambiguate WHICH usage to rewrite.
  originalText?: string
}
export type TextEditResponse = StyleEditResponse

// --- Reorder (drag-to-reorder siblings) ---
// One movable sibling the probe reports, so the client can confirm the live DOM
// children line up 1:1 with the source children before trusting an index.
export type ReorderChild = { index: number; tag: string; classNames: string | null }

// The /api/muse/reorderable probe result: can this element's siblings be
// reordered? (host parent + host-only children) — mirrors the text-editable probe.
export type Reorderable =
  | { reorderable: true; count: number; children: ReorderChild[] }
  | { reorderable: false; reason: string }

// A request to /api/muse/reorder: move this element to insertion slot `toIndex`
// among its siblings (the source-order position it lands BEFORE; count === end).
export type ReorderRequest = {
  fileName: string
  line: number
  column: number
  tag?: string
  classNames?: string
  toIndex: number
}
export type ReorderResponse = StyleEditResponse

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
  // EPHEMERAL (demo) only: DOM snapshots so an applied chat edit persists in the
  // browser and undo/redo replays it, since there's no source write/HMR. Each
  // entry holds a live node + its className/cssText before and after the apply.
  dom?: Array<{ node: HTMLElement; before: string; after: string; beforeStyle: string; afterStyle: string }>
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
  // A quiet acknowledgement that the user undid / redid / reverted, so the thread
  // narrates history actions instead of leaving the change unexplained. `label`
  // names the change for undo/redo (the option/Canvas-edit label); revert has none.
  | { id: string; kind: 'history'; action: 'undo' | 'redo' | 'revert'; label?: string }
  // The app's design system (DESIGN.md). `offer` → no brief yet, prompt to make
  // one; `generating` → the LLM is writing it; `view` → show the brief (content set).
  | { id: string; kind: 'design'; status: 'offer' | 'generating' | 'view'; content?: string; path?: string }
