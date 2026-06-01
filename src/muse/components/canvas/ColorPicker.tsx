import { useEffect, useRef, useState } from 'react'
import {
  contrastInk,
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  normalizeHexInput,
  rgbToHex,
  type Hsv,
  type Rgb,
} from '../../style/colorMath'

// A self-contained color picker in Muse styling (no dependency): a
// saturation/brightness square + hue slider + hex & R/G/B inputs + a row of the
// app's brand swatches (from DESIGN.md). Drives `onPreview` live while dragging,
// `onCommit` on release / typed entry — same contract as the native input it
// replaces. HSV-driven internally (so the SV square stays stable while you slide
// hue), emits #rrggbb (the engine drops alpha, so there's no alpha channel).
export function ColorPicker({
  value,
  swatches = [],
  onPreview,
  onCommit,
}: {
  value: string // current #rrggbb
  swatches?: string[] // brand colors (hex) from DESIGN.md
  onPreview: (hex: string) => void
  onCommit: (hex: string) => void
}) {
  // HSV is the source of truth while the picker is open, so dragging value to 0
  // (black) doesn't lose the hue. Seed from the incoming value; re-seed if the
  // upstream value changes from OUTSIDE (not from our own edits).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 })
  const selfEdit = useRef(false)
  useEffect(() => {
    if (selfEdit.current) {
      selfEdit.current = false
      return
    }
    const next = hexToHsv(value)
    if (next) setHsv(next)
  }, [value])

  const hex = hsvToHex(hsv)
  const rgb = hsvToRgb(hsv)
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 }) // pure-hue backdrop for the SV square

  // Push an HSV change out: mark self-edit so the sync effect won't fight it,
  // preview live, and (on release) commit.
  const emit = (next: Hsv, commit: boolean) => {
    selfEdit.current = true
    setHsv(next)
    const h = hsvToHex(next)
    onPreview(h)
    if (commit) onCommit(h)
  }

  return (
    <div className="w-[200px] space-y-2.5">
      <SVSquare hsv={hsv} hueHex={hueHex} onChange={(s, v, commit) => emit({ ...hsv, s, v }, commit)} />
      <HueSlider hue={hsv.h} onChange={(h, commit) => emit({ ...hsv, h }, commit)} />

      {/* Current swatch + hex input */}
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 shrink-0 rounded border border-line/20" style={{ backgroundColor: hex }} />
        <HexInput value={hex} onCommit={(h) => { const hv = hexToHsv(h); if (hv) emit(hv, true) }} />
      </div>

      {/* R / G / B fields */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['r', 'g', 'b'] as const).map((ch) => (
          <RgbInput
            key={ch}
            label={ch.toUpperCase()}
            value={Math.round(rgb[ch])}
            onCommit={(n) => {
              const next: Rgb = { ...roundRgb(rgb), [ch]: n }
              const hv = hexToHsv(rgbToHex(next))
              if (hv) emit(hv, true)
            }}
          />
        ))}
      </div>

      {/* Brand swatches from DESIGN.md */}
      {swatches.length > 0 && (
        <div className="space-y-1 border-t border-line/10 pt-2">
          <span className="text-[9px] uppercase tracking-wide text-fg-faint">Brand</span>
          <div className="flex flex-wrap gap-1">
            {swatches.map((sw) => {
              const active = sw.toLowerCase() === hex.toLowerCase()
              return (
                <button
                  key={sw}
                  title={sw}
                  onClick={() => { const hv = hexToHsv(sw); if (hv) emit(hv, true) }}
                  className={`flex h-5 w-5 items-center justify-center rounded border transition ${active ? 'border-accent' : 'border-line/20 hover:border-line/40'}`}
                  style={{ backgroundColor: sw }}
                >
                  {active && <span className="text-[10px] leading-none" style={{ color: contrastInk(sw) }}>✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const roundRgb = (r: Rgb): Rgb => ({ r: Math.round(r.r), g: Math.round(r.g), b: Math.round(r.b) })

// Reusable pointer-drag within an element's rect → normalized (x,y) in 0..1.
// Captures the pointer so the drag continues outside the element. commit=true on
// pointer-up (the release that should write source).
function useRectDrag(onChange: (x: number, y: number, commit: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pos = (e: { clientX: number; clientY: number }) => {
    const el = ref.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragging.current = true
    const p = pos(e)
    if (p) onChange(p.x, p.y, false)
  }
  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const p = pos(e)
    if (p) onChange(p.x, p.y, false)
  }
  const up = (e: React.PointerEvent) => {
    if (!dragging.current) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragging.current = false
    const p = pos(e)
    if (p) onChange(p.x, p.y, true) // commit on release
  }
  return { ref, handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } }
}

// Saturation (x) × brightness (y) square, tinted by the current hue.
function SVSquare({ hsv, hueHex, onChange }: { hsv: Hsv; hueHex: string; onChange: (s: number, v: number, commit: boolean) => void }) {
  const { ref, handlers } = useRectDrag((x, y, commit) => onChange(x * 100, (1 - y) * 100, commit))
  return (
    <div
      ref={ref}
      {...handlers}
      className="relative h-28 w-full cursor-crosshair touch-none rounded-md border border-line/15"
      style={{ backgroundColor: hueHex, backgroundImage: 'linear-gradient(to right, #fff, transparent), linear-gradient(to top, #000, transparent)' }}
    >
      <Knob left={`${hsv.s}%`} top={`${100 - hsv.v}%`} />
    </div>
  )
}

// Hue 0–360 slider.
function HueSlider({ hue, onChange }: { hue: number; onChange: (h: number, commit: boolean) => void }) {
  const { ref, handlers } = useRectDrag((x, _y, commit) => onChange(x * 360, commit))
  return (
    <div
      ref={ref}
      {...handlers}
      className="relative h-3 w-full cursor-ew-resize touch-none rounded-full border border-line/15"
      style={{ backgroundImage: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
    >
      <Knob left={`${(hue / 360) * 100}%`} top="50%" />
    </div>
  )
}

// The draggable marker (a ring) used by both the SV square and the hue slider.
function Knob({ left, top }: { left: string; top: string }) {
  return (
    <span
      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
      style={{ left, top }}
    />
  )
}

// Hex text field — commits a normalized value on Enter/blur, reverts bad input.
function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(value) }, [value, editing])
  const commit = () => {
    setEditing(false)
    const norm = normalizeHexInput(text)
    if (norm) onCommit(norm)
    else setText(value) // revert unparseable input
  }
  return (
    <input
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur() } }}
      onBlur={commit}
      spellCheck={false}
      aria-label="Hex color"
      className="w-full rounded-md border border-line/15 bg-surface px-2 py-1 font-mono text-[11px] uppercase tabular-nums text-fg outline-none transition-colors focus:border-accent/60 motion-reduce:transition-none"
    />
  )
}

// One R/G/B 0–255 field.
function RgbInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(String(value)) }, [value, editing])
  const commit = () => {
    setEditing(false)
    const n = Number(text)
    if (Number.isFinite(n)) onCommit(Math.min(255, Math.max(0, Math.round(n))))
    else setText(String(value))
  }
  return (
    <label className="flex items-center gap-1 rounded-md border border-line/15 bg-surface px-1.5 py-1 text-[11px] transition-colors focus-within:border-accent/60 motion-reduce:transition-none">
      <span className="shrink-0 select-none text-fg-faint">{label}</span>
      <input
        value={text}
        inputMode="numeric"
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setText(String(value)); (e.target as HTMLInputElement).blur() } }}
        onBlur={commit}
        aria-label={label}
        className="w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-right tabular-nums text-fg outline-none"
      />
    </label>
  )
}
