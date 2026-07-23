import { ArrowCounterClockwise, ArrowUUpLeft, ArrowUUpRight } from '@phosphor-icons/react'
import { IconButton } from './ui'

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
    <div className="pointer-events-auto flex items-center rounded-full bg-surface-soft p-1.5 shadow-dock ring-1 ring-hairline">
      <IconButton onClick={onUndo} disabled={!canUndo || loading} label="Undo">
        <ArrowUUpLeft size={16} />
      </IconButton>
      <IconButton onClick={onRedo} disabled={!canRedo || loading} label="Redo">
        <ArrowUUpRight size={16} />
      </IconButton>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-hairline-strong" />
      <IconButton onClick={onRevert} disabled={!canUndo || loading} label="Revert to original" danger>
        <ArrowCounterClockwise size={16} />
      </IconButton>
    </div>
  )
}
