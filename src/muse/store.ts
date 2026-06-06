import { useSyncExternalStore } from 'react'
import type { Flag, HistoryEntry } from './types'

// In-memory only. State resets on full page refresh, or on HMR of THIS file.
// HMR of other Muse files (components) does not reset state — the store
// module stays loaded as long as `store.ts` itself isn't edited.

export type MuseState = {
  // The undo/redo history a Canvas commit lands in. Persists across selections.
  past: HistoryEntry[]
  future: HistoryEntry[]
  historyLoading: boolean
  showRevertConfirm: boolean
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
  },
  /** Undo the last ephemeral edit (run its `undo` thunk, move it to redo).
   * Returns false if nothing to undo. */
  ephemeralUndo(): boolean {
    const e = ePast.pop()
    if (!e) return false
    e.undo()
    eFuture.unshift(e)
    return true
  },
  /** Redo the last undone ephemeral edit. Returns false if nothing to redo. */
  ephemeralRedo(): boolean {
    const e = eFuture.shift()
    if (!e) return false
    e.redo()
    ePast.push(e)
    return true
  },
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
