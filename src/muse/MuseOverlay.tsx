import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft } from '@phosphor-icons/react'
import { useShadowHost } from './hooks/useShadowHost'
import { museChat, museDesignGenerate, museDesignGet, museObserve, museWrite } from './api'
import { EPHEMERAL, MOCK } from './config'
import { heuristicObservation } from './observation'
import { elementPreviewsForOption, matchPreviews } from './diffPreview'
import { useHostTheme } from './hooks/useHostTheme'
import { usePreviewLayer } from './hooks/usePreviewLayer'
import { museStore, nextThreadId, useMuseStore } from './store'
import { ActiveTargetStrip } from './components/ActiveTargetStrip'
import { CanvasMode } from './components/canvas/CanvasMode'
import { Composer } from './components/Composer'
import { MuseHistory } from './components/MuseHistory'
import { MusePanel } from './components/MusePanel'
import { MuseToolbar } from './components/MuseToolbar'
import { MuseThread } from './components/MuseThread'
import { RevertConfirmDialog } from './components/RevertConfirmDialog'
import type {
  AskInput,
  ChatMessage,
  ContentBlock,
  FileEdit,
  HistoryEntry,
  ObserveResult,
  ProposedOption,
  ProposeInput,
  ProposeOptionsInput,
  SelectedElement,
  ToolUseBlock,
} from './types'

const EXIT_MS = 240 // keep in sync with the longest close animation: muse-fab-catch (40ms delay + 200ms)

// Normalize a file path the way the server keys `originals` (forward slashes, no ./).
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')

// In-flight /observe calls keyed by element key, so concurrent openObservation
// calls for the same element (rapid re-select) share one network request.
// Module-level: persists across re-renders, resets on HMR of this file.
const inflightObserve = new Map<string, Promise<ObserveResult>>()

export type HistoryControls = {
  canUndo: boolean
  canRedo: boolean
  loading: boolean
  onUndo: () => void
  onRedo: () => void
  onRevert: () => void
}

