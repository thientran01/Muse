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
  // The element's CURRENT rendered text. Sent so a prop-text edit (`{prop}` whose literal
  // lives at a usage site) can disambiguate WHICH usage to rewrite. Same field name the
  // editability probe uses for the same value (see museTextEditable) — one concept, one name.
  renderedText?: string
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
  // CONTAINER mode: when present, fileName/line/column address the host CONTAINER and
  // we move ITS child at `fromIndex` (the only way to reorder COMPONENT children, whose
  // DOM node points into the component, not at its usage site). Absent → child mode.
  fromIndex?: number
}
export type ReorderResponse = StyleEditResponse

// A computed file rewrite: the new full contents the server should write to disk.
export type FileEdit = { fileName: string; newContent: string }

// One applied batch — covers every file changed in a single apply, so undo/redo
// restores the whole multi-file change as a unit.
export type HistoryEntry = {
  files: Array<{ fileName: string; before: string; after: string }>
  // Elements selected when the edit was applied (the Canvas target). Carried for
  // labelling/symmetry with multi-file edits.
  elements: SelectedElement[]
  label: string
}
