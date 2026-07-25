// ============================================================
//  MUSE CLIENT CONFIG  —  bundler-neutral
// ------------------------------------------------------------
//  The overlay runs inside a HOST app that may be built by Vite, Next.js
//  (webpack / Turbopack), or anything else. Vite exposes build-time vars on
//  import.meta.env; other bundlers don't — and on webpack `import.meta.env` is
//  `undefined`, so reading `import.meta.env.VITE_X` throws. Every config value
//  is therefore resolved through a guarded reader that checks, in order:
//    1. import.meta.env   (Vite — guarded so non-Vite bundlers don't choke)
//    2. window.__MUSE__   (a plain object the host sets)
//    3. process.env       (Node / SSR safety)
//  EVERY value is read LAZILY, per call — nothing is snapshotted at import.
//  That is load-bearing, not stylistic. These were consts once, and the import-
//  time snapshot took the live case study down: the host's overlay chunk shipped
//  as `<script async>`, which executes as soon as it downloads regardless of
//  parser position, so it beat the page's inline `window.__MUSE__` script and
//  latched EPHEMERAL to false for the whole session — 49 failed API calls on a
//  host with no backend. It never reproduced locally, because localhost parses
//  the HTML faster than a chunk arrives. A host cannot win that race by
//  construction, so the fix is to stop making it race: read when asked.
//  Deliberately NOT cached after the first successful read — a latch is just the
//  same bug with a shorter window. A host's config script always runs during page
//  load, long before the first read (a render effect or a click); a mid-session
//  flip would be a host bug, and defending against it costs the property that
//  makes the whole class of failure impossible.
//  Defaults give a real host with no config the production behavior: live
//  backend, real writes, same-origin API.
// ============================================================

// Friendly shape a non-Vite host sets as `window.__MUSE__` — read per call, so
// setting it after the overlay bundle loads still takes effect.
// e.g. `window.__MUSE__ = { apiBase: 'http://localhost:4747' }`.
type MuseGlobal = { mock?: boolean; ephemeral?: boolean; apiBase?: string }

function museGlobal(): MuseGlobal | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { __MUSE__?: MuseGlobal }).__MUSE__
    : undefined
}

// Vite's build-time env. In ESM `import.meta` is always a valid meta-property;
// under webpack/Next `.env` is simply undefined (we return undefined rather than
// throw). The try/catch guards exotic bundlers that reject `import.meta` outright.
function viteVar(key: string): string | undefined {
  try {
    // Cast through unknown so this typechecks even under a host tsconfig that
    // doesn't include Vite's ambient `import.meta.env` types (e.g. Next.js).
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    return env ? env[key] : undefined
  } catch {
    return undefined
  }
}

function procVar(key: string): string | undefined {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined
}

// A boolean flag from any source: a host global boolean wins; otherwise a Vite
// `=== '1'` var or a process `=== '1'` var.
function flag(viteKey: string, globalKey: 'mock' | 'ephemeral', procKey: string): boolean {
  const g = museGlobal()?.[globalKey]
  if (typeof g === 'boolean') return g
  return viteVar(viteKey) === '1' || procVar(procKey) === '1'
}

// MOCK mode: when on, the overlay runs the whole flow on fixtures — no server
// calls, no file writes — so the UI can be polished for free. Set Vite
// VITE_MUSE_MOCK=1 in .env.local (then restart), or window.__MUSE__ = { mock: true }
// from the host at any point before the overlay reads it.
export function isMock(): boolean {
  return flag('VITE_MUSE_MOCK', 'mock', 'MUSE_MOCK')
}

// EPHEMERAL mode: Canvas Mode edits apply in-browser only — no server style/
// text/reorder calls, no disk writes; the live preview becomes the committed
// state and undo/redo run on DOM snapshots. Edits persist for the session and
// reset on refresh. For the hosted static demo, which has no musePlugin backend
// (it's `apply: 'serve'`, never in a build). Independent of MOCK (a demo build is
// both, but the two are distinct concerns). Vite: VITE_MUSE_EPHEMERAL=1.
export function isEphemeral(): boolean {
  return flag('VITE_MUSE_EPHEMERAL', 'ephemeral', 'MUSE_EPHEMERAL')
}

// ---- API base ----------------------------------------------------------------
// Base URL the overlay prepends to every /api/muse/* call. '' = same-origin —
// correct for the Vite dev plugin AND a same-origin Next.js dev API route. Point
// it at a standalone muse-server ORIGIN (e.g. 'http://localhost:4747' — not a
// full /api/muse path) for hosts whose bundler can't serve the backend
// in-process.
//
// Two tiers, and the tiering is the point: an EXPLICIT configureMuse() call (a
// <MuseOverlay apiBase=…/> prop) is a deliberate decision and wins forever;
// everything else is ambient config read live, for the same reason isMock() and
// isEphemeral() are. `window.__MUSE__.apiBase` used to be captured at import
// alongside them and lost the identical race — a host that set it after the
// overlay chunk ran silently got same-origin.
//
// null = never explicitly configured, so fall through to the ambient sources.
// An explicit configureMuse({ apiBase: '' }) is NOT null and still wins.
const state: { apiBase: string | null } = { apiBase: null }

// Host hook (e.g. a <MuseOverlay apiBase=…/> prop) to set config after load.
export function configureMuse(opts: { apiBase?: string }): void {
  if (typeof opts.apiBase === 'string') state.apiBase = opts.apiBase.replace(/\/+$/, '')
}

export function getApiBase(): string {
  if (state.apiBase !== null) return state.apiBase
  return (museGlobal()?.apiBase ?? viteVar('VITE_MUSE_API_BASE') ?? procVar('MUSE_API_BASE') ?? '')
    .replace(/\/+$/, '')
}