export function MuseOverlay() {
  // The agent's sticky target. Fed ONLY by Shift-click escalation from Canvas
  // (see CanvasMode's onEscalate below); plain clicks drive Canvas's own live
  // selection and never touch this, so an observe call can only fire on the
  // intentional gesture. Kept as a ≤1 array to match the history/archive shape.
  const [selection, setSelection] = useState<SelectedElement[]>([])
  const clearSelection = useCallback(() => setSelection([]), [])

  const {
    thread,
    draft,
    pending,
    originals,
    answers,
    loading,
    error,
    past,
    future,
    historyLoading,
    showRevertConfirm,
    archived,
  } = useMuseStore()

  // Panel visibility, decoupled from selection: the FAB opens the panel onto
  // its home state (no target yet), and only an explicit close shuts it. A
  // target can come and go underneath without the panel opening or closing.
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const prevKeysRef = useRef<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  // The overlay chrome renders inside an isolated Shadow DOM root (see
  // useShadowHost) so its CSS can't collide with the host page's styles.
  const shadowMount = useShadowHost()
  // A starter-chip click that needs a re-target first parks its text here; the
  // effect below fires it once `selection` has actually flipped to that element.
  const pendingChipRef = useRef<{ text: string; key: string } | null>(null)
  // Synchronous latch for showDesign(): the thread-bubble guard there only sees
  // a COMPLETED bubble, so during the slow /design fetch rapid clicks all slip
  // past it and stack duplicates. This closes the window on the first click.
  const showingDesignRef = useRef(false)

  useHostTheme(rootRef)
  const { preview, restore } = usePreviewLayer()

  // When the selected target changes:
  //   - Empty selection → wipe conversation.
  //   - First-ever target this session → fresh thread (keep typed draft).
  //   - Same target restored (e.g. from history) → no-op, keep the thread.
  //   - A different target → append handoff and read the new element.
  const selectionKey = selection.map((s) => s.key).sort().join('|')
  useEffect(() => {
    const curKeys = selection.map((s) => s.key)
    const prevKeys = prevKeysRef.current

    if (curKeys.length === 0) {
      prevKeysRef.current = []
      museStore.resetConversation()
      return
    }
    if (prevKeys.length === 0) {
      prevKeysRef.current = curKeys
      museStore.resetConversation(true)
      // First target this session — open with an observation of it.
      if (selection.length === 1) openObservation(selection[0])
      return
    }
    // Same set as before (history restore pre-seeds prevKeysRef) → no handoff.
    const unchanged = curKeys.length === prevKeys.length && curKeys.every((k) => prevKeys.includes(k))
    prevKeysRef.current = curKeys
    if (unchanged) return

    const cur = selection[0]
    if (cur) {
      museStore.appendThread({ id: nextThreadId(), kind: 'target-handoff', target: cur })
      // New target context — open it with an observation too.
      if (selection.length === 1) openObservation(cur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  // Fire a parked starter-chip submit once selection has flipped to its
  // element. Runs after the handoff/observation effect above (effects run in
  // definition order), so the thread reads handoff → observation → user turn.
  useEffect(() => {
    const parked = pendingChipRef.current
    if (!parked) return
    // Selection settled — fire if it landed on the chip's element, otherwise
    // abandon (the retarget was interrupted: Esc, another pick, or close). Clear
    // either way so a stale chip can never fire on a later coincidental match.
    pendingChipRef.current = null
    if (selection.length === 1 && selection[0].key === parked.key) {
      submitText(parked.text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey])

  function requestClose() {
    if (closing) return
    restore() // never leave a hover-preview stranded when the panel closes
    setClosing(true)
    // Defer ALL teardown into the timer, so a cancelClose mid-collapse (which
    // clears this timer) leaves the session fully intact:
    //   - archive() only on a COMPLETED close — otherwise cancelling leaves the
    //     still-live proposal also sitting in Closed Proposals (a ghost entry).
    //     The thread isn't wiped until clearSelection() below triggers the
    //     selection effect on the next render, so it's still readable here.
    //   - historyOpen reset is deferred too: flipping it mid-collapse would swap
    //     the panel's content back to the (taller) home view, so you'd see the
    //     WRONG content shrink into the FAB. (A cancel therefore correctly leaves
    //     you on the history view you were on.)
    closeTimer.current = window.setTimeout(() => {
      museStore.archive(selection) // keep a closed-before-applying proposal in history
      setOpen(false)
      clearSelection()
      setClosing(false)
      setHistoryOpen(false)
    }, EXIT_MS)
  }

  // Abort an in-flight close (the FAB was clicked mid-collapse). `open` is still
  // true and selection is still intact — all teardown (archive, clearSelection,
  // historyOpen reset) lives in the timer we cancel here — so clearing `closing`
  // flips the panel's data-closing back and the CSS transition reverses it home
  // from wherever it was, with nothing left half-torn-down (no ghost archive).
  function cancelClose() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosing(false)
  }

  // Bring a past proposal back into the live view (still applyable), close history.
  // Archive the current live proposal first so picking an old one doesn't drop it.
  function openFromHistory(id: string) {
    museStore.archive(selection)
    const entry = museStore.getState().archived.find((a) => a.id === id)
    if (museStore.restoreArchived(id)) {
      setHistoryOpen(false)
      // Also restore the selection the proposal was about. `home` is keyed on an
      // empty selection, so without this the panel bounces back to its home state
      // instead of the restored conversation (and a later Apply would record the
      // wrong elements). Pre-seed prevKeysRef to the same keys so the
      // selection-change effect above sees a no-op diff and does NOT
      // resetConversation() over the thread we just restored.
      const els = entry?.elements ?? []
      if (els.length > 0) {
        prevKeysRef.current = els.map((e) => e.key)
        setSelection(els)
      }
    }
  }

  async function runChat(msgs: ChatMessage[]) {
    if (selection.length === 0) return
    museStore.setState({ loading: true, error: null })
    try {
      const resp = await museChat(selection, msgs)
      if (resp.error) {
        museStore.setState({ error: resp.error })
        return
      }
      const blocks: ContentBlock[] = resp.content ?? []
      if (resp.originals) museStore.setState({ originals: resp.originals })
      museStore.setState({ messages: [...msgs, { role: 'assistant', content: blocks }] })

      const tu = blocks.find((b) => b.type === 'tool_use') as ToolUseBlock | undefined
      if (!tu) {
        museStore.setState({ error: 'Muse did not return an action. Try rephrasing.' })
        return
      }
      if (tu.name === 'ask_clarifying_questions') {
        const questions = (tu.input as AskInput).questions
        museStore.setState({
          answers: {},
          pending: { kind: 'ask', toolUseId: tu.id, questions },
        })
        museStore.appendThread({ id: nextThreadId(), kind: 'clarify', toolUseId: tu.id, questions })
      } else {
        const allowed = new Set(Object.keys(resp.originals ?? {}))
        // Normalize + sandbox an edits array to files we actually read this turn.
        const cleanEdits = (raw: unknown): FileEdit[] =>
          (Array.isArray(raw) ? raw : [])
            .map((e) => ({ fileName: normPath((e as FileEdit)?.fileName ?? ''), newContent: (e as FileEdit)?.newContent }))
            .filter((e): e is FileEdit => typeof e.newContent === 'string' && allowed.has(e.fileName))

        let options: ProposedOption[] = []
        let rationale = ''
        if (tu.name === 'propose_options') {
          const input = tu.input as ProposeOptionsInput
          rationale = input.rationale ?? ''
          options = (Array.isArray(input.options) ? input.options : [])
            .map((o, i) => ({
              id: o.id || `opt-${i}`,
              label: o.label || `Option ${i + 1}`,
              description: o.description || '',
              edits: cleanEdits(o.edits),
            }))
            .filter((o) => o.edits.length > 0)
        } else {
          // propose_edit fallback — wrap a single edit as one option.
          const input = tu.input as ProposeInput
          rationale = input.rationale ?? ''
          const edits = cleanEdits(input.edits)
          if (edits.length > 0) options = [{ id: 'opt-0', label: 'Proposed change', description: '', edits }]
        }

        if (options.length === 0) {
          museStore.setState({ error: "Muse didn't return changes for the selected element(s). Try rephrasing." })
          return
        }
        museStore.setState({
          pending: { kind: 'propose', toolUseId: tu.id, options, rationale },
        })
        museStore.appendThread({ id: nextThreadId(), kind: 'option-set', toolUseId: tu.id, options, rationale })
      }
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ loading: false })
    }
  }

  // Send a message as the next user turn. Reads from store.getState() so a rapid
  // double-submit can't see a stale closed-over `pending` / `messages`. Shared by
  // the composer (sendDraft) and the observation starter chips (onChipClick).
  // Does NOT touch the composer draft — clearing it is sendDraft's job, so a chip
  // click leaves any half-typed message intact.
  function submitText(raw: string) {
    const text = raw.trim()
    if (!text) return
    const s = museStore.getState()
    if (s.loading) return // mirror approve(): never stack a turn on an in-flight one
    restore() // a new turn supersedes any option-set being hover-previewed
    museStore.appendThread({ id: nextThreadId(), kind: 'user', text })
    // If a clarify is currently pending and the user typed in the composer
    // instead of using the option buttons, freeze whatever partial selections
    // they had so the now-inactive clarify renders consistently.
    if (s.pending?.kind === 'ask') museStore.snapshotLastClarifyAnswers(s.answers)
    const next: ChatMessage = s.pending?.kind === 'ask'
      ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: s.pending.toolUseId, content: text }] }
      : { role: 'user', content: text }
    runChat([...s.messages, next])
  }

  function sendDraft() {
    const s = museStore.getState()
    if (s.loading || !s.draft.trim()) return
    const text = s.draft
    museStore.setState({ draft: '' })
    submitText(text)
  }

  // A starter chip belongs to the element its observation is about — not
  // necessarily the active target. If they differ, re-point to the chip's
  // element first (the selection effect appends the handoff + cached
  // observation), then submit once selection has flipped (see effect below).
  function submitChip(text: string, target: SelectedElement) {
    const current = selection.length === 1 ? selection[0] : null
    if (current && current.key === target.key) {
      submitText(text)
      return
    }
    pendingChipRef.current = { text, key: target.key }
    setSelection([target])
  }

  // Selecting a fresh element opens the thread with a read of it. Render the
  // synchronous heuristic immediately, then swap in the LLM observation when it
  // lands. Cache per element key so re-selecting never refires the call.
  function openObservation(target: SelectedElement) {
    const cached = museStore.getObservation(target.key)
    if (cached) {
      museStore.appendThread({
        id: nextThreadId(),
        kind: 'observation',
        target,
        observation: cached.observation,
        chips: cached.chips,
        pending: false,
      })
      return
    }

    const heuristic = heuristicObservation(target)
    // Real mode needs a source file to observe; mock mode synthesizes one.
    const willFetch = MOCK || !!target.fileName
    const id = nextThreadId()
    museStore.appendThread({
      id,
      kind: 'observation',
      target,
      observation: heuristic.observation,
      chips: heuristic.chips,
      pending: willFetch,
    })
    if (!willFetch) return

    // De-dupe concurrent fetches for the same element: if one is already in
    // flight (rapid A→B→A re-select before A resolves), share its promise
    // instead of firing a second call. Both bubbles still resolve.
    let p = inflightObserve.get(target.key)
    if (!p) {
      p = museObserve(target)
      inflightObserve.set(target.key, p)
      void p.finally(() => inflightObserve.delete(target.key))
    }
    p.then((res) => {
      museStore.cacheObservation(target.key, res)
      museStore.resolveObservation(id, res)
    })
      // Keep the heuristic on failure — just drop the pending shimmer.
      .catch(() => museStore.resolveObservation(id, heuristic))
  }

  function submitAnswers() {
    const s = museStore.getState()
    if (!s.pending || s.pending.kind !== 'ask') return
    // Freeze the chosen answers into the clarify bubble before the live
    // `answers` map gets cleared for the next turn.
    museStore.snapshotLastClarifyAnswers(s.answers)
    // No user bubble — the inactive clarify summary covers it.
    const text = s.pending.questions
      .map((q, i) => `${q.question} → ${s.answers[i] ?? '(no preference)'}`)
      .join('\n')
    runChat([
      ...s.messages,
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: s.pending.toolUseId, content: text }] },
    ])
  }

  // Document icon → show the app's design brief, or offer to generate one.
  async function showDesign() {
    // Already shown, or a fetch is mid-flight from an earlier click — don't stack
    // duplicates. The ref closes the race the bubble guard alone can't (the
    // bubble only appears after the slow fetch resolves).
    if (showingDesignRef.current) return
    if (museStore.getState().thread.some((m) => m.kind === 'design')) return
    showingDesignRef.current = true
    try {
      const res = await museDesignGet()
      if (res.exists && res.content) {
        museStore.appendThread({ id: nextThreadId(), kind: 'design', status: 'view', content: res.content, path: res.path })
      } else {
        museStore.appendThread({ id: nextThreadId(), kind: 'design', status: 'offer', generator: res.generator })
      }
    } catch (e) {
      museStore.appendThread({ id: nextThreadId(), kind: 'error', text: (e as Error).message })
    } finally {
      // Release the latch. A successful run leaves a 'design' bubble, so the
      // guard above now blocks re-entry; on failure (error bubble only) the
      // latch must clear so the user can retry.
      showingDesignRef.current = false
    }
  }

  // Generate (or regenerate) the brief from the offer/result bubble.
  async function generateDesign(id: string) {
    museStore.setDesignBubble(id, { status: 'generating' })
    try {
      const res = await museDesignGenerate()
      museStore.setDesignBubble(id, { status: 'view', content: res.content, path: res.path })
    } catch (e) {
      museStore.setDesignBubble(id, { status: 'offer' }) // back to offer so they can retry
      museStore.appendThread({ id: nextThreadId(), kind: 'error', text: (e as Error).message })
    }
  }

  // Hover an option card → live-preview every className change it makes, each
  // matched to the real DOM by current className. This covers the selected
  // element AND any children or looped siblings the edit restyles — and matching
  // by exact current class means a change can never be misattributed to the
  // wrong node. Nothing matched (text/structure-only change, or dynamic
  // classes) → clear, so the card just shows no preview rather than a wrong one.
  function previewOption(option: ProposedOption) {
    const matches = matchPreviews(elementPreviewsForOption(option, museStore.getState().originals))
    if (matches.length > 0) preview(matches)
    else restore()
  }

  async function approve(option: ProposedOption) {
    const s = museStore.getState()
    if (!s.pending || s.pending.kind !== 'propose' || s.loading) return
    restore() // drop any hover-preview styles before the real write/HMR lands
    const edits = option.edits
    const label = (option.description || option.label).slice(0, 80)

    // EPHEMERAL (demo): there's no source write or HMR, so keep the edit's deltas
    // on the live DOM (the same matches the hover preview used) and record them so
    // undo/redo can replay it. This is what makes the agent feel real here — the
    // change you previewed actually sticks when you apply.
    if (EPHEMERAL) {
      const matches = matchPreviews(elementPreviewsForOption(option, s.originals))
      const dom = matches.map((m) => ({
        node: m.node,
        before: m.node.className,
        beforeStyle: m.node.style.cssText,
        after: '',
        afterStyle: '',
      }))
      for (let i = 0; i < matches.length; i++) {
        const { node, delta } = matches[i]
        node.className = delta.newClassName
        Object.assign(node.style, delta.style)
        dom[i].after = node.className
        dom[i].afterStyle = node.style.cssText
      }
      const entry: HistoryEntry = {
        files: edits.map((e) => ({ fileName: e.fileName, before: s.originals[e.fileName] ?? '', after: e.newContent })),
        elements: selection,
        label,
        dom,
      }
      museStore.setState((cur) => ({ past: [...cur.past, entry], future: [], applied: true, pending: null }))
      museStore.appendThread({ id: nextThreadId(), kind: 'applied', fileCount: edits.length, rationale: '' })
      return
    }

    museStore.setState({ loading: true, error: null })
    try {
      await museWrite(edits)
      const entry: HistoryEntry = {
        files: edits.map((e) => ({
          fileName: e.fileName,
          before: s.originals[e.fileName] ?? '',
          after: e.newContent,
        })),
        elements: selection,
        label,
      }
      museStore.setState((cur) => ({
        past: [...cur.past, entry],
        future: [],
        applied: true,
        pending: null,
      }))
      museStore.appendThread({
        id: nextThreadId(),
        kind: 'applied',
        fileCount: edits.length,
        rationale: '',
      })
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ loading: false })
    }
  }

  // EPHEMERAL undo/redo: replay an entry's DOM snapshots (no source write/HMR).
  const applyDom = (snaps: NonNullable<HistoryEntry['dom']>, side: 'before' | 'after') => {
    for (const s of snaps) {
      if (!s.node.isConnected) continue
      s.node.className = side === 'before' ? s.before : s.after
      s.node.style.cssText = side === 'before' ? s.beforeStyle : s.afterStyle
    }
  }

  async function undo() {
    if (past.length === 0) return
    const entry = past[past.length - 1]
    if (entry.dom) {
      applyDom(entry.dom, 'before')
      museStore.setState((s) => ({ past: s.past.slice(0, -1), future: [entry, ...s.future], applied: false }))
      setOpen(true)
      if (entry.elements.length > 0) setSelection(entry.elements) // a token edit carries none — keep the current selection
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'undo', label: entry.label })
      return
    }
    museStore.setState({ historyLoading: true, error: null })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.before })))
      museStore.setState((s) => ({
        past: s.past.slice(0, -1),
        future: [entry, ...s.future],
        applied: false,
      }))
      setOpen(true) // surface the panel onto the reverted element (may fire from the idle bar)
      if (entry.elements.length > 0) setSelection(entry.elements) // a token edit carries none — keep the current selection
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'undo', label: entry.label })
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function redo() {
    if (future.length === 0) return
    const entry = future[0]
    if (entry.dom) {
      applyDom(entry.dom, 'after')
      museStore.setState((s) => ({ future: s.future.slice(1), past: [...s.past, entry], applied: true }))
      setOpen(true)
      if (entry.elements.length > 0) setSelection(entry.elements) // a token edit carries none — keep the current selection
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'redo', label: entry.label })
      return
    }
    museStore.setState({ historyLoading: true, error: null })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.after })))
      museStore.setState((s) => ({
        future: s.future.slice(1),
        past: [...s.past, entry],
        applied: true,
      }))
      setOpen(true) // surface the panel onto the redone element (may fire from the idle bar)
      if (entry.elements.length > 0) setSelection(entry.elements) // a token edit carries none — keep the current selection
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'redo', label: entry.label })
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function revertToOriginal() {
    if (past.length === 0) return
    if (EPHEMERAL) {
      // Restore every touched node to its EARLIEST pre-Muse className/style.
      const earliest = new Map<HTMLElement, { before: string; beforeStyle: string }>()
      for (const entry of past) for (const s of entry.dom ?? []) if (!earliest.has(s.node)) earliest.set(s.node, s)
      for (const [node, s] of earliest) {
        if (!node.isConnected) continue
        node.className = s.before
        node.style.cssText = s.beforeStyle
      }
      museStore.setState({ past: [], future: [], applied: false, showRevertConfirm: false })
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'revert' })
      return
    }
    museStore.setState({ historyLoading: true, error: null })
    try {
      const earliest = new Map<string, string>()
      for (const entry of past) {
        for (const f of entry.files) if (!earliest.has(f.fileName)) earliest.set(f.fileName, f.before)
      }
      await museWrite([...earliest].map(([fileName, before]) => ({ fileName, newContent: before })))
      museStore.setState({ past: [], future: [], applied: false, showRevertConfirm: false })
      museStore.appendThread({ id: nextThreadId(), kind: 'history', action: 'revert' })
    } catch (e) {
      museStore.setState({ error: (e as Error).message, showRevertConfirm: false })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  const [animationsPaused, setAnimationsPaused] = useState(false)
  useEffect(() => {
    if (!animationsPaused) return
    const style = document.createElement('style')
    style.id = 'muse-animation-pause'
    // Freeze all host-page animations and transitions so the canvas is still.
    // Excludes the Muse overlay itself (data-muse-ui) so its own chrome stays live.
    style.textContent =
      ':not([data-muse-ui]):not([data-muse-ui] *)' +
      '{animation-play-state:paused!important;transition-duration:0s!important;transition-delay:0s!important;}'
    document.head.appendChild(style)
    return () => style.remove()
  }, [animationsPaused])

  const historyControls: HistoryControls = {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    loading: historyLoading,
    onUndo: undo,
    onRedo: redo,
    onRevert: () => museStore.setState({ showRevertConfirm: true }),
  }
  const hasHistory = past.length > 0 || future.length > 0

  const single = selection.length === 1 ? selection[0] : null
  const unmappable = !MOCK && !!single && !single.fileName
  const allAnswered =
    pending?.kind === 'ask' &&
    pending.questions.every((_, i) => (answers[i] ?? '').trim() !== '')
  const panelOpen = open
  const home = selection.length === 0 // panel is open with no target → home state

  // Going idle (no agent target → the toolbar) clears the agent panel's history
  // view, so re-engaging an element opens on the thread, not a stale history list.
  useEffect(() => {
    if (home) setHistoryOpen(false)
  }, [home])

  // Bottom-right surface: the agent panel when an element is engaged, otherwise the
  // dock (the one pill that morphs between the FAB and the idle toolbar). The dock
  // also renders DURING a close so it can "catch" the collapsing agent panel.
  // `dockExpanded` = toolbar form (Muse open, idle) vs FAB form (closed/collapsing).
  const agentOpen = panelOpen && !home
  const showDock = !agentOpen || closing
  const dockExpanded = panelOpen && home && !closing

  // Enter submits a completed clarify (when focus isn't in a text field). Page
  // gestures — hover, plain/Shift/Alt click, Esc-to-deselect-then-exit — are
  // owned by Canvas's selection (useCanvasMode) while the panel is open, so there's
  // deliberately no click-outside-to-close here: every page click is a selection.
  useEffect(() => {
    if (!open || closing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if (pending?.kind === 'ask' && allAnswered && !loading) {
        e.preventDefault()
        submitAnswers()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing, pending, allAnswered, loading])

  // --- Panel tucks aside ---
  // When the element handed to the agent sits under the panel, the panel slides off
  // the right edge, leaving a small tab peeking; the element underneath is fully
  // visible (read it, double-click to edit). Hover the tab — or focus anything inside
  // — and it pulls back to home; move away and it tucks again. It stays edge-anchored
  // the whole time, so it never floats mid-screen.
  //
  // Engagement is read off a FIXED hysteresis zone, NOT the panel's own
  // mouseenter/leave: the panel MOVES when it pulls back, so hovering the moving
  // element let the cursor fall just outside it and flip-flop. Instead — ENTER by
  // crossing into the peek strip, STAY anywhere over the home footprint out to the
  // screen edge (so the pulled-back panel never slides out from under the cursor),
  // and only tuck after a short grace delay so it sticks.
  const PEEK = 44 // width of the right-edge hover hot-zone (the drawer handle's reach)
  const panelWrapRef = useRef<HTMLDivElement>(null)
  const tuckXRef = useRef(0)
  const engagedRef = useRef(false)
  const tuckTimerRef = useRef(0)
  const zoneRef = useRef<{ peekLeft: number; homeLeft: number; edge: number; top: number; bottom: number } | null>(null)
  const [tuckX, setTuckX] = useState(0) // resting tuck offset (0 = home, >0 = tucked right)
  const [engaged, setEngagedState] = useState(false) // pulled back to home by hover
  const [panelFocus, setPanelFocus] = useState(false)
  // The element the panel should tuck away from: a PLAIN-click (Canvas) selection,
  // reported up from CanvasMode. A Shift-click (agent) selection reports null — you
  // asked for the agent, so the panel stays put. (Previously driven by the agent
  // target, which made it tuck on the very Shift-click that opened the panel.)
  const [tuckNode, setTuckNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const node = tuckNode ?? undefined
    const wrap = panelWrapRef.current
    const setTuck = (x: number) => {
      if (Math.abs(tuckXRef.current - x) < 0.5) return
      tuckXRef.current = x
      setTuckX(x)
    }
    const clearClose = () => {
      if (tuckTimerRef.current) {
        clearTimeout(tuckTimerRef.current)
        tuckTimerRef.current = 0
      }
    }
    // Engage instantly; disengage only after a short grace, so a quick excursion off
    // the panel (or the brief gap while it slides) doesn't tuck it.
    const engage = (v: boolean) => {
      if (v) {
        clearClose()
        if (!engagedRef.current) {
          engagedRef.current = true
          setEngagedState(true)
        }
      } else if (engagedRef.current && !tuckTimerRef.current) {
        tuckTimerRef.current = window.setTimeout(() => {
          tuckTimerRef.current = 0
          engagedRef.current = false
          setEngagedState(false)
        }, 140)
      }
    }

    if (!agentOpen || !node || !wrap) {
      setTuck(0)
      zoneRef.current = null
      clearClose()
      engagedRef.current = false
      setEngagedState(false)
      return
    }
    // A fresh selection starts tucked (revealing the element); hover re-engages.
    clearClose()
    if (engagedRef.current) {
      engagedRef.current = false
      setEngagedState(false)
    }

    const M = 24 // the wrapper's bottom-6 / right-6 inset (1.5rem)
    const PAD = 12 // vertical slack on the stay-zone so edge wobble doesn't disengage

    const recompute = () => {
      if (!node.isConnected) {
        zoneRef.current = null
        return setTuck(0)
      }
      // Resting rect from layout size (offset*, transform-independent) + the fixed
      // bottom-right inset, so the open/close scale animation can't perturb it.
      const w = wrap.offsetWidth
      const h = wrap.offsetHeight
      if (!w || !h) return
      // Layout viewport (excludes the scrollbar gutter) — the space the fixed panel
      // is positioned in and that getBoundingClientRect reports in.
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const homeLeft = vw - M - w
      const top = vh - M - h
      const bottom = vh - M
      const t = node.getBoundingClientRect()
      const overlaps = homeLeft < t.right && vw - M > t.left && top < t.bottom && bottom > t.top
      if (!overlaps) {
        zoneRef.current = null
        engage(false)
        return setTuck(0)
      }
      setTuck(w + M) // panel goes FULLY off-screen; only the drawer handle pokes out
      // ENTER via the peek strip; STAY over the whole home footprint out to the
      // screen edge — fixed bounds, so the moving panel can't flip-flop hover.
      zoneRef.current = { peekLeft: vw - PEEK, homeLeft, edge: vw, top: top - PAD, bottom: bottom + PAD }
    }

    const onPointerMove = (e: PointerEvent) => {
      const z = zoneRef.current
      if (!z) return
      const inBand = e.clientY >= z.top && e.clientY <= z.bottom
      if (engagedRef.current || tuckTimerRef.current) {
        engage(inBand && e.clientX >= z.homeLeft && e.clientX <= z.edge)
      } else if (inBand && e.clientX >= z.peekLeft && e.clientX <= z.edge) {
        engage(true)
      }
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(wrap)
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    document.addEventListener('pointermove', onPointerMove, true)
    return () => {
      ro.disconnect()
      clearClose()
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
      document.removeEventListener('pointermove', onPointerMove, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentOpen, tuckNode])

  // Keep the panel home (not tucked) only while the agent is actively replying, plus
  // a short grace after, so a streaming reply isn't tucked away mid-thought. A fresh
  // selection does NOT hold it open: handing an element to the agent should tuck the
  // panel right away so you can see the element (hover the handle to read its read).
  const [holdOpen, setHoldOpen] = useState(false)
  useEffect(() => {
    if (loading) {
      setHoldOpen(true)
      return
    }
    const id = window.setTimeout(() => setHoldOpen(false), 1200)
    return () => clearTimeout(id)
  }, [loading])

  // Pulled fully back to home while engaged (hover), typing in it, or actively
  // working (loading / hold); otherwise it rests tucked off the right edge so the
  // element underneath stays visible. `tucked` drives the peek-tab affordance.
  const panelTx = engaged || panelFocus || loading || holdOpen ? 0 : tuckX
  const tucked = panelTx > 0

  const tree = (
    <div ref={rootRef} data-muse-ui className="pointer-events-none fixed inset-0 z-[999999] font-sans">
      {/* The single selection surface, live whenever Muse is open: hover
          highlight + on-canvas chrome. Plain-click edits directly; Shift-click
          escalates the element to the agent panel below (firing the observe read).
          Unmounts at the start of the close so the chrome clears before the panel
          collapses. */}
      {open && !closing && (
        <CanvasMode onExit={requestClose} onEscalate={(el) => setSelection([el])} onTuckTarget={setTuckNode} />
      )}

      {/* The dock — one pill that morphs between the FAB (closed) and the idle
          toolbar (manta · past proposals · design · X). Opening expands the FAB in
          place into the toolbar (2A); history + the design brief open as a popover
          above the bar (1B). Also rendered during a close so it catches the
          collapsing agent panel. Shift-clicking a page element opens the agent
          panel below — the dock is just the resting state. */}
      {showDock && (
        <MuseToolbar
          expanded={dockExpanded}
          onOpen={() => (closing ? cancelClose() : setOpen(true))}
          onClose={requestClose}
          archived={archived}
          onPickHistory={openFromHistory}
          hasHistory={hasHistory}
          historyControls={historyControls}
          animationsPaused={animationsPaused}
          onToggleAnimations={() => setAnimationsPaused((v) => !v)}
        />
      )}

      {agentOpen && (
        <div
          ref={panelWrapRef}
          // Tucks off the right edge when the agent's element is underneath it, and
          // pulls back when the cursor enters the fixed hover zone (tracked by the
          // effect above) or focus lands inside. pointer-events-auto so the peeking
          // tab is clickable; a quiet ease-out so the move is felt, not watched.
          onFocus={() => setPanelFocus(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPanelFocus(false)
          }}
          data-muse-dock
          // z above CanvasMode (z-999998) so the panel always sits OVER the canvas
          // selection chrome (outline / handles / box-model bands) instead of it
          // drawing across the panel.
          className="pointer-events-auto absolute bottom-6 right-6 z-[999999] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `translate3d(${panelTx}px, 0, 0)` }}
        >
          {/* Drawer handle. When tucked the panel sits FULLY off-screen and only this
              chevron tab pokes past the right edge — hover it (or the hot edge) to pull
              the panel back. `right-full` sits it just left of the panel's edge, so it
              rides out with the panel and lands flush to the screen edge, then fades
              once the panel is home. Fades in after a beat so it doesn't overlap the
              panel as it slides away. */}
          <div
            aria-hidden
            className={`pointer-events-none absolute right-full top-1/2 z-10 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl bg-surface-soft text-fg-muted shadow-lg shadow-black/20 ring-1 ring-line/10 transition-opacity duration-200 ${
              tucked ? 'opacity-100 delay-150' : 'opacity-0'
            }`}
          >
            <CaretLeft size={15} weight="bold" />
          </div>
          <MusePanel
            mock={MOCK}
            closing={closing}
            loading={loading || historyLoading}
            historyControls={hasHistory ? historyControls : undefined}
            archivedCount={archived.length}
            showingHistory={historyOpen}
            onToggleHistory={() => setHistoryOpen((v) => !v)}
            onClose={requestClose}
          >
            {/* Keyed by which view is showing, so switching views (history ⇄
                thread) remounts this wrapper and replays muse-step — the new view
                rises + unblurs in instead of snapping. Carries the panel's flex
                column so the inner views lay out unchanged. */}
            <div
              key={historyOpen ? 'history' : 'thread'}
              className="flex min-h-0 flex-1 flex-col animate-muse-step motion-reduce:animate-none"
            >
            {historyOpen ? (
              <MuseHistory entries={archived} onPick={openFromHistory} />
            ) : (
            <>
            {/* No swap-target crosshair: re-point the agent by Shift-clicking
                another element on the page. (Chip becomes click-to-reselect in PR4.) */}
            <ActiveTargetStrip elements={selection} mock={MOCK} onShowDesign={showDesign} />
            {unmappable ? (
              <div className="flex-1 overflow-y-auto px-4 py-3.5">
                <p className="text-sm leading-relaxed text-amber-300/80">
                  Couldn't map this element to a source file. Try clicking page content — it works best
                  inside <code className="rounded bg-line/10 px-1 text-amber-200">src/site/</code>.
                </p>
              </div>
            ) : (
              <>
                <MuseThread
                  thread={thread}
                  pending={pending}
                  originals={originals}
                  loading={loading}
                  answers={answers}
                  onSelectAnswer={(qi, label) =>
                    museStore.setState((s) => ({ answers: { ...s.answers, [qi]: label } }))
                  }
                  onContinue={submitAnswers}
                  allAnswered={allAnswered}
                  onApprove={approve}
                  onPreview={previewOption}
                  onPreviewEnd={restore}
                  onChipClick={submitChip}
                  onGenerateDesign={generateDesign}
                />
                {error && (
                  <div className="px-3 pb-2">
                    <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20">
                      {error}
                    </p>
                  </div>
                )}
                <Composer
                  value={draft}
                  onChange={(v) => museStore.setState({ draft: v })}
                  onSubmit={sendDraft}
                  loading={loading}
                />
              </>
            )}
            </>
            )}
            </div>
          </MusePanel>
        </div>
      )}

      {showRevertConfirm && (
        <RevertConfirmDialog
          onConfirm={revertToOriginal}
          onCancel={() => museStore.setState({ showRevertConfirm: false })}
          loading={historyLoading}
        />
      )}
    </div>
  )

  // Portal the chrome into the shadow root (null until it's created — SSR-safe).
  return shadowMount ? createPortal(tree, shadowMount) : null
}
