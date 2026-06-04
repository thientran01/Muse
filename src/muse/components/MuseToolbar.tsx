import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Pause, Play, X } from '@phosphor-icons/react'
import { museDesignGenerate, museDesignGet } from '../api'
import type { DesignGeneratorStatus } from '../types'
import type { HistoryControls } from '../MuseOverlay'
import { UfoIcon } from './UfoIcon'
import { UndoRedoBar } from './UndoRedoBar'
import { MessageDesign } from './messages/MessageDesign'

// Muse's idle dock — ONE persistent pill that morphs between the FAB and the
// toolbar. Collapsed it's the FAB (manta + "Muse"); expanded it's the toolbar
// (manta + design · pause · X). The transition is a real expand: the trailing
// label and the icon group animate their max-width, so the same pill physically
// widens leftward out of the FAB (and shrinks back on close) instead of one
// element scale-popping in over another. The dock is pure utility; the design
// brief opens as a popover above it (the bar stays put).

type Pop = 'none' | 'design'
type DesignState = {
  status: 'offer' | 'generating' | 'view'
  content?: string
  path?: string
  generator?: DesignGeneratorStatus
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      // `active` is only passed by toggle buttons (e.g. pause/resume animations), so
      // emit aria-pressed only when it's defined — a plain action button stays
      // undefined and renders no pressed semantic. Color is then not the lone signal.
      aria-pressed={active}
      // active = a sticky "on" state (e.g. animations paused) — the brick accent
      // tint + tone, the same selected/active treatment the panel header uses.
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-95 motion-reduce:active:scale-100 ${
        active ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-line/10 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

export function MuseToolbar({
  expanded,
  onOpen,
  onClose,
  hasHistory,
  historyControls,
  animationsPaused,
  onToggleAnimations,
}: {
  // True = toolbar form (Muse open, idle); false = FAB form (Muse closed/collapsing).
  expanded: boolean
  onOpen: () => void
  onClose: () => void
  hasHistory: boolean
  historyControls: HistoryControls
  animationsPaused: boolean
  onToggleAnimations: () => void
}) {
  const [pop, setPop] = useState<Pop>('none')
  const [design, setDesign] = useState<DesignState | null>(null)
  // `mounted` drops a late setState if the dock unmounts mid-fetch (the design
  // generate can run ~45s, outliving a popover close).
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // Any time the pill collapses back to the FAB, dismiss an open popover.
  useEffect(() => { if (!expanded) setPop('none') }, [expanded])

  // Fetch the brief the first time the popover opens, and keep it cached after.
  // An effect (not the click handler) is the robust path: there are no fetch
  // guards to get wedged, and if a run is cancelled (popover closed mid-fetch)
  // `design` stays null so reopening simply re-fetches — it can never strand on
  // a permanent "Loading…". `design` resolves to a non-null state on success OR
  // error, so the fallback below only ever shows during a live fetch.
  useEffect(() => {
    if (pop !== 'design' || design) return
    let cancelled = false
    museDesignGet()
      .then((res) => {
        if (cancelled) return
        setDesign(
          res.exists && res.content
            ? { status: 'view', content: res.content, path: res.path }
            : { status: 'offer', generator: res.generator },
        )
      })
      .catch(() => { if (!cancelled) setDesign({ status: 'offer' }) })
    return () => { cancelled = true }
  }, [pop, design])

  const generateDesign = async () => {
    setDesign((d) => ({ status: 'generating', generator: d?.generator }))
    try {
      const res = await museDesignGenerate()
      if (mountedRef.current) setDesign({ status: 'view', content: res.content, path: res.path })
    } catch {
      if (mountedRef.current) setDesign((d) => ({ status: 'offer', generator: d?.generator }))
    }
  }

  return (
    <div data-muse-dock className="pointer-events-auto absolute bottom-6 right-6 z-[999999] flex flex-col items-end gap-3">
      {/* Undo/redo floats above the dock whenever there's history — in both the
          FAB and toolbar forms (Canvas commits land on this same stack). */}
      {hasHistory && (
        <UndoRedoBar
          canUndo={historyControls.canUndo}
          canRedo={historyControls.canRedo}
          loading={historyControls.loading}
          onUndo={historyControls.onUndo}
          onRedo={historyControls.onRedo}
          onRevert={historyControls.onRevert}
        />
      )}

      {/* Popover — only when expanded; scales up from the bar/FAB corner below it. */}
      {expanded && pop !== 'none' && (
        <div className="w-72 origin-bottom-right animate-muse-panel overflow-hidden rounded-2xl bg-surface/95 shadow-xl shadow-black/20 ring-1 ring-line/10 backdrop-blur-xl motion-reduce:animate-none">
          <header className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
              <UfoIcon size={16} className="text-accent" />
              Design system
            </div>
            <button
              onClick={() => setPop('none')}
              aria-label="Close design system"
              className="rounded-md p-1.5 text-fg-faint transition hover:bg-line/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <X size={15} />
            </button>
          </header>
          <div className="max-h-[50vh] overflow-y-auto px-3 pb-3">
            {design ? (
              <MessageDesign status={design.status} content={design.content} path={design.path} generator={design.generator} onGenerate={generateDesign} />
            ) : (
              <p className="px-1 py-2 text-xs text-fg-faint">Loading…</p>
            )}
          </div>
        </div>
      )}

      {/* The morphing pill. mounts with the FAB "catch" (only fires on a fresh
          mount — e.g. after the agent panel closes — never on the in-place
          FAB↔toolbar morph, since the element persists across it). */}
      <div className="flex items-center rounded-full bg-surface-soft p-1.5 shadow-lg shadow-black/20 ring-1 ring-line/10 animate-muse-fab-catch motion-reduce:animate-none">
        {/* Leading: manta + "Muse" label. Collapsed, the whole thing is the FAB
            (click to open). Expanded, the label collapses to 0 and this is just
            the manta (identity). */}
        <button
          type="button"
          onClick={() => { if (!expanded) onOpen() }}
          aria-label={expanded ? 'Muse' : 'Open Muse'}
          className={`flex shrink-0 items-center rounded-full ${expanded ? 'cursor-default' : ''}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <UfoIcon size={18} className="text-accent" />
          </span>
          <span className="muse-dock-trail" style={{ gridTemplateColumns: expanded ? '0fr' : '1fr', opacity: expanded ? 0 : 1 }}>
            {/* Mirror the trailing group: a FLEX box as the grid item. A bare text
                node won't shrink below its word width at 0fr (it would just go
                transparent and hold a ~37–51px phantom gap), but a flex container
                compresses to 0 and clips the inner label AND its padding — so the
                manta sits flush with the icons when expanded, then the box grows
                back to the label width at 1fr in the collapsed FAB. */}
            <span className="flex">
              <span className="pl-1 pr-2.5 text-sm font-medium text-fg">Muse</span>
            </span>
          </span>
        </button>

        {/* Trailing: the toolbar icons. Their grid column grows 0fr->1fr to the
            EXACT content width as the label collapses, so the pill widens leftward
            monotonically — the FAB expanding, no overshoot. */}
        <div className="muse-dock-trail" style={{ gridTemplateColumns: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}>
          <div className="flex items-center">
          <IconBtn label="Design system" onClick={() => setPop((p) => (p === 'design' ? 'none' : 'design'))}>
            <FileText size={17} />
          </IconBtn>
          <IconBtn
            label={animationsPaused ? 'Resume animations' : 'Pause animations'}
            onClick={onToggleAnimations}
            active={animationsPaused}
          >
            {animationsPaused ? <Play size={17} weight="fill" /> : <Pause size={17} />}
          </IconBtn>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-line/15" />
          <IconBtn label="Close Muse" onClick={onClose}>
            <X size={16} weight="bold" />
          </IconBtn>
          </div>
        </div>
      </div>
    </div>
  )
}
