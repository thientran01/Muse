import { useEffect, useRef, useState } from 'react'
import { Flag, GearSix, Palette, PaperPlaneTilt, Pause, Play, X } from '@phosphor-icons/react'
import type { HistoryControls } from '../MuseOverlay'
import { EPHEMERAL, MOCK } from '../config'
import { usePresence } from '../hooks/usePresence'
import { useTransientSurface } from '../hooks/useTransientSurface'
import { useMuseStore } from '../store'
import { computeSessionChanges } from '../sessionChanges'
import { IconButton } from './ui'
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
  // One-transient-surface discipline: the open popover claims the shared slot,
  // so a panel color picker opening closes it (and vice versa).
  useTransientSurface(pop !== 'none', () => setPop('none'))
  // The content kept rendered through the popover's EXIT (when `pop` is already 'none'),
  // so it doesn't flash the other panel while it scales back into the bar.
  const [shownPop, setShownPop] = useState<Exclude<Pop, 'none'>>('tokens')
  useEffect(() => { if (pop !== 'none') setShownPop(pop) }, [pop])
  // Open flags drive the count badge on the Flags button; net-changed files drive
  // the Changes badge (both reactive — undo shrinks the changes count live).
  const { flags, past, prefs } = useMuseStore()
  const openFlagCount = flags.filter((f) => f.status === 'open').length
  const changedFileCount = SHARE_UI ? computeSessionChanges(past).filter((c) => c.changed).length : 0
  // Zen: the dock stays hidden, revealed two ways — hovering its corner, or any
  // open/close of Muse itself (the PEEK below). It re-hides when the pointer
  // leaves (unless a popover is open — closing the settings you just opened out
  // from under your cursor would be hostile).
  const [revealed, setRevealed] = useState(false)
  const zenHidden = prefs.zen && !revealed
  // Live mirrors for the peek timer's closure (state would be stale inside it).
  const popLive = useRef(pop)
  popLive.current = pop
  const overDock = useRef(false)
  const peekTimer = useRef<number | null>(null)
  useEffect(() => {
    // Flipping zen ON happens inside the Settings popover — count that as
    // revealed, or the dock (and the popover the cursor is in) would vanish on
    // the same render. The dock then hides on the NEXT pointer-leave, after the
    // popover is closed. Turning zen off clears the stale reveal.
    if (prefs.zen && pop !== 'none') setRevealed(true)
    if (!prefs.zen) setRevealed(false)
  }, [prefs.zen, pop])
  // THE PEEK — the recovery affordance zen shipped without (the invisible corner
  // hotspot alone left a real user unable to find Muse at all): any open/close of
  // Muse (R, the FAB) shows the dock, which tucks itself away again after a
  // moment unless the pointer is on it or a popover is open. Firing on MOUNT is
  // deliberate too: a returning zen user gets a brief "Muse lives here" cue on
  // page load instead of a silently invisible tool.
  useEffect(() => {
    if (!prefs.zen) return
    setRevealed(true)
    if (peekTimer.current) window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      if (popLive.current === 'none' && !overDock.current) setRevealed(false)
    }, 2500)
    return () => {
      if (peekTimer.current) window.clearTimeout(peekTimer.current)
    }
  }, [expanded, prefs.zen])
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
          className={`pointer-events-auto absolute z-[999999] h-16 w-16 ${HOTSPOT_POS[prefs.corner]}`}
          onPointerEnter={() => setRevealed(true)}
        />
      )}
    <div
      data-muse-dock
      // pointer-events is EXCLUSIVE per state — never both classes at once. With
      // both present, the generated stylesheet's order decides (not className
      // order), and `auto` won: the hidden dock stayed interactive (invisible
      // tooltips, swallowed clicks) AND sat over the hotspot, eating the hover
      // that was supposed to reveal it.
      className={`absolute z-[999999] flex gap-3 ${DOCK_POS[prefs.corner]} ${
        zenHidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
      } transition-opacity duration-200`}
      onPointerEnter={() => {
        overDock.current = true
        // The pointer arriving on the dock holds an in-flight peek open.
        if (peekTimer.current) window.clearTimeout(peekTimer.current)
      }}
      onPointerLeave={() => {
        overDock.current = false
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
          the canvas properties panel (rounded-panel / blur / ring) and marked
          data-muse-panel so the token color-picker anchors beside it. */}
      {popMounted && (
        <div
          ref={popRef}
          data-muse-panel
          data-state={popState}
          className="muse-pop w-64 overflow-hidden rounded-panel bg-surface/95 shadow-pop ring-1 ring-hairline backdrop-blur-overlay"
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
            <span className="text-title font-semibold text-fg">{POP_TITLES[shownPop]}</span>
            <button
              type="button"
              onClick={() => setPop('none')}
              aria-label={`Close ${POP_TITLES[shownPop].toLowerCase()}`}
              className="-mr-1 rounded-field p-1 text-fg-faint transition hover:bg-scrim hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X size={13} />
            </button>
          </header>
          <div className="max-h-[340px] overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-track-quiet">
            {shownPop === 'flags' ? <FlagsPanel /> : shownPop === 'changes' ? <ChangesPanel /> : shownPop === 'settings' ? <SettingsPanel /> : <TokenList portalContainer={portalContainer} />}
          </div>
        </div>
      )}

      {/* The morphing pill. mounts with the FAB "catch" (only fires on a fresh
          mount — i.e. at startup — never on the in-place FAB↔toolbar morph,
          since the element persists across it). */}
      <div className="flex items-center rounded-full bg-surface-soft p-1.5 shadow-dock ring-1 ring-hairline animate-muse-fab-catch motion-reduce:animate-none">
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
              <span className="pl-1 pr-2.5 text-row font-medium text-fg">Muse</span>
            </span>
          </span>
        </button>

        {/* Trailing: the toolbar icons. Their grid column grows 0fr->1fr to the
            EXACT content width as the label collapses, so the pill widens leftward
            monotonically — the FAB expanding, no overshoot. */}
        <div className="muse-dock-trail" style={{ gridTemplateColumns: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}>
          <div className="flex items-center">
          {SHARE_UI && (
            <IconButton
              label={changedFileCount > 0 ? `Changes, ${changedFileCount} file${changedFileCount === 1 ? '' : 's'}` : 'Changes'}
              onClick={() => setPop((p) => (p === 'changes' ? 'none' : 'changes'))}
              expanded={pop === 'changes'}
              badge={changedFileCount}
            >
              <PaperPlaneTilt size={17} />
            </IconButton>
          )}
          <IconButton
            label={openFlagCount > 0 ? `Flags, ${openFlagCount} open` : 'Flags'}
            onClick={() => setPop((p) => (p === 'flags' ? 'none' : 'flags'))}
            expanded={pop === 'flags'}
            badge={openFlagCount}
          >
            <Flag size={17} />
          </IconButton>
          <IconButton label="Design tokens" onClick={() => setPop((p) => (p === 'tokens' ? 'none' : 'tokens'))} expanded={pop === 'tokens'}>
            <Palette size={17} />
          </IconButton>
          <IconButton
            label={animationsPaused ? 'Unfreeze page' : 'Freeze page'}
            onClick={onToggleAnimations}
            active={animationsPaused}
          >
            {animationsPaused ? <Play size={17} weight="fill" /> : <Pause size={17} />}
          </IconButton>
          <IconButton label="Settings" onClick={() => setPop((p) => (p === 'settings' ? 'none' : 'settings'))} expanded={pop === 'settings'}>
            <GearSix size={17} />
          </IconButton>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-hairline-strong" />
          <IconButton label="Close Muse" onClick={onClose}>
            <X size={16} weight="bold" />
          </IconButton>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
