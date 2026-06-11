import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Flag, GearSix, Palette, PaperPlaneTilt, Pause, Play, X } from '@phosphor-icons/react'
import type { HistoryControls } from '../MuseOverlay'
import { EPHEMERAL, MOCK } from '../config'
import { usePresence } from '../hooks/usePresence'
import { useMuseStore } from '../store'
import { computeSessionChanges } from '../sessionChanges'
import { UfoIcon } from './UfoIcon'
import { UndoRedoBar } from './UndoRedoBar'
import { TokenList } from './TokenList'
import { FlagsPanel } from './FlagsPanel'
import { ChangesPanel } from './ChangesPanel'
import { SettingsPanel } from './SettingsPanel'
import type { DockCorner } from '../prefs'

// Muse's idle dock — ONE persistent pill that morphs between the FAB and the
// toolbar. Collapsed it's the FAB (manta + "Muse"); expanded it's the toolbar
// (manta + tokens · pause · X). The transition is a real expand: the trailing
// label and the icon group animate their max-width, so the same pill physically
// widens leftward out of the FAB (and shrinks back on close) instead of one
// element scale-popping in over another. The dock is pure utility; the design
// tokens open as a popover above it (the bar stays put).

type Pop = 'none' | 'tokens' | 'flags' | 'changes' | 'settings'

// The Changes/Share surface needs the real backend (session edits must be on disk
// to become a branch) — in the in-browser demo modes the button is hidden entirely.
const SHARE_UI = !EPHEMERAL && !MOCK

const POP_TITLES = { tokens: 'Design tokens', flags: 'Flags', changes: 'Changes', settings: 'Settings' } as const

// Dock placement per corner: position + which edge children align to + column
// direction (top corners flip the column so the popover/undo bar open DOWNWARD
// from the pill instead of off-screen).
const DOCK_POS: Record<DockCorner, string> = {
  br: 'bottom-6 right-6 items-end flex-col',
  bl: 'bottom-6 left-6 items-start flex-col',
  tr: 'top-6 right-6 items-end flex-col-reverse',
  tl: 'top-6 left-6 items-start flex-col-reverse',
}
// The popover scales from the pill-facing corner, so it grows out of the bar.
const POP_ORIGIN: Record<DockCorner, string> = {
  br: 'bottom right',
  bl: 'bottom left',
  tr: 'top right',
  tl: 'top left',
}
// The zen reveal hotspot hugs the dock's corner.
const HOTSPOT_POS: Record<DockCorner, string> = {
  br: 'bottom-0 right-0',
  bl: 'bottom-0 left-0',
  tr: 'top-0 right-0',
  tl: 'top-0 left-0',
}

