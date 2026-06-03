import { ArrowCounterClockwise, ArrowUUpLeft, ArrowUUpRight } from '@phosphor-icons/react'

type HistoryAction = 'undo' | 'redo' | 'revert'

// A quiet system line marking an undo / redo / revert in the thread. Same
// understated separator treatment as the target handoff — these fire often, so
// the line just acknowledges the action without shouting. The icons match the
// undo/redo/revert controls in the dock.
export function MessageHistory({ action, label }: { action: HistoryAction; label?: string }) {
  const Icon = action === 'redo' ? ArrowUUpRight : action === 'revert' ? ArrowCounterClockwise : ArrowUUpLeft
  const verb = action === 'revert' ? 'reverted to the original' : action === 'redo' ? 'redid' : 'undid'
  const short = label && label.length > 38 ? `${label.slice(0, 37).trimEnd()}…` : label
  const danger = action === 'revert'
  return (
    <div
      className={`flex animate-muse-rise items-center gap-2 py-1 text-[11px] motion-reduce:animate-none ${
        danger ? 'text-rose-300/80' : 'text-fg-faint'
      }`}
    >
      <div className={`h-px flex-1 ${danger ? 'bg-rose-500/15' : 'bg-line/10'}`} />
      <span className="flex shrink-0 items-center gap-1.5">
        <Icon size={11} weight="bold" className="shrink-0" />
        <span>
          {verb}
          {action !== 'revert' && short && <span className="text-fg-muted"> {short}</span>}
        </span>
      </span>
      <div className={`h-px flex-1 ${danger ? 'bg-rose-500/15' : 'bg-line/10'}`} />
    </div>
  )
}
