import { isEphemeral, isMock, getApiBase } from './config'
import { walkCssRules } from './cssom'
import { listCssVars, looksLikeColor } from './style/cssVarEdit'
import type {
  FileEdit,
  Flag,
  FlagDraft,
  Reorderable,
  ReorderChild,
  ReorderRequest,
  ReorderResponse,
  SharedConst,
  ShareProbe,
  ShareRequest,
  ShareResult,
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

// Read a response body as JSON, turning a NON-JSON body into a sentence a designer
// can act on. Every handler here answers in JSON, so a body that isn't JSON means
// the request never reached Muse — a host framework's own 404 page, a proxy error,
// a login redirect. `res.json()` reports that as `JSON.parse: unexpected character
// at line 1 column 1`, and CanvasMode pipes a raw exception message straight into
// its toast (`setError((e as Error).message)`), so that string is what the user
// saw on the live case study. The status code is kept because it's the one piece
// of the original failure that's actually diagnostic.
//
// Only for the calls that let a throw reach the UI. The probe-style calls wrap
// their parse in a try/catch with a designed fallback already — routing those
// through here would swap one swallowed error for another.
export async function parseJson<T>(res: Response): Promise<T> {
  let body: string
  try {
    // Inside the try on purpose: reading the body can itself reject (an aborted
    // fetch, a stream error mid-download, an already-consumed body). Left outside,
    // that rejection reaches setError() raw — the same unreadable-toast failure
    // this helper exists to prevent, just with a different trigger.
    body = await res.text()
  } catch {
    throw new Error(
      `The Muse backend's response could not be read (HTTP ${res.status}). ` +
        `The connection may have dropped mid-request.`,
    )
  }
  try {
    return JSON.parse(body) as T
  } catch {
    // Same shape as src/site/feedback.ts: the raw detail goes to the console for
    // whoever is debugging, the user gets a sentence.
    console.error('[muse] non-JSON response:', res.status, body.slice(0, 200))
    throw new Error(
      `The Muse backend returned a non-JSON response (HTTP ${res.status}). ` +
        `Check that the Muse middleware is installed and serving /api/muse/* on this host.`,
    )
  }
}

export async function museWrite(files: FileEdit[]): Promise<void> {
  if (isMock() || isEphemeral()) {
    await delay(isMock() ? 300 : 0) // no real disk change in mock/ephemeral mode
    return
  }

  const res = await fetch(apiUrl('/api/muse/write'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  const data = await parseJson<{ ok?: boolean; error?: string }>(res)
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
  if (isEphemeral()) return { edits: [], originals: {}, warnings: [] }
  // Omitting `strategy` lets the server detect it from the host project (Tailwind →
  // utility classes, else inline). JSON.stringify drops the key when undefined.
  const res = await fetch(apiUrl('/api/muse/style-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: requests, strategy }),
  })
  const data = await parseJson<Partial<StyleEditResponse> & { error?: string }>(res)
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
  if (isEphemeral()) return null // no backend; const-scope edits need a real write
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
  if (isEphemeral()) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/text-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: requests }),
  })
  const data = await parseJson<Partial<TextEditResponse> & { error?: string }>(res)
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
  if (isEphemeral()) return { editable: true } // in-browser edits are always reversible
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
  if (isEphemeral()) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/reorder'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: [req] }),
  })
  const data = await parseJson<Partial<ReorderResponse> & { error?: string }>(res)
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
  // Backstop in case a path reaches here — CanvasMode answers the demo case itself,
  // from the live DOM, and returns before calling this. Deliberately NOT the shape
  // that branch produces: it can afford to fail OPEN (an in-browser move can't
  // corrupt a file), and it has the parent element this module doesn't. So the
  // honest answer at THIS layer is "no", not a fabricated child list.
  // If you ever delete CanvasMode's ephemeral branch expecting this to cover it,
  // the demo loses its drag handle — move that DOM logic here first.
  if (isEphemeral()) return { reorderable: false, reason: 'demo mode answers this from the DOM' }
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

