import type { ReactNode } from 'react'
import { ArrowCounterClockwise, ArrowUUpLeft, ArrowUUpRight } from '@phosphor-icons/react'

type Props = {
  canUndo: boolean
  canRedo: boolean
  loading: boolean
  onUndo: () => void
  onRedo: () => void
  onRevert: () => void
}

// Icon-only, styled to match the expanded FAB/toolbar pill (rounded-full,
// bg-surface-soft, the same soft shadow) — it sits just above the FAB, so it
// reads as part of the same dock rather than a separate heavy bar.
export function UndoRedoBar({ canUndo, canRedo, loading, onUndo, onRedo, onRevert }: Props) {
  return (
    // No mount animation on purpose: this bar mounts/unmounts whenever the history
    // stack empties and refills (undo-all then edit, revert then edit), so a keyframe
    // entrance would replay distractingly mid-work (Emil: don't animate frequent
    // state). It just appears, quietly.
    <div className="pointer-events-auto flex items-center rounded-full bg-surface-soft p-1.5 shadow-lg shadow-black/20 ring-1 ring-line/10">
      <HistoryBtn onClick={onUndo} disabled={!canUndo || loading} label="Undo" icon={<ArrowUUpLeft size={16} />} />
      <HistoryBtn onClick={onRedo} disabled={!canRedo || loading} label="Redo" icon={<ArrowUUpRight size={16} />} />
      <span className="mx-0.5 h-5 w-px shrink-0 bg-line/15" />
      <HistoryBtn
        onClick={onRevert}
        disabled={!canUndo || loading}
        label="Revert to original"
        icon={<ArrowCounterClockwise size={16} />}
        danger
      />
    </div>
  )
}

function HistoryBtn({
  onClick,
  disabled,
  label,
  icon,
  danger = false,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  icon: ReactNode
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:active:scale-100 ${
        danger
          ? 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:ring-rose-500/40'
          : 'text-fg-faint hover:bg-line/10 hover:text-fg focus-visible:ring-accent/50'
      }`}
    >
      {icon}
    </button>
  )
}