function IconBtn({ label, onClick, children, active, expanded, badge }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; expanded?: boolean; badge?: number }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      // `active` is only passed by toggle buttons (e.g. pause/resume animations), so
      // emit aria-pressed only when it's defined — a plain action button stays
      // undefined and renders no pressed semantic. Color is then not the lone signal.
      // Popover TRIGGERS pass `expanded` instead: a disclosure announces
      // expanded/collapsed, not pressed (the visual active tint is shared).
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      // active = a sticky "on" state (e.g. animations paused) — the brick accent
      // tint + tone, the same selected/active treatment the panel header uses.
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-95 motion-reduce:active:scale-100 ${
        active || expanded ? 'bg-accent/10 text-accent' : 'text-fg-faint hover:bg-line/10 hover:text-fg'
      }`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute right-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white ring-1 ring-surface-soft">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
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
  // The content kept rendered through the popover's EXIT (when `pop` is already 'none'),
  // so it doesn't flash the other panel while it scales back into the bar.
  const [shownPop, setShownPop] = useState<Exclude<Pop, 'none'>>('tokens')
  useEffect(() => { if (pop !== 'none') setShownPop(pop) }, [pop])
  // Open flags drive the count badge on the Flags button; net-changed files drive
  // the Changes badge (both reactive — undo shrinks the changes count live).
  const { flags, past, prefs } = useMuseStore()
  const openFlagCount = flags.filter((f) => f.status === 'open').length
  const changedFileCount = SHARE_UI ? computeSessionChanges(past).filter((c) => c.changed).length : 0
  // Zen: the whole dock stays hidden until the corner hotspot is hovered; it
  // re-hides when the pointer leaves (unless a popover is open — closing the
  // settings you just opened out from under your cursor would be hostile).
  const [revealed, setRevealed] = useState(false)
  const zenHidden = prefs.zen && !revealed
  useEffect(() => { if (!prefs.zen) setRevealed(false) }, [prefs.zen])
  // Any time the pill collapses back to the FAB, dismiss an open popover.
  useEffect(() => { if (!expanded) setPop('none') }, [expanded])
  // Keep the popover mounted through its exit so it scales/fades back into the bar.
  const { mounted: popMounted, state: popState } = usePresence(expanded && pop !== 'none')
  // NO focus trap here, deliberately: the popover is a non-modal disclosure (the
  // page and the rest of the toolbar stay interactive), and the APG pattern for
  // those is free Tab order, never a trap — that's reserved for aria-modal
  // dialogs (RevertConfirmDialog). Esc with focus inside closes just the popover.
  const popRef = useRef<HTMLDivElement>(null)

  return (
    <>
      {/* The zen reveal hotspot: a small invisible target hugging the dock's
          corner, present only while the dock is hidden. */}
      {zenHidden && (
        <div
          aria-hidden
          className={`pointer-events-auto absolute z-[999999] h-12 w-12 ${HOTSPOT_POS[prefs.corner]}`}
          onPointerEnter={() => setRevealed(true)}
        />
      )}
    <div
      data-muse-dock
      className={`pointer-events-auto absolute z-[999999] flex gap-3 ${DOCK_POS[prefs.corner]} ${
        zenHidden ? 'pointer-events-none opacity-0' : 'opacity-100'
      } transition-opacity duration-200`}
      onPointerLeave={() => {
        if (prefs.zen && pop === 'none') setRevealed(false)
      }}
    >
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
        <div
          ref={popRef}
          data-muse-panel
          data-state={popState}
          className="muse-pop w-64 overflow-hidden rounded-xl bg-surface/95 shadow-xl shadow-black/20 ring-1 ring-line/10 backdrop-blur"
          style={{ '--muse-pop-origin': POP_ORIGIN[prefs.corner] } as React.CSSProperties}
          onKeyDown={(e) => {
            // An open color picker's own document-capture Esc handler runs first
            // and stops propagation (closing only the picker) — this fires only
            // when the popover itself owns the Esc.
            if (e.key === 'Escape') {
              e.stopPropagation()
              setPop('none')
            }
          }}
        >
          <header className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-[12px] font-semibold tracking-tight text-fg">{POP_TITLES[shownPop]}</span>
            <button
              type="button"
              onClick={() => setPop('none')}
              aria-label={`Close ${POP_TITLES[shownPop].toLowerCase()}`}
              className="-mr-1 rounded-md p-1 text-fg-faint transition hover:bg-line/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <X size={13} />
            </button>
          </header>
          <div className="max-h-[340px] overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line/20">
            {shownPop === 'flags' ? <FlagsPanel /> : shownPop === 'changes' ? <ChangesPanel /> : shownPop === 'settings' ? <SettingsPanel /> : <TokenList portalContainer={portalContainer} />}
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
          {SHARE_UI && (
            <IconBtn
              label={changedFileCount > 0 ? `Changes, ${changedFileCount} file${changedFileCount === 1 ? '' : 's'}` : 'Changes'}
              onClick={() => setPop((p) => (p === 'changes' ? 'none' : 'changes'))}
              expanded={pop === 'changes'}
              badge={changedFileCount}
            >
              <PaperPlaneTilt size={17} />
            </IconBtn>
          )}
          <IconBtn
            label={openFlagCount > 0 ? `Flags, ${openFlagCount} open` : 'Flags'}
            onClick={() => setPop((p) => (p === 'flags' ? 'none' : 'flags'))}
            expanded={pop === 'flags'}
            badge={openFlagCount}
          >
            <Flag size={17} />
          </IconBtn>
          <IconBtn label="Design tokens" onClick={() => setPop((p) => (p === 'tokens' ? 'none' : 'tokens'))} expanded={pop === 'tokens'}>
            <Palette size={17} />
          </IconBtn>
          <IconBtn
            label={animationsPaused ? 'Resume animations' : 'Pause animations'}
            onClick={onToggleAnimations}
            active={animationsPaused}
          >
            {animationsPaused ? <Play size={17} weight="fill" /> : <Pause size={17} />}
          </IconBtn>
          <IconBtn label="Settings" onClick={() => setPop((p) => (p === 'settings' ? 'none' : 'settings'))} expanded={pop === 'settings'}>
            <GearSix size={17} />
          </IconBtn>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-line/15" />
          <IconBtn label="Close Muse" onClick={onClose}>
            <X size={16} weight="bold" />
          </IconBtn>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
