import { useSyncExternalStore } from 'react'
import type {
  ChatMessage,
  ClarifyingQuestion,
  HistoryEntry,
  ObserveResult,
  ProposedOption,
  SelectedElement,
  ThreadMessage,
} from './types'

// In-memory only. State resets on full page refresh, or on HMR of THIS file.
// HMR of other Muse files (components) does not reset state — the store
// module stays loaded as long as `store.ts` itself isn't edited.

export type Pending =
  | { kind: 'ask'; toolUseId: string; questions: ClarifyingQuestion[] }
  | { kind: 'propose'; toolUseId: string; options: ProposedOption[]; rationale: string }

// A snapshot of a conversation that produced a proposal, kept so closing the
// panel before applying doesn't lose it. Captures everything needed to restore
// the proposal as still-applyable (thread + pending + the originals it diffs
// against). In-memory only — resets on full refresh, like the rest of the store.
export type ArchivedThread = {
  id: string
  time: number
  label: string
  elements: SelectedElement[] // what was being edited — shown in the list
  thread: ThreadMessage[]
  messages: ChatMessage[]
  pending: Pending | null
  originals: Record<string, string>
  answers: Record<number, string>
}

export type MuseState = {
  // Per-conversation slice — reset by resetConversation().
  // `intent` is kept for any callers that still set it but the thread shell
  // uses `draft` (composer text) instead. Remove once nothing references it.
  intent: string
  draft: string
  messages: ChatMessage[]
  thread: ThreadMessage[]
  pending: Pending | null
  answers: Record<number, string>
  loading: boolean
  error: string | null
  applied: boolean
  // Per-chat-turn slice — overwritten by runChat on each response. NOT reset
  // by resetConversation; runChat will replace it on the next call. Stale
  // originals are harmless because they're keyed by file path and only read
  // alongside a matching `pending` from the same response.
  originals: Record<string, string>
  // Cross-conversation slice — persists across selections.
  past: HistoryEntry[]
  future: HistoryEntry[]
  historyLoading: boolean
  showRevertConfirm: boolean
  // Past proposals, newest first — survives close/switch so you can revisit one.
  archived: ArchivedThread[]
}

const initialState: MuseState = {
  intent: '',
  draft: '',
  messages: [],
  thread: [],
  pending: null,
  originals: {},
  answers: {},
  loading: false,
  error: null,
  applied: false,
  past: [],
  future: [],
  historyLoading: false,
  showRevertConfirm: false,
  archived: [],
}

let state: MuseState = initialState
const subscribers = new Set<() => void>()

