import type { ReactNode } from 'react'
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  ClockCounterClockwise,
  X,
} from '@phosphor-icons/react'
import type { HistoryControls } from '../MuseOverlay'

// Panel chrome: rounded card + header + a flexbox column slot below.
// Content (target strip + thread + composer) is composed in MuseOverlay
// and dropped into the children slot. MusePanel intentionally knows
// nothing about the thread or its state — it's just the surface.
export function MusePanel({
  mock = false,
  closing = false,
  historyControls,
  archivedCount = 0,
  showingHistory = false,
  onToggleHistory,
  onClose,
  children,
}: {
  mock?: boolean
  closing?: boolean
  historyControls?: HistoryControls
  archivedCount?: number
  showingHistory?: boolean
  onToggleHistory?: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      // Open/close is a CSS transition (muse.css `.muse-panel-surface`), driven
      // by data-closing — interruptible, so a mid-collapse reopen reverses
      // smoothly. transform-origin / reduced-motion live in that CSS class.
      data-closing={closing}
      className="muse-panel-surface pointer-events-auto flex max-h-[40vh] w-[380px] flex-col overflow-hidden rounded-2xl bg-surface/95 text-fg shadow-xl shadow-black/20 ring-1 ring-line/10 backdrop-blur-xl"
    >
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
          Muse
          {mock && (
            <span className="ml-1 rounded border border-line/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onToggleHistory && (
            <HeaderIconBtn
              onClick={onToggleHistory}
              disabled={false}
              label={
                showingHistory
                  ? 'Back to conversation'
                  : archivedCount > 0
                    ? `Closed proposals (${archivedCount})`
                    : 'Closed proposals'
              }
              icon={<ClockCounterClockwise size={15} />}
              active={showingHistory}
            />
          )}
          {historyControls && (
            <>
              {/* Divider only when the clock is also present — the closed-proposals
                  view is a different category from the live undo/redo actions,
                  mirroring the divider before the close button. */}
              {onToggleHistory && <div className="mx-1 h-3.5 w-px bg-line/10" />}
              <HeaderIconBtn
                onClick={historyControls.onUndo}
                disabled={!historyControls.canUndo || historyControls.loading}
                label="Undo"
                icon={<ArrowUUpLeft size={15} />}
              />
              <HeaderIconBtn
                onClick={historyControls.onRedo}
                disabled={!historyControls.canRedo || historyControls.loading}
                label="Redo"
                icon={<ArrowUUpRight size={15} />}
              />
              <HeaderIconBtn
                onClick={historyControls.onRevert}
                disabled={!historyControls.canUndo || historyControls.loading}
                label="Revert to original"
                icon={<ArrowCounterClockwise size={15} />}
                danger
              />
              <div className="mx-1 h-3.5 w-px bg-line/10" />
            </>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-fg-faint transition hover:bg-line/5 hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

function HeaderIconBtn({
  onClick,
  disabled,
  label,
  icon,
  danger = false,
  active = false,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  icon: ReactNode
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? 'bg-accent/10 text-accent'
          : danger
            ? 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
            : 'text-fg-faint hover:bg-line/5 hover:text-fg'
      }`}
    >
      {icon}
    </button>
  )
}