// Probe whether the session can be shared as a branch/PR (git present, repo, commits…)
// BEFORE rendering the Share button — fails CLOSED with a designer-readable reason on
// any transport error, and short-circuits in the demo modes (no backend, nothing real
// to share) so the panel explains itself instead of offering a doomed action.
export async function museShareProbe(files: string[]): Promise<ShareProbe> {
  if (isMock() || isEphemeral()) {
    return { available: false, reason: 'Demo mode edits live in the browser only — run Muse with its backend to share changes.' }
  }
  try {
    const res = await fetch(apiUrl('/api/muse/share-probe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    })
    const data = (await res.json()) as Partial<ShareProbe> | null
    if (data && (data.available === true || data.available === false)) return data as ShareProbe
    return { available: false, reason: 'Couldn’t check the repository.' }
  } catch {
    return { available: false, reason: 'Couldn’t reach the Muse backend.' }
  }
}

// Turn the session's touched files into a muse/* branch (+ push + PR when possible).
// Deterministic server pipeline — see server/gitShare.ts. Never throws: every failure
// arrives as ok:false with a plain-words error the panel can show. The body is read
// regardless of HTTP status (validation 400s carry the same ShareResult shape) — the
// ok discriminator is the contract, so don't add a !res.ok guard here.
export async function museShare(req: ShareRequest): Promise<ShareResult> {
  if (isMock() || isEphemeral()) {
    return { ok: false, error: 'Demo mode edits live in the browser only — run Muse with its backend to share changes.' }
  }
  try {
    const res = await fetch(apiUrl('/api/muse/share'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = (await res.json()) as Partial<ShareResult> | null
    if (data && (data.ok === true || data.ok === false)) return data as ShareResult
    return { ok: false, error: 'Sharing failed unexpectedly.' }
  } catch {
    return { ok: false, error: 'Couldn’t reach the Muse backend.' }
  }
}

// A host design token (CSS custom property) surfaced for the token panel.
export type DesignToken = { name: string; value: string; isColor: boolean; file: string }

// The host's design tokens (CSS custom properties under src/), for the token panel.
export async function museTokens(): Promise<DesignToken[]> {
  // No backend in the demo modes — read the page's REAL tokens from the live
  // CSSOM instead of a canned fixture (a fixture silently drifts every time the
  // site's tokens change; the old one predated and hid the strategy-zoo tokens).
  if (isMock() || isEphemeral()) return readCssomTokens()
  const res = await fetch(apiUrl('/api/muse/tokens'))
  const data = await parseJson<{ tokens?: DesignToken[]; error?: string }>(res)
  if (data.error) throw new Error(data.error)
  return Array.isArray(data.tokens) ? data.tokens : []
}

// Root-scoped rules are where design tokens live (`:root { … }`, `html.dark { … }`).
// Restricting the scan to them keeps Tailwind's per-utility internals (--tw-*,
// declared on utility classes) out of the panel.
const ROOT_RULE_RE = /(^|,)\s*(:root|html)\b/i

// The same token model the server's /tokens endpoint builds, derived from the
// page's loaded stylesheets: walk same-origin sheets in document order, run each
// root-scoped rule's cssText through the SAME listCssVars parser the server uses,
// first definition wins (the base value, before any `html.dark` override — sheets
// author :root first), Muse's own --muse-* excluded. An inline override on <html>
// is a prior demo edit from this session (applyLive IS the persistence in
// MOCK/EPHEMERAL), so it reads back as the current value.
function readCssomTokens(): DesignToken[] {
  const seen = new Set<string>()
  const tokens: DesignToken[] = []
  const visitedSheets = new Set<CSSStyleSheet>()

  // Harvest one root-scoped rule's vars. First definition wins — sheets author
  // `:root` before any `html.dark` override — and Muse's own --muse-* are excluded.
  // An inline override on <html> is a prior demo edit from this session, so it
  // reads back as the current value.
  const harvest = (rule: CSSStyleRule, file: string) => {
    if (!ROOT_RULE_RE.test(rule.selectorText)) return
    for (const v of listCssVars(rule.cssText)) {
      if (seen.has(v.name) || v.name.startsWith('--muse-')) continue
      seen.add(v.name)
      const override = document.documentElement.style.getPropertyValue(v.name).trim()
      const value = override || v.value
      tokens.push({ name: v.name, value, isColor: looksLikeColor(value), file })
    }
  }

  const walkSheet = (sheet: CSSStyleSheet) => {
    if (visitedSheets.has(sheet)) return // @import cycles
    visitedSheets.add(sheet)
    try {
      // cssRules throws cross-origin; a weird href (blob:, constructed sheet)
      // could trip the URL parse — either way, skip the sheet, never the panel.
      const file = sheet.href ? (new URL(sheet.href).pathname.split('/').pop() ?? 'stylesheet') : 'page styles'
      // THE TRAVERSAL IS SHARED, and that is the actual fix.
      //
      // This function used to hand-roll its own walk that tested `CSSGroupingRule`
      // FIRST and `continue`d. Since CSS Nesting shipped, `CSSStyleRule` also
      // inherits from `CSSGroupingRule` on Firefox but not Chromium
      // (`CSSStyleRule.prototype instanceof CSSGroupingRule` → true / false), so on
      // Firefox every `:root` rule was classified as a container, recursed into,
      // and skipped before yielding a token — and the panel then HONESTLY reported
      // "no tokens found". Measured on the live case study: 99 on Chromium, 0 on
      // Firefox.
      //
      // walkCssRules never had that bug, because it visits style rules and descends
      // through the duck-typed `.cssRules` instead of asking the prototype chain
      // anything. Calling it — rather than re-deriving the same traversal a third
      // time next to cssom.ts and forcedState.ts — is what stops the next
      // cross-engine quirk needing three separate fixes.
      //
      // Measured on Chromium while reviewing this: a plain CSSStyleRule DOES expose
      // `.cssRules` (length 0) and a nested one reports its children, while
      // `instanceof CSSGroupingRule` stays false. So the old gate was ALSO skipping
      // real CSS-nested content on Chromium — a second, quieter half of this bug.
      walkCssRules(sheet.cssRules, (rule) => harvest(rule, file), walkSheet)
    } catch {
      /* not the host's readable source — skip */
    }
  }

  for (const sheet of Array.from(document.styleSheets)) walkSheet(sheet)
  return tokens
}

// Set a token's base value in the stylesheet that defines it. Returns the same
// { edits, originals } contract as canvas edits, so the caller writes + records history.
export async function museTokenEdit(name: string, value: string): Promise<StyleEditResponse> {
  if (isMock() || isEphemeral()) return { edits: [], originals: {}, warnings: [] }
  const res = await fetch(apiUrl('/api/muse/token-edit'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, value }),
  })
  const data = await parseJson<Partial<StyleEditResponse> & { error?: string }>(res)
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
  if (isEphemeral() || isMock()) return [...ephemeralFlags]
  const res = await fetch(apiUrl('/api/muse/flags'))
  const data = await parseJson<{ flags?: Flag[]; error?: string }>(res)
  if (data.error) throw new Error(data.error)
  return Array.isArray(data.flags) ? data.flags : []
}

export async function museAddFlag(draft: FlagDraft): Promise<Flag> {
  if (isEphemeral() || isMock()) {
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
  const data = await parseJson<{ ok?: boolean; flag?: Flag; error?: string }>(res)
  if (data.error || !data.flag) throw new Error(data.error ?? 'Could not save the flag.')
  return data.flag
}

export async function museResolveFlag(id: string, note?: string): Promise<void> {
  if (isEphemeral() || isMock()) {
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
  const data = await parseJson<{ ok?: boolean; error?: string }>(res)
  if (data.error) throw new Error(data.error)
}

export async function museDeleteFlag(id: string): Promise<void> {
  if (isEphemeral() || isMock()) {
    ephemeralFlags = ephemeralFlags.filter((x) => x.id !== id)
    return
  }
  const res = await fetch(apiUrl('/api/muse/flag-delete'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await parseJson<{ ok?: boolean; error?: string }>(res)
  if (data.error) throw new Error(data.error)
}

