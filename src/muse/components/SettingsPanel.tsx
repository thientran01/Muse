import { museStore, useMuseStore } from '../store'
import type { DockCorner } from '../prefs'
import { Key, ShortcutsPanel } from './ShortcutsPanel'

// The Settings popover: where Muse's chrome lives (dock corner), whether it
// hides entirely (zen), and the gesture reference. Preferences persist across
// refreshes (see prefs.ts).

const CORNERS: Array<{ id: DockCorner; label: string; pos: string }> = [
  { id: 'tl', label: 'Top left', pos: 'left-1.5 top-1.5' },
  { id: 'tr', label: 'Top right', pos: 'right-1.5 top-1.5' },
  { id: 'bl', label: 'Bottom left', pos: 'bottom-1.5 left-1.5' },
  { id: 'br', label: 'Bottom right', pos: 'bottom-1.5 right-1.5' },
]

// A miniature viewport: four corner dots, the active one accented — reads as
// "where the toolbar sits on your screen" without a word of explanation.
function CornerPicker({ corner, onPick }: { corner: DockCorner; onPick: (c: DockCorner) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Toolbar position"
      className="relative h-16 w-full rounded-lg border border-hairline-strong bg-scrim"
    >
      {CORNERS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={corner === c.id}
          aria-label={c.label}
          title={c.label}
          onClick={() => onPick(c.id)}
          className={`absolute ${c.pos} h-4 w-6 rounded-[4px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            corner === c.id ? 'bg-accent' : 'bg-track hover:bg-track-hover'
          }`}
        />
      ))}
    </div>
  )
}

export function SettingsPanel() {
  const { prefs } = useMuseStore()
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <span className="text-eyebrow uppercase text-fg-faint">Position</span>
        <CornerPicker corner={prefs.corner} onPick={(corner) => museStore.setPrefs({ corner })} />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm font-medium text-fg">Hide Muse chrome</span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.zen}
            aria-label="Hide Muse chrome"
            onClick={() => museStore.setPrefs({ zen: !prefs.zen })}
            className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              prefs.zen ? 'bg-accent' : 'bg-track'
            }`}
          >
            {/* The knob slides via transform, not `left` — compositor-only, and
                the one property the motion system animates for movement. */}
            <span
              // translate-x-[16px], not translate-x-4: the knob's endpoints are
              // pixel-set (left-[2px] → 18px) and rem resolves against the HOST
              // page's root font-size — a 62.5%-base host would strand the knob.
              className={`absolute left-[2px] top-[2px] h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform motion-reduce:transition-none ${
                prefs.zen ? 'translate-x-[16px]' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        <p className="text-field leading-relaxed text-fg-muted">
          The toolbar and banner stay out of sight — just the editing tools. Press{' '}
          <Key>R</Key> to peek at the toolbar (it tucks itself away again),
          or hover its corner any time.
        </p>
      </div>

      <div className="h-px bg-hairline" />

      <div className="space-y-1.5">
        <span className="text-eyebrow uppercase text-fg-faint">Shortcuts</span>
        <ShortcutsPanel />
      </div>
    </div>
  )
}
