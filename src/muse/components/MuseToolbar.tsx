import { useEffect, useState, type ReactNode } from 'react'
import { Palette, Pause, Play, X } from '@phosphor-icons/react'
import type { HistoryControls } from '../MuseOverlay'
import { usePresence } from '../hooks/usePresence'
import { UfoIcon } from './UfoIcon'
import { UndoRedoBar } from './UndoRedoBar'
import { TokenList } from './TokenList'

// Muse's idle dock — ONE persistent pill that morphs between the FAB and the
// toolbar. Collapsed it's the FAB (manta + "Muse"); expanded it's the toolbar
// (manta + tokens · pause · X). The transition is a real expand: the trailing
// label and the icon group animate their max-width, so the same pill physically
// widens leftward out of the FAB (and shrinks back on close) instead of one
// element scale-popping in over another. The dock is pure utility; the design
// tokens open as a popover above it (the bar stays put).

type Pop = 'none' | 'tokens'

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
  portalContainer,
}: {
  // True = toolbar form (Muse open, idle); false = FAB form (Muse closed/collapsing).
  expanded: boolean
  onOpen: () => void
  onClose: () => void
  hasHistory: boolean
  historyControls: HistoryControls
  animationsPaused: boolean
  onToggleAnimations: () => void
  // Themed overlay root the token color-picker popover portals into (escapes the
  // popover's own overflow + backdrop-filter containing block).
  portalContainer?: React.RefObject<HTMLElement>
}) {
  const [pop, setPop] = useState<Pop>('none')
  // Any time the pill collapses back to the FAB, dismiss an open popover.
  useEffect(() => { if (!expanded) setPop('none') }, [expanded])
  // Keep the popover mounted through its exit so it scales/fades back into the bar.
  const { mounted: popMounted, state: popState } = usePresence(expanded && pop === 'tokens')

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

      {/* Popover — scales up from the bar/FAB corner below it (grows from the bar on
          open, shrinks back on close via usePresence + .muse-pop). Same surface as
          the canvas properties panel (rounded-xl / blur / ring) and marked
          data-muse-panel so the token color-picker anchors beside it. */}
      {popMounted && (
        <div data-muse-panel data-state={popState} className="muse-pop w-64 overflow-hidden rounded-xl bg-surface/95 shadow-xl shadow-black/20 ring-1 ring-line/10 backdrop-blur" style={{ '--muse-pop-origin': 'bottom right' } as React.CSSProperties}>
          <header className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-[12px] font-semibold tracking-tight text-fg">Design tokens</span>
            <button
              onClick={() => setPop('none')}
              aria-label="Close design tokens"
              className="-mr-1 rounded-md p-1 text-fg-faint transition hover:bg-line/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <X size={13} />
            </button>
          </header>
          <div className="max-h-[50vh] overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line/20">
            <TokenList portalContainer={portalContainer} />
          </div>
        </div>
      )}

      {/* The morphing pill. mounts with the FAB "catch" (only fires on a fresh
          mount — i.e. at startup — never on the in-place FAB↔toolbar morph,
          since the element persists across it). */}
      <div className="flex items-center rounded-full bg-surface-soft p-1.5 shadow-lg shadow-black/20 ring-1 ring-line/10 animate-muse-fab-catch motion-reduce:animate-none">
        {/* Leading: manta + "Muse" label. Collapsed, the whole thing is the FAB
            (click to open). Expanded, the label collapses to 0 and this is just
            the manta (identity). */}
        <button
          type="button"
          onClick={() => { if (!expanded) onOpen() }}
          aria-label={expanded ? 'Muse' : 'Open Muse'}
          aria-expanded={expanded}
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
          <IconBtn label="Design tokens" onClick={() => setPop((p) => (p === 'tokens' ? 'none' : 'tokens'))} active={pop === 'tokens'}>
            <Palette size={17} />
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
