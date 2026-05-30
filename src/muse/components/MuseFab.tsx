import { UfoIcon } from './UfoIcon'

export function MuseFab({
  active,
  loading = false,
  entering = false,
  onToggle,
}: {
  active: boolean
  loading?: boolean
  // True only while the panel is collapsing into the FAB — plays the "catch"
  // entrance so the button grows in from the corner as the panel falls into it.
  entering?: boolean
  onToggle: () => void
}) {
  return (
    <button
      data-testid="muse-fab"
      onClick={onToggle}
      className={`pointer-events-auto flex items-center gap-2 rounded-full bg-surface-soft px-5 py-3 text-sm font-medium text-fg shadow-xl shadow-black/30 ring-1 transition active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:animate-none ${
        entering ? 'animate-muse-fab-catch origin-bottom-right ' : ''
      }${active ? 'ring-accent/60 hover:bg-surface' : 'ring-line/10 hover:bg-surface-raised'}`}
    >
      <UfoIcon size={18} loading={loading} className={active ? 'text-fg-muted' : 'text-accent'} />
      {active ? 'Cancel' : 'Muse'}
    </button>
  )
}