// Per-element observation memo, keyed by SelectedElement.key. Kept OFF the
// reactive `state` object on purpose: it's read imperatively (never rendered
// from directly), so it must not participate in the useSyncExternalStore
// snapshot — mutating `state` without notify() would break that invariant.
// Resets on full refresh / HMR of this file, like the rest of the store.
let observationCache: Record<string, ObserveResult> = {}

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
  /**
   * Reset the conversation slice (thread, messages, pending, answers, error,
   * applied). History is preserved. `keepDraft` is for the "shrinking a batch"
   * case where the user removed an element from a multi-select and we don't
   * want to wipe their typed composer text.
   */
  resetConversation(keepDraft = false) {
    state = {
      ...state,
      thread: [],
      messages: [],
      pending: null,
      answers: {},
      error: null,
      applied: false,
      intent: '',
      draft: keepDraft ? state.draft : '',
    }
    notify()
  },
  /** Snapshot the current conversation into `archived` IF it produced a proposal
   * (an option-set or clarify) worth revisiting. Called before the thread is
   * wiped (panel close) so a proposal closed-before-applying isn't lost. Dedupes
   * the just-archived thread and caps the list. */
  archive(elements: SelectedElement[]) {
    const t = state.thread
    // Only threads with an UNRESOLVED proposal are worth revisiting — skip ones
    // already applied (those live in undo/redo) and ones with no proposal at all.
    if (!t.some((m) => m.kind === 'option-set' || m.kind === 'clarify')) return
    if (t.some((m) => m.kind === 'applied')) return
    if (state.archived[0]?.thread === t) return // already archived this exact thread
    const userMsg = t.find((m): m is Extract<ThreadMessage, { kind: 'user' }> => m.kind === 'user')
    const optSet = t.find((m): m is Extract<ThreadMessage, { kind: 'option-set' }> => m.kind === 'option-set')
    const label = (userMsg?.text || optSet?.rationale || 'Muse proposal').slice(0, 80)
    const entry: ArchivedThread = {
      id: nextThreadId(),
      time: Date.now(),
      label,
      elements,
      thread: t,
      messages: state.messages,
      pending: state.pending,
      originals: state.originals,
      answers: state.answers,
    }
    state = { ...state, archived: [entry, ...state.archived].slice(0, 20) }
    notify()
  },
  /** Restore an archived proposal into the live view (thread + pending +
   * originals), so its options are viewable and still applyable. Does not touch
   * selection — the caller (openFromHistory) restores the entry's `elements`, so
   * the panel renders the conversation (home is keyed on an empty selection). */
  restoreArchived(id: string): boolean {
    const entry = state.archived.find((a) => a.id === id)
    if (!entry) return false
    state = {
      ...state,
      thread: entry.thread,
      messages: entry.messages,
      pending: entry.pending,
      originals: entry.originals,
      answers: entry.answers,
      loading: false,
      error: null,
    }
    notify()
    return true
  },
  /** Append a single bubble to the thread, replacing state immutably. */
  appendThread(msg: ThreadMessage) {
    state = { ...state, thread: [...state.thread, msg] }
    notify()
  },
  /** Freeze the most recent clarify bubble's answers so its inactive
   * rendering is decoupled from the (about-to-be-cleared) live answers map. */
  snapshotLastClarifyAnswers(answers: Record<number, string>) {
    const idx = (() => {
      for (let i = state.thread.length - 1; i >= 0; i--) {
        if (state.thread[i].kind === 'clarify') return i
      }
      return -1
    })()
    if (idx === -1) return
    const updated = state.thread.slice()
    const target = updated[idx]
    if (target.kind !== 'clarify') return
    updated[idx] = { ...target, answeredWith: { ...answers } }
    state = { ...state, thread: updated }
    notify()
  },
  /** Transition a design bubble (offer → generating → view). No-op if the id
   * no longer points at a design bubble (scrolled past / replaced). */
  setDesignBubble(id: string, patch: Partial<Extract<ThreadMessage, { kind: 'design' }>>) {
    const idx = state.thread.findIndex((m) => m.id === id && m.kind === 'design')
    if (idx === -1) return
    const target = state.thread[idx]
    if (target.kind !== 'design') return
    const updated = state.thread.slice()
    updated[idx] = { ...target, ...patch }
    state = { ...state, thread: updated }
    notify()
  },
  /** Read an element's memoized /observe result, if any. */
  getObservation(key: string): ObserveResult | undefined {
    return observationCache[key]
  },
  /** Memo an element's /observe result. Off-state, so no notify — nothing
   * renders from the cache directly; it's read via getObservation() when a
   * target is (re)selected. */
  cacheObservation(key: string, result: ObserveResult) {
    observationCache = { ...observationCache, [key]: result }
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
  /** Swap the LLM read (or a fallback) into an existing observation bubble,
   * clearing its pending shimmer. No-op if the bubble was scrolled past and
   * is gone, or the id no longer points at an observation. */
  resolveObservation(id: string, result: ObserveResult) {
    const idx = state.thread.findIndex((m) => m.id === id && m.kind === 'observation')
    if (idx === -1) return
    const target = state.thread[idx]
    if (target.kind !== 'observation') return
    const updated = state.thread.slice()
    updated[idx] = { ...target, observation: result.observation, chips: result.chips, pending: false }
    state = { ...state, thread: updated }
    notify()
  },
}

let _id = 0
/** Stable, monotonic id for thread messages — sortable, unique per session. */
export const nextThreadId = (): string => `m${++_id}`

/** Subscribe a component to the entire store. Re-renders on any state change. */
export function useMuseStore(): MuseState {
  return useSyncExternalStore(museStore.subscribe, museStore.getState)
}
