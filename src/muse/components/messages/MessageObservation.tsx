import { MessageStarterChips } from './MessageStarterChips'

// The opener of a fresh target context: Muse's one-line read of the element,
// plus starter chips. The read renders instantly as a heuristic (pending) and
// swaps to the LLM's read when /observe lands — the pulse marks the in-between.
export function MessageObservation({
  observation,
  chips,
  pending,
  onPick,
  chipsDisabled = false,
}: {
  observation: string
  chips: string[]
  pending: boolean
  onPick: (text: string) => void
  chipsDisabled?: boolean
}) {
  return (
    <div className="animate-muse-rise space-y-2.5 motion-reduce:animate-none">
      <p
        className={`text-sm leading-relaxed text-fg ${
          pending ? 'animate-pulse text-fg-muted motion-reduce:animate-none' : ''
        }`}
      >
        {observation}
      </p>
      <MessageStarterChips chips={chips} onPick={onPick} disabled={chipsDisabled} />
    </div>
  )
}
