// ============================================================
//  MUSE CLIENT CONFIG  —  bundler-neutral
// ------------------------------------------------------------
//  The overlay runs inside a HOST app that may be built by Vite, Next.js
//  (webpack / Turbopack), or anything else. Vite exposes build-time vars on
//  import.meta.env; other bundlers don't — and on webpack `import.meta.env` is
//  `undefined`, so reading `import.meta.env.VITE_X` throws. Every config value
//  is therefore resolved through a guarded reader that checks, in order:
//    1. import.meta.env   (Vite — guarded so non-Vite bundlers don't choke)
//    2. window.__MUSE__   (a plain object any host sets BEFORE the bundle loads)
//    3. process.env       (Node / SSR safety)
//  MOCK and EPHEMERAL are resolved ONCE at import (they're consts), so a host
//  that wants them on must set window.__MUSE__ before this module first loads.
//  apiBase is the only value overridable after load — via configureMuse() (e.g.
//  a <MuseOverlay apiBase=…/> prop), since it's read lazily at fetch time.
//  Defaults give a real host with no config the production behavior: live
//  backend, real writes, same-origin API.
// ============================================================

// Friendly shape a non-Vite host sets as `window.__MUSE__` before the overlay
// mounts — e.g. `window.__MUSE__ = { apiBase: 'http://localhost:4747' }`.
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

// MOCK mode: when on, the overlay runs the whole flow on fixtures — no Claude API
// calls, no file writes — so the UI can be polished for free. Resolved at import:
// Vite VITE_MUSE_MOCK=1 in .env.local (then restart), or set window.__MUSE__ =
// { mock: true } BEFORE the overlay bundle loads.
export const MOCK = flag('VITE_MUSE_MOCK', 'mock', 'MUSE_MOCK')

// EPHEMERAL mode: Canvas Mode edits apply in-browser only — no server style/
// text/reorder calls, no disk writes; the live preview becomes the committed
// state and undo/redo run on DOM snapshots. Edits persist for the session and
// reset on refresh. For the hosted static demo, which has no musePlugin backend
// (it's `apply: 'serve'`, never in a build). Independent of MOCK (a demo build is
// both, but the two are distinct concerns). Vite: VITE_MUSE_EPHEMERAL=1.
export const EPHEMERAL = flag('VITE_MUSE_EPHEMERAL', 'ephemeral', 'MUSE_EPHEMERAL')

// ---- API base ----------------------------------------------------------------
// Base URL the overlay prepends to every /api/muse/* call. '' = same-origin —
// correct for the Vite dev plugin AND a same-origin Next.js dev API route. Point
// it at a standalone muse-server ORIGIN (e.g. 'http://localhost:4747' — not a
// full /api/muse path) for hosts whose bundler can't serve the backend
// in-process. The env sources are captured at import, but getApiBase() reads
// `state` per call, so a mount-time configureMuse() override still wins.
const state = {
  apiBase: (museGlobal()?.apiBase ?? viteVar('VITE_MUSE_API_BASE') ?? procVar('MUSE_API_BASE') ?? '')
    .replace(/\/+$/, ''),
}

// Host hook (e.g. a <MuseOverlay apiBase=…/> prop) to set config after load.
export function configureMuse(opts: { apiBase?: string }): void {
  if (typeof opts.apiBase === 'string') state.apiBase = opts.apiBase.replace(/\/+$/, '')
}

export function getApiBase(): string {
  return state.apiBase
}
