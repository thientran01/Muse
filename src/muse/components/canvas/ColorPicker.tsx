import { useEffect, useRef, useState } from 'react'
import { Eyedropper } from '@phosphor-icons/react'
import {
  alphaFromHex,
  composeHexAlpha,
  contrastRatio,
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  normalizeHexInput,
  rgbToHex,
  type Hsv,
  type Rgb,
} from '../../style/colorMath'
import { rankTokenSwatches, type TokenSwatch } from '../../style/tokenSuggest'
import { museTokens } from '../../api'

// How often each token is actually painted with on this page: var() references
// across the host's same-origin stylesheets. The DOM half of the swatch ranking
// (the scoring itself is pure, in style/tokenSuggest). Tailwind hosts count too:
// an arbitrary `text-[color:var(--x)]` class lands in the generated utility CSS.
function countVarUsage(names: string[]): Record<string, number> {
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText
    } catch {
      /* cross-origin sheet — skip */
    }
  }
  const counts: Record<string, number> = {}
  for (const name of names) {
    // Boundary after the name (lookahead), so --c-ink doesn't also absorb every
    // --c-ink-soft reference and float above its own suffix siblings.
    const re = new RegExp(`var\\(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g')
    counts[name] = (css.match(re) ?? []).length
  }
  return counts
}

// The host's top color tokens, ranked for this picker (see tokenSuggest). Read
// once per picker open — the popover remounts each time, and tokens don't move
// mid-drag. Swatches are an enhancement: any failure just renders none.
function useTokenSwatches(contrastAgainst?: string): TokenSwatch[] {
  const [swatches, setSwatches] = useState<TokenSwatch[]>([])
  useEffect(() => {
    let cancelled = false
    museTokens()
      .then((tokens) => {
        if (cancelled) return
        const usage = countVarUsage(tokens.map((t) => t.name))
        setSwatches(rankTokenSwatches(tokens, usage, { contrastAgainst }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Mount-only: contrastAgainst is fixed for the life of one popover.
  }, [])
  return swatches
}

// The browser EyeDropper API (Chromium). Typed locally since lib.dom doesn't
// always ship it; feature-detected at runtime before use.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
const getEyeDropper = (): EyeDropperCtor | null =>
  typeof window !== 'undefined' && 'EyeDropper' in window ? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper : null

// A self-contained color picker in Muse styling (no dependency): a
// saturation/brightness square + hue slider + ALPHA slider + hex & R/G/B inputs
// + an eyedropper + an optional WCAG contrast check.
// Drives `onPreview` live while dragging, `onCommit` on release / typed entry —
// same contract as the native input it replaces. HSV-driven internally (so the SV
// square stays stable while you slide hue); emits #rrggbb at full opacity and
// #rrggbbaa otherwise (the engine preserves the byte; bg-[#11223380] is valid
// Tailwind).
export function ColorPicker({
  value,
  contrastAgainst,
  onPreview,
  onCommit,
}: {
  value: string // current #rrggbb or #rrggbbaa
  contrastAgainst?: string // the color this sits on/under, for the WCAG check (e.g. the fill behind text)
  onPreview: (hex: string) => void
  onCommit: (hex: string) => void
}) {
  // HSV (+ alpha) is the source of truth while the picker is open, so dragging
  // value to 0 (black) doesn't lose the hue. Seed from the incoming value;
  // re-seed if the upstream value changes from OUTSIDE (not from our own edits).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 })
  const [alpha, setAlpha] = useState(() => alphaFromHex(value))
  const selfEdit = useRef(false)
  useEffect(() => {
    if (selfEdit.current) {
      selfEdit.current = false
      return
    }
    const next = hexToHsv(value)
    if (next) {
      setHsv(next)
      setAlpha(alphaFromHex(value))
    }
  }, [value])

  const hex = hsvToHex(hsv)
  const composed = composeHexAlpha(hex, alpha)
  const rgb = hsvToRgb(hsv)
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 }) // pure-hue backdrop for the SV square

  // Push a change out: mark self-edit so the sync effect won't fight it,
  // preview live, and (on release) commit. One emitter for both axes.
  const emit = (nextHsv: Hsv, nextAlpha: number, commit: boolean) => {
    selfEdit.current = true
    setHsv(nextHsv)
    setAlpha(nextAlpha)
    const out = composeHexAlpha(hsvToHex(nextHsv), nextAlpha)
    onPreview(out)
    if (commit) onCommit(out)
  }
  const setHex = (h: string) => {
    const hv = hexToHsv(h)
    if (hv) emit(hv, alphaFromHex(h), true)
  }

  // Eyedropper: sample any pixel on screen (Chromium). Hidden where unsupported.
  const EyeDropper = getEyeDropper()
  const pickFromScreen = async () => {
    if (!EyeDropper) return
    try {
      const { sRGBHex } = await new EyeDropper().open()
      setHex(sRGBHex)
    } catch {
      /* user cancelled (Esc) — no-op */
    }
  }

  // Contrast deliberately checks the OPAQUE channel (WCAG defines no composited-
  // alpha formula) — the verdict speaks to the intended color, not the blend.
  const contrast = contrastAgainst ? contrastRatio(hex, contrastAgainst) : null
  const swatches = useTokenSwatches(contrastAgainst)

  return (
    <div className="w-[200px] space-y-2.5">
      {/* WCAG contrast check (Figma-style) — above the picker so the pass/fail
          verdict reads first, before you start adjusting. Only when a comparison
          color is provided (Text vs Fill, etc.). */}
      {contrast && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-fg-muted">
            <span className="font-mono tabular-nums">{contrast.ratio.toFixed(2)}:1</span>
            <span className="text-fg-faint">contrast</span>
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            contrast.aa ? 'bg-emerald-500/15 text-emerald-400'
            : contrast.aaLarge ? 'bg-amber-500/15 text-amber-400'
            : 'bg-rose-500/15 text-rose-400'
          }`}>
            {contrast.aaa ? 'AAA' : contrast.aa ? 'AA' : contrast.aaLarge ? 'AA Large' : 'Fail'}
          </span>
        </div>
      )}

      <SVSquare hsv={hsv} hueHex={hueHex} onChange={(s, v, commit) => emit({ ...hsv, s, v }, alpha, commit)} />

      {/* Eyedropper (if supported) + hue slider on one row, so the slider doesn't
          stretch full-width unnecessarily and the dropper sits where Figma's does. */}
      <div className="flex items-center gap-2">
        {EyeDropper && (
          <button
            onClick={pickFromScreen}
            title="Sample a color from the screen"
            aria-label="Sample a color from the screen"
            className="shrink-0 rounded p-1 text-fg-muted transition hover:bg-line/10 hover:text-fg"
          >
            <Eyedropper size={15} />
          </button>
        )}
        <HueSlider hue={hsv.h} onChange={(h, commit) => emit({ ...hsv, h }, alpha, commit)} />
      </div>

      {/* Alpha 0–100%: the current hue fades over a checkerboard so "less" reads
          as see-through, not darker. */}
      <AlphaSlider hex={hex} alpha={alpha} onChange={(a, commit) => emit(hsv, a, commit)} />

      {/* Hex (with leading swatch) + R/G/B on one compact grid. No duplicate
          swatch/hex readout — this row IS the readout. */}
      <div className="flex items-center gap-1.5">
        <span className="h-6 w-6 shrink-0 rounded border border-line/20" style={{ backgroundImage: CHECKER }}>
          <span className="block h-full w-full rounded" style={{ backgroundColor: composed }} />
        </span>
        <HexInput value={composed} onCommit={setHex} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['r', 'g', 'b'] as const).map((ch) => (
          <RgbInput
            key={ch}
            label={ch.toUpperCase()}
            value={Math.round(rgb[ch])}
            onCommit={(n) => {
              const next: Rgb = { ...roundRgb(rgb), [ch]: n }
              const hv = hexToHsv(rgbToHex(next))
              if (hv) emit(hv, alpha, true)
            }}
          />
        ))}
      </div>

      {/* The host's design tokens, one click away — the five the page most likely
          wants (ranked by real var() usage; see tokenSuggest). Commits the token's
          CURRENT hex (not a var() binding): a var-bound property routes future
          scrubs to the token's definition and locks this picker out (`themed`),
          which is the token panel's job, not a surprise to spring from a swatch. */}
      {swatches.length > 0 && (
        <div className="space-y-1">
          {/* Same micro-label treatment as the spacing sub-labels, same term as
              the toolbar popover. */}
          <div className="text-[10px] uppercase tracking-wide text-fg-faint">Design tokens</div>
          <div className="flex items-center gap-1.5">
            {swatches.map((s) => (
              <button
                key={s.name}
                onClick={() => setHex(s.value)}
                title={`${s.name} · ${s.value}`}
                aria-label={`Use ${s.name}, ${s.value}`}
                aria-pressed={s.value === composed}
                className={`h-6 w-6 shrink-0 rounded border transition duration-[120ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none motion-reduce:hover:scale-100 ${
                  s.value === composed ? 'border-accent ring-1 ring-accent/60' : 'border-line/20'
                }`}
                style={{ backgroundColor: s.value }}
              />
            ))}
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
      className="relative h-28 w-full cursor-crosshair touch-none rounded-md"
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
      className="relative h-3 w-full flex-1 cursor-ew-resize touch-none rounded-full"
      style={{ backgroundImage: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
    >
      <Knob left={`${(hue / 360) * 100}%`} top="50%" />
    </div>
  )
}

// A small transparency checkerboard (CSS-only, no asset) shared by the alpha
// slider track and the swatch — the universal "this part is see-through" read.
const CHECKER =
  'repeating-conic-gradient(rgba(127,127,127,0.35) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px'

// Alpha 0–100% slider: current hue over the checkerboard. role=slider PROMISES
// keyboard per the APG, so it delivers: focusable, arrows ±1% (Shift ±10%),
// Home/End — each press commits (a keyboard step is a deliberate value, not a
// drag in flight).
function AlphaSlider({ hex, alpha, onChange }: { hex: string; alpha: number; onChange: (a: number, commit: boolean) => void }) {
  const { ref, handlers } = useRectDrag((x, _y, commit) => onChange(x, commit))
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(1, alpha + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, alpha - step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1
    if (next === null) return
    e.preventDefault()
    onChange(next, true)
  }
  return (
    <div
      ref={ref}
      {...handlers}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Alpha"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(alpha * 100)}
      className="relative h-3 w-full cursor-ew-resize touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={{ background: `linear-gradient(to right, transparent, ${hex}), ${CHECKER}` }}
    >
      <Knob left={`${alpha * 100}%`} top="50%" />
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
