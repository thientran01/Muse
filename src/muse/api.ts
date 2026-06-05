import { EPHEMERAL, MOCK, getApiBase } from './config'
import type {
  FileEdit,
  Flag,
  FlagDraft,
  Reorderable,
  ReorderChild,
  ReorderRequest,
  ReorderResponse,
  SharedConst,
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

// Probe whether a selected element's style is a shared same-file const (`style={X}`),
// so Canvas can show the "this element / all uses" scope toggle BEFORE a scrub. Fails
// CLOSED (no toggle) on transport error — the per-element commit is always available.
export async function museStyleScope(
  req: Omit<StyleEditRequest, 'mutations' | 'scope'>,
): Promise<SharedConst | null> {
  if (EPHEMERAL) return null // no backend; const-scope edits need a real write
  try {
    const res = await fetch(apiUrl('/api/muse/style-scope'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = (await res.json()) as { sharedConst?: SharedConst | null }
    return data.sharedConst ?? null
  } catch {
    return null
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

// Probe whether an element's text is editable BEFORE entering edit mode, so data-bound
// text shows a calm hint instead of a bounce. `renderedText` carries the element's CURRENT
// rendered text so the server can resolve a prop-text trace (a `{prop}` whose literal lives
// at a usage site) and report it editable — the same field the edit sends for the same value.
export async function museTextEditable(
  req: Omit<TextEditRequest, 'text' | 'renderedText'> & { renderedText?: string },
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
  // `container: true` probes whether the host CONTAINER at this location can have ITS
  // children reordered (component children included) — used for component instances,
  // whose own DOM node can't be located in source.
  req: Omit<ReorderRequest, 'toIndex' | 'fromIndex'> & { container?: boolean },
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

// A host design token (CSS custom property) surfaced for the token panel.
export type DesignToken = { name: string; value: string; isColor: boolean; file: string }

// The host's design tokens (CSS custom properties under src/), for the token panel.
export async function museTokens(): Promise<DesignToken[]> {
  if (MOCK) return MOCK_TOKENS
  if (EPHEMERAL) return [] // no backend to read the host stylesheet
  const res = await fetch(apiUrl('/api/muse/tokens'))
  const data = (await res.json()) as { tokens?: DesignToken[]; error?: string }
  if (data.error) throw new Error(data.error)
  return Array.isArray(data.tokens) ? data.tokens : []
}

// Set a token's base value in the stylesheet that defines it. Returns the same
// { edits, originals } contract as canvas edits, so the caller writes + records history.
export async function museTokenEdit(name: string, value: string): Promise<StyleEditResponse> {
  if (MOCK || EPHEMERAL) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/token-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, value }),
  })
  const data = (await res.json()) as Partial<StyleEditResponse> & { error?: string }
  if (data.error) throw new Error(data.error)
  return { edits: data.edits ?? [], originals: data.originals ?? {}, warnings: data.warnings ?? [] }
}

// --- Flags (shift-click / refusal → MCP handoff) ---------------------------------
// The dev-server backend persists flags to .muse/flags.json (the single writer); the
// user's own Claude Code reads them via muse-mcp. NO inference runs through Muse.
//
// EPHEMERAL / MOCK (the hosted demo) has no backend — flags live in this module-level
// array so capture + the panel still demo. The MCP handoff is a local-dev-only payoff
// (the hosted demo can't run Claude Code), documented as such.
let ephemeralFlags: Flag[] = []
let ephemeralNextId = 1

export async function museListFlags(): Promise<Flag[]> {
  if (EPHEMERAL || MOCK) return [...ephemeralFlags]
  const res = await fetch(apiUrl('/api/muse/flags'))
  const data = (await res.json()) as { flags?: Flag[]; error?: string }
  if (data.error) throw new Error(data.error)
  return Array.isArray(data.flags) ? data.flags : []
}

export async function museAddFlag(draft: FlagDraft): Promise<Flag> {
  if (EPHEMERAL || MOCK) {
    const flag: Flag = {
      id: `f_${ephemeralNextId++}`,
      comment: draft.comment.trim(),
      status: 'open',
      file: draft.fileName, // no root to make repo-relative in the browser-only demo
      line: draft.line,
      column: draft.column,
      tag: draft.tag,
      className: draft.className,
      text: draft.text,
      property: draft.property,
      reason: draft.reason,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null,
    }
    ephemeralFlags.push(flag)
    return flag
  }
  const res = await fetch(apiUrl('/api/muse/flag'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
  const data = (await res.json()) as { ok?: boolean; flag?: Flag; error?: string }
  if (data.error || !data.flag) throw new Error(data.error ?? 'Could not save the flag.')
  return data.flag
}

export async function museResolveFlag(id: string, note?: string): Promise<void> {
  if (EPHEMERAL || MOCK) {
    const f = ephemeralFlags.find((x) => x.id === id)
    if (f) {
      f.status = 'resolved'
      f.resolvedAt = new Date().toISOString()
      f.resolution = note ?? null
    }
    return
  }
  const res = await fetch(apiUrl('/api/muse/flag-resolve'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, note }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (data.error) throw new Error(data.error)
}

export async function museDeleteFlag(id: string): Promise<void> {
  if (EPHEMERAL || MOCK) {
    ephemeralFlags = ephemeralFlags.filter((x) => x.id !== id)
    return
  }
  const res = await fetch(apiUrl('/api/muse/flag-delete'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (data.error) throw new Error(data.error)
}

const MOCK_TOKENS: DesignToken[] = [
  { name: '--c-energy', value: '#7f2f2f', isColor: true, file: 'src/index.css' },
  { name: '--c-pop', value: '#e07b4f', isColor: true, file: 'src/index.css' },
  { name: '--c-paper', value: '#f7f4ee', isColor: true, file: 'src/index.css' },
  { name: '--radius-lg', value: '16px', isColor: false, file: 'src/index.css' },
]
