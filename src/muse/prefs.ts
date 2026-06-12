// UI preferences — where the dock lives and whether Muse's chrome hides.
//
// These persist in localStorage, a deliberate exception to the in-memory-only
// store rule: that rule exists because SESSION state (history, selections) going
// stale across HMR would mislead, while a placement preference is exactly the
// thing that should survive a refresh — re-dragging your toolbar corner every
// reload would be the misleading experience. SSR-safe (Next hosts import the
// overlay module on the server): every window touch is guarded.

export type DockCorner = 'br' | 'bl' | 'tr' | 'tl'

export type MusePrefs = {
  corner: DockCorner
  // "Zen": the FAB/toolbar and the teaching banner stay hidden — just the
  // editing tools. The dock reveals on a corner hover; R still toggles Muse.
  zen: boolean
  // Successful-gesture counters — the teaching banner collapses a message once
  // its gesture has landed ~5 times (onboarding chrome should retire itself).
  hintUses: { select: number; reorder: number; text: number }
  // The one-time "best at desktop widths" note for narrow windows.
  narrowNoticeSeen: boolean
}

export const DEFAULT_PREFS: MusePrefs = {
  corner: 'br',
  zen: false,
  hintUses: { select: 0, reorder: 0, text: 0 },
  narrowNoticeSeen: false,
}

const KEY = 'muse:prefs'

export function loadPrefs(): MusePrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<MusePrefs>
    const uses = p.hintUses as Partial<MusePrefs['hintUses']> | undefined
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
    return {
      corner: p.corner === 'bl' || p.corner === 'tr' || p.corner === 'tl' ? p.corner : 'br',
      zen: p.zen === true,
      hintUses: { select: count(uses?.select), reorder: count(uses?.reorder), text: count(uses?.text) },
      narrowNoticeSeen: p.narrowNoticeSeen === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(p: MusePrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage full / blocked — the session keeps the in-memory value */
  }
}
