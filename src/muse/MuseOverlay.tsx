import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShadowHost } from './hooks/useShadowHost'
import { museWrite } from './api'
import { useHostTheme } from './hooks/useHostTheme'
import { museStore, useMuseStore } from './store'
import { CanvasMode } from './components/canvas/CanvasMode'
import { MuseToolbar } from './components/MuseToolbar'
import { RevertConfirmDialog } from './components/RevertConfirmDialog'

const EXIT_MS = 240 // keep in sync with the longest close animation: muse-fab-catch (40ms delay + 200ms)

export type HistoryControls = {
  canUndo: boolean
  canRedo: boolean
  loading: boolean
  onUndo: () => void
  onRedo: () => void
  onRevert: () => void
}

export function MuseOverlay() {
  const { past, future, historyLoading, showRevertConfirm } = useMuseStore()

  // Panel visibility. The FAB opens Canvas's selection surface; an explicit close
  // shuts it. EXIT_MS lets the dock morph back to the FAB before Canvas unmounts.
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The overlay chrome renders inside an isolated Shadow DOM root (see
  // useShadowHost) so its CSS can't collide with the host page's styles.
  const shadowMount = useShadowHost()

  // Pass shadowMount so the theme re-applies once the overlay is actually
  // portaled in — rootRef.current is null until that async mount lands.
  useHostTheme(rootRef, shadowMount)

  function requestClose() {
    if (closing) return
    setClosing(true)
    // Defer teardown into the timer so a cancelClose mid-collapse leaves the
    // session intact; the dock morphs toolbar → FAB across the same window.
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, EXIT_MS)
  }

  // Abort an in-flight close (the FAB was clicked mid-collapse). Clearing `closing`
  // reverses the CSS transition home from wherever the collapse had reached.
  function cancelClose() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosing(false)
  }

  // Undo/redo/revert on the shared file-content history stack — the same stack a
  // Canvas commit lands in. CanvasMode also drives Cmd/Ctrl+Z directly; these are
  // the toolbar buttons. (EPHEMERAL Canvas edits use the in-browser ephemeral
  // stack via CanvasMode's keyboard path, so `past`/`future` stay empty there.)
  // Each reads a FRESH store snapshot (not the render-time closure) and bails while
  // a write is already in flight, so a rapid double-click — or the toolbar button
  // racing CanvasMode's Cmd/Ctrl+Z — can't enqueue two writes against one entry.
  async function undo() {
    const s = museStore.getState()
    if (s.historyLoading || s.past.length === 0) return
    const entry = s.past[s.past.length - 1]
    museStore.setState({ historyLoading: true })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.before })))
      museStore.setState((st) => ({ past: st.past.slice(0, -1), future: [entry, ...st.future] }))
    } catch (e) {
      console.error('[muse] undo failed', e)
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function redo() {
    const s = museStore.getState()
    if (s.historyLoading || s.future.length === 0) return
    const entry = s.future[0]
    museStore.setState({ historyLoading: true })
    try {
      await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f.after })))
      museStore.setState((st) => ({ future: st.future.slice(1), past: [...st.past, entry] }))
    } catch (e) {
      console.error('[muse] redo failed', e)
    } finally {
      museStore.setState({ historyLoading: false })
    }
  }

  async function revertToOriginal() {
    const s = museStore.getState()
    if (s.historyLoading || s.past.length === 0) return
    museStore.setState({ historyLoading: true })
    try {
      // Restore every touched file to its EARLIEST pre-Muse content.
      const earliest = new Map<string, string>()
      for (const entry of s.past) {
        for (const f of entry.files) if (!earliest.has(f.fileName)) earliest.set(f.fileName, f.before)
      }
      await museWrite([...earliest].map(([fileName, before]) => ({ fileName, newContent: before })))
      museStore.setState({ past: [], future: [], showRevertConfirm: false })
    } catch (e) {
      console.error('[muse] revert failed', e)
      museStore.setState({ showRevertConfirm: false })
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

  // Global hotkey: R toggles Muse on/off from anywhere on the page. Guarded so it
  // never fires while typing — composedPath()[0] is the REAL focused node even
  // through the overlay's Shadow DOM (a document-level event is retargeted to the
  // host, so e.target alone would miss the overlay's own inputs). Modifier combos
  // (e.g. Cmd/Ctrl+R reload) are left to the browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.composedPath()[0] as HTMLElement | undefined
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      if (open && !closing) requestClose()
      else if (closing) cancelClose()
      else setOpen(true)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing])

  const tree = (
    <div ref={rootRef} data-muse-ui className="pointer-events-none fixed inset-0 z-[999999] font-sans">
      {/* The selection surface: hover highlight + on-canvas chrome + the properties
          card. Plain-click edits directly. Unmounts at the start of the close so the
          chrome clears before the dock collapses. */}
      {open && !closing && <CanvasMode onExit={requestClose} />}

      {/* The dock — one pill that morphs between the FAB (closed) and the idle
          toolbar (manta · design tokens · pause · X). Opening expands the FAB in
          place into the toolbar; the design tokens open as a popover above the bar.
          Rendered always: it's the FAB when closed and the toolbar when open, and it
          catches the collapsing toolbar during a close. */}
      <MuseToolbar
        expanded={open && !closing}
        onOpen={() => (closing ? cancelClose() : setOpen(true))}
        onClose={requestClose}
        hasHistory={hasHistory}
        historyControls={historyControls}
        animationsPaused={animationsPaused}
        onToggleAnimations={() => setAnimationsPaused((v) => !v)}
      />

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
