import { useSyncExternalStore } from 'react'
import { loadPrefs, savePrefs, type MusePrefs } from './prefs'
import type { Flag, HistoryEntry } from './types'

// In-memory only. State resets on full page refresh, or on HMR of THIS file.
// HMR of other Muse files (components) does not reset state — the store
// module stays loaded as long as `store.ts` itself isn't edited.

// The Share-changes flow's lifecycle, kept in the store (not panel-local state)
// so it survives the popover closing and reopening mid-session. `branch` is the
// session's share branch — sending it back continues that branch instead of
// minting a new one. `snapshot` fingerprints the changes that were shared, so
// the panel can tell "share again" (new net edits) apart from "already shared".
// Resets on refresh, like `past` — acceptable v1.
export type ShareState = {
  status: 'idle' | 'sharing' | 'done' | 'error'
  branch?: string
  prUrl?: string
  compareUrl?: string
  message?: string
  snapshot?: string
}

export type MuseState = {
  // The undo/redo history a Canvas commit lands in. Persists across selections.
  past: HistoryEntry[]
  future: HistoryEntry[]
  historyLoading: boolean
  showRevertConfirm: boolean
  share: ShareState
  // REACTIVE mirrors of the ephemeral stacks' lengths (the stacks themselves stay
  // off-state — see ePast/eFuture). The toolbar's undo/redo buttons read these, so
  // they light up in the EPHEMERAL demo too instead of sitting dead while only the
  // keyboard path works.
  eUndoCount: number
  eRedoCount: number
  // UI preferences (dock corner, zen chrome-hiding) — localStorage-backed via
  // prefs.ts, so they survive refresh; see that module for why this is the one
  // deliberate exception to the in-memory-only rule.
  prefs: MusePrefs
  // Open + resolved flags (shift-click / refusal annotations handed off via muse-mcp).
  // REACTIVE — the Flags panel, the toolbar count badge, and the on-element pins all
  // re-render on change (unlike the ephemeral undo stacks, whose effect is DOM mutation).
  flags: Flag[]
}

const initialState: MuseState = {
  past: [],
  future: [],
  historyLoading: false,
  showRevertConfirm: false,
  share: { status: 'idle' },
  eUndoCount: 0,
  eRedoCount: 0,
  prefs: loadPrefs(),
  flags: [],
}

let state: MuseState = initialState
const subscribers = new Set<() => void>()

// Ephemeral (EPHEMERAL mode) undo/redo: in-browser-only Canvas edits don't write
// to disk, so they can't use the file-content `past`/`future` stack. Each entry is
// a pair of DOM-restoration thunks captured at commit (inline-style cssText, text
// content, or sibling order). Kept OFF the reactive state — nothing renders these
// directly; the DOM mutation IS the visible effect, and the panel re-reads via its
// own revision bump. Resets on full refresh / HMR of this file.
export type EphemeralEntry = { label: string; undo: () => void; redo: () => void }
let ePast: EphemeralEntry[] = []
let eFuture: EphemeralEntry[] = []

function notify() {
  subscribers.forEach((fn) => fn())
}

export const museStore = {
  getState: (): MuseState => state,
  subscribe: (fn: () => void): (() => void) => {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },
  /** Merge a partial state patch and notify. Skips no-op patches (every
   * key in the patch already equals the current value) to avoid spurious
   * re-renders — useSyncExternalStore compares snapshot reference identity. */
  setState(patch: Partial<MuseState> | ((s: MuseState) => Partial<MuseState>)) {
    const next = typeof patch === 'function' ? patch(state) : patch
    if (!next) return
    const cur = state as Record<string, unknown>
    let changed = false
    for (const key in next) {
      if ((next as Record<string, unknown>)[key] !== cur[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...next }
    notify()
  },
  /** Push an ephemeral (in-browser-only) Canvas edit onto the undo stack and
   * clear the redo stack. Off-state — see the ePast/eFuture comment. */
  pushEphemeral(entry: EphemeralEntry) {
    ePast.push(entry)
    eFuture = []
    syncEphemeralCounts()
  },
  /** Undo the last ephemeral edit (run its `undo` thunk, move it to redo).
   * Returns false if nothing to undo. */
  ephemeralUndo(): boolean {
    const e = ePast.pop()
    if (!e) return false
    e.undo()
    eFuture.unshift(e)
    syncEphemeralCounts()
    return true
  },
  /** Redo the last undone ephemeral edit. Returns false if nothing to redo. */
  ephemeralRedo(): boolean {
    const e = eFuture.shift()
    if (!e) return false
    e.redo()
    ePast.push(e)
    syncEphemeralCounts()
    return true
  },
  /** Merge a UI-preferences patch, persist it, and notify. */
  setPrefs(patch: Partial<MusePrefs>) {
    const next = { ...state.prefs, ...patch }
    savePrefs(next)
    museStore.setState({ prefs: next })
  },
  /** Revert the whole ephemeral session: undo everything, then drop both stacks
   * (mirrors the file-history revert, which clears past AND future). */
  ephemeralRevert() {
    for (let e = ePast.pop(); e; e = ePast.pop()) e.undo()
    eFuture = []
    syncEphemeralCounts()
  },
}

// Mirror the off-state stacks' lengths into the reactive state so the toolbar's
// undo/redo buttons re-render. setState's no-op skip keeps redundant syncs silent.
function syncEphemeralCounts() {
  museStore.setState({ eUndoCount: ePast.length, eRedoCount: eFuture.length })
}

/** Subscribe a component to the entire store. Re-renders on any state change. */
export function useMuseStore(): MuseState {
  // Pass getState as the server snapshot too: SSR hosts (Next renders client
  // components on the server) call useSyncExternalStore on the server, which
  // THROWS without a getServerSnapshot. getState returns the module-level initial
  // state, consistent across server + client, so this is SSR-safe (the overlay
  // itself renders nothing until its shadow root mounts client-side).
  return useSyncExternalStore(museStore.subscribe, museStore.getState, museStore.getState)
}
