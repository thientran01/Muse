import { useEffect, useRef, useState } from 'react'
import './muse.css'
import { museChat, museDesignGenerate, museDesignGet, museObserve, museWrite } from './api'
import { MOCK } from './config'
import { heuristicObservation } from './observation'
import { elementPreviewsForOption, matchPreviews } from './diffPreview'
import { useSelection } from './useSelection'
import { useHostTheme } from './hooks/useHostTheme'
import { usePreviewLayer } from './hooks/usePreviewLayer'
import { museStore, nextThreadId, useMuseStore } from './store'
import { ActiveTargetStrip } from './components/ActiveTargetStrip'
import { Composer } from './components/Composer'
import { MuseFab } from './components/MuseFab'
import { MuseHistory } from './components/MuseHistory'
import { MuseHome } from './components/MuseHome'
import { MusePanel } from './components/MusePanel'
import { MuseThread } from './components/MuseThread'
import { RevertConfirmDialog } from './components/RevertConfirmDialog'
import { UndoRedoBar } from './components/UndoRedoBar'
import {
  HoverHighlight,
  SelectBanner,
  SelectionMarkers,
  SelectionTray,
} from './components/SelectionOverlay'
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
  const { active, setActive, hoverRect, hoverInfo, cursor, selection, setSelection, clearSelection } =
    useSelection()

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
  // A starter-chip click that needs a re-target first parks its text here; the
  // effect below fires it once `selection` has actually flipped to that element.
  const pendingChipRef = useRef<{ text: string; key: string } | null>(null)
  // Synchronous latch for showDesign(): the thread-bubble guard there only sees
  // a COMPLETED bubble, so during the slow /design fetch rapid clicks all slip
  // past it and stack duplicates. This closes the window on the first click.
  const showingDesignRef = useRef(false)

  useHostTheme(rootRef)
  const { preview, restore } = usePreviewLayer()

  // When the SET of selected elements changes:
  //   - Empty selection → wipe conversation.
  //   - First-ever target this session → fresh thread (keep typed draft).
  //   - Shrink or grow of the same focus (one set is a subset of the other)
  //     → no handoff, keep the thread. This covers shift-click to add or
  //     remove batch elements without "switching focus."
  //   - Truly different selection (some elements swapped) → append handoff.
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
    // Pure shrink (cur ⊆ prev) OR pure grow (prev ⊆ cur) = no handoff.
    const curInPrev = curKeys.every((k) => prevKeys.includes(k))
    const prevInCur = prevKeys.every((k) => curKeys.includes(k))
    prevKeysRef.current = curKeys
    if (curInPrev || prevInCur) return

    const cur = selection[0]
    if (cur) {
      museStore.appendThread({ id: nextThreadId(), kind: 'target-handoff', target: cur })
      // New target context — open it with an observation too (single only).
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
    museStore.archive(selection) // keep a closed-before-applying proposal in history
    setHistoryOpen(false)
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      clearSelection()
      setClosing(false)
    }, EXIT_MS)
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

  function removeChip(key: string) {
    if (selection.length <= 1) {
      requestClose()
      return
    }
    setSelection((prev) => prev.filter((p) => p.key !== key))
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
        museStore.appendThread({ id: nextThreadId(), kind: 'design', status: 'offer' })
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
        label: (option.description || option.label).slice(0, 80),
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

  async function undo() {
    if (past.length === 0) return
    const entry = past[past.length - 1]
    museStore.setState({ historyLoading: true, error: null })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.before })))
      museStore.setState((s) => ({
        past: s.past.slice(0, -1),
        future: [entry, ...s.future],
        applied: false,
      }))
      setOpen(true) // surface the panel onto the reverted element (may fire from the idle bar)
      setSelection(entry.elements)
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function redo() {
    if (future.length === 0) return
    const entry = future[0]
    museStore.setState({ historyLoading: true, error: null })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.after })))
      museStore.setState((s) => ({
        future: s.future.slice(1),
        past: [...s.past, entry],
        applied: true,
      }))
      setOpen(true) // surface the panel onto the redone element (may fire from the idle bar)
      setSelection(entry.elements)
    } catch (e) {
      museStore.setState({ error: (e as Error).message })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function revertToOriginal() {
    if (past.length === 0) return
    museStore.setState({ historyLoading: true, error: null })
    try {
      const earliest = new Map<string, string>()
      for (const entry of past) {
        for (const f of entry.files) if (!earliest.has(f.fileName)) earliest.set(f.fileName, f.before)
      }
      await museWrite([...earliest].map(([fileName, before]) => ({ fileName, newContent: before })))
      museStore.setState({ past: [], future: [], applied: false, showRevertConfirm: false })
    } catch (e) {
      museStore.setState({ error: (e as Error).message, showRevertConfirm: false })
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

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
  const panelOpen = open && !active
  const showMarkers = selection.length >= 1
  const home = selection.length === 0 // panel is open with no target → home state

  // Keyboard for both phases + click-outside while the panel is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (active) {
        if (e.key === 'Enter' && selection.length >= 1) {
          e.preventDefault()
          setActive(false)
        }
        return
      }
      if (!open || closing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key === 'Enter') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
        if (pending?.kind === 'ask' && allAnswered && !loading) {
          e.preventDefault()
          submitAnswers()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)

    let onDocClick: ((e: MouseEvent) => void) | null = null
    if (!active && open && !closing) {
      onDocClick = (e: MouseEvent) => {
        const t = e.target as Element | null
        if (t && !t.closest('[data-muse-ui]')) requestClose()
      }
      document.addEventListener('click', onDocClick, true)
    }

    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (onDocClick) document.removeEventListener('click', onDocClick, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, selection, closing, pending, allAnswered, loading])

  return (
    <div ref={rootRef} data-muse-ui className="pointer-events-none fixed inset-0 z-[999999] font-sans">
      {active && hoverRect && <HoverHighlight rect={hoverRect} cursor={cursor} info={hoverInfo} />}
      {showMarkers && <SelectionMarkers elements={selection} />}

      {active && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <SelectBanner />
        </div>
      )}

      {/* FAB renders while closing too (not just once the panel unmounts), so the
          button is already in its shared bottom-right corner to "catch" the
          collapsing panel — the close reads as one motion, not a flash-and-pop.
          The undo bar stays hidden until the collapse finishes so it doesn't pop
          in over the morph. */}
      {(!panelOpen || closing) && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3">
          {!active && hasHistory && !closing && (
            <UndoRedoBar
              canUndo={historyControls.canUndo}
              canRedo={historyControls.canRedo}
              loading={historyControls.loading}
              onUndo={historyControls.onUndo}
              onRedo={historyControls.onRedo}
              onRevert={historyControls.onRevert}
            />
          )}
          {/* Idle → open the panel onto its home state. In select mode → cancel. */}
          <MuseFab
            active={active}
            loading={loading}
            entering={closing}
            onToggle={() => (active ? setActive(false) : setOpen(true))}
          />
        </div>
      )}

      {active && selection.length >= 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <SelectionTray count={selection.length} onDesign={() => setActive(false)} />
        </div>
      )}

      {panelOpen && (
        <div className="absolute bottom-6 right-6">
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
            {historyOpen ? (
              <MuseHistory entries={archived} onPick={openFromHistory} />
            ) : home ? (
              <MuseHome
                onSelect={() => setActive(true)}
                onShowDesign={showDesign}
                bubbles={thread}
                onGenerateDesign={generateDesign}
              />
            ) : (
            <>
            <ActiveTargetStrip
              elements={selection}
              mock={MOCK}
              onRemove={removeChip}
              onSwapTarget={() => setActive(true)}
              onShowDesign={showDesign}
            />
            {unmappable ? (
              <div className="flex-1 overflow-y-auto px-4 py-3.5">
                <p className="text-sm leading-relaxed text-amber-300/80">
                  Couldn't map this element to a source file. Try clicking page content — it works best
                  inside <code className="rounded bg-line/10 px-1 text-amber-200">src/demo/</code>.
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
}
