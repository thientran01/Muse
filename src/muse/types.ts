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

// One deterministic style change, in the shared property vocabulary. `variant`
// targets a Tailwind variant chain, colon-joined without the trailing colon
// ('hover', 'md', 'dark:hover'); absent/'' = the base value. Variant edits are
// Tailwind-class-only — the engine refuses them on the inline / CSS-var /
// CSS-module / styled routes with a warning instead of writing a value that
// would apply at every state.
export type StyleMutation = { property: StyleProperty; value: string; variant?: string }

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
  // The freeform class field's verbatim add/remove — may ride alone (mutations
  // empty). Removes match whole tokens exactly (variants included); every added
  // token must pass isSafeClassToken (the server re-validates).
  classPatch?: { add: string[]; remove: string[] }
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

// --- Flags (shift-click / refusal annotation → MCP handoff) ---
// What the client CAPTURES and POSTs to /api/muse/flag. No id/status/timestamps —
// the server assigns those. `fileName` is absolute (from _debugSource / data-muse-loc);
// the server validates it under src/ and converts to a repo-relative `file` before
// persisting. `property`/`reason` are present only for flags born from a Canvas refusal.
export type FlagDraft = {
  fileName: string
  line: number
  column: number
  tag: string
  className: string
  text: string
  comment: string // the user's plain-English intent
  property?: string // refusal flags: which property they reached for (e.g. 'marginTop')
  reason?: string // refusal flags: why Canvas refused
}

export type FlagStatus = 'open' | 'resolved'

// A PERSISTED flag — the `.muse/flags.json` contract, also what GET /api/muse/flags
// returns and what muse-mcp exposes to the user's Claude Code. `file` is repo-relative
// (portable: Claude Code works from the repo root). Location is captured at flag-time
// and may DRIFT after later edits — `id` is the stable handle (a pin may orphan; the
// panel + the work-order survive regardless).
export type Flag = {
  id: string // monotonic, e.g. 'f_3' (stable; location drifts, id doesn't)
  comment: string
  status: FlagStatus
  file: string // repo-relative
  line: number
  column: number
  tag: string
  className: string
  text: string
  property?: string
  reason?: string
  createdAt: string
  resolvedAt: string | null
  resolution: string | null // the agent's note, written via resolve_flag
}

// The on-disk shape of `.muse/flags.json`. `nextId` is a monotonic counter so ids stay
// stable even as flags are deleted. Shared by the dev-server backend (the single writer)
// and the read-only muse-mcp server.
export type FlagsFile = { version: 1; nextId: number; flags: Flag[] }

// --- Share changes (session edits → branch/commit/PR, no checkout) ---
// The share pipeline never touches the user's working tree, index, or checked-out
// branch — it builds a commit with git plumbing against a temporary index and only
// ever writes fresh `muse/*` refs. See server/gitShare.ts.

export type ShareRemote = { url: string; host: 'github' | 'other'; owner?: string; repo?: string }

// What POST /api/muse/share-probe reports. Fail-closed: the client renders the Share
// button only on `available: true` (a missing git / repo / commit each gets a
// designer-readable reason instead of an action that errors after the click).
export type ShareProbe =
  | {
      available: true
      branch: string | null // checked-out branch (null when detached)
      detached: boolean
      remote: ShareRemote | null
      ghAvailable: boolean
      defaultBranch: string | null
      hasIdentity: boolean // git user.email configured (share falls back when not)
      dirtyOtherCount: number // non-session dirty files — informational, never blocks
    }
  | { available: false; reason: string }

// One session-touched file + the human edit labels that touched it ("padding 8px").
// Labels feed the deterministic commit message / PR body — no inference anywhere.
export type ShareChange = { fileName: string; labels: string[] }

export type ShareRequest = {
  files: string[] // root-relative session-touched paths (the client's undo-reconciled set)
  changes: ShareChange[]
  slugHint?: string // first edit label, for the branch name
  branch?: string // continue this session's earlier share branch (append a commit)
}

// Degradations (no remote, push auth failure, no gh) are warnings on ok:true —
// the local branch is the success floor.
export type ShareResult =
  | {
      ok: true
      branch: string
      commit: string
      pushed: boolean // pushed by THIS call (alreadyShared replies are pushed:false even if a prior share uploaded)
      prUrl?: string
      compareUrl?: string
      alreadyShared?: boolean
      warnings: string[]
    }
  | { ok: false; error: string }

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
