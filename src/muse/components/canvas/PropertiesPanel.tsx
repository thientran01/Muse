import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsOutSimple, ArrowsInSimple, TextAlignCenter, TextAlignJustify, TextAlignLeft, TextAlignRight } from '@phosphor-icons/react'
import type { CanvasElement, SharedConst, StyleMutation, StyleProperty } from '../../types'
import { SHADOW } from '../../style/tailwindScales'
import { usePresence } from '../../hooks/usePresence'
import { ScrubField } from './ScrubField'
import { ColorPicker } from './ColorPicker'

// A short, devtools-style label for a breadcrumb crumb: the tag plus its first
// simple class token (e.g. "div.flex-1"), so a column of <div>s is tellable apart.
function crumbLabel(c: CanvasElement): string {
  const first = (c.node.getAttribute('class') ?? '').split(/\s+/).find((t) => t && !t.includes('['))
  return first ? `${c.tag}.${first.slice(0, 12)}` : c.tag
}

export type Sides = { top: number; right: number; bottom: number; left: number }
export type Corners = { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }
export type CanvasValues = {
  padding: Sides
  margin: Sides
  gap: { row: number; column: number } | null // null when not flex/grid
  layout: { justify: string; align: string } | null // flex/grid container alignment (normalized keywords)
  size: { width: number; height: number }
  type: { fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: number; align: string }
  rendersText: boolean // the element directly shows text — gates the Type controls
  color: { text: string; background: string; border: string } // current values as #hex
  colorThemed: { text: boolean; background: boolean; border: boolean } // source uses a CSS var → read-only
  appearance: {
    radius: Corners
    borderWidth: number
    borderStyleNone: boolean // no visible border yet — a width scrub must also set a style
    opacity: number // 0–100 (percent, the panel's display unit)
    shadow: string // matched preset name ('none'/'sm'/''/'md'/…), or 'custom' when off the scale
  }
}

// Shared props every section atom takes — the edit pipe down to the engine.
type EditProps = {
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}

const sidesEqual = (s: Sides) => s.top === s.right && s.right === s.bottom && s.bottom === s.left

// A small caps label that heads each section (shared so every panel variant uses
// the exact same heading treatment).
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium text-fg-muted">{children}</span>
}

const divider = <div className="h-px bg-line/10" />

// One color channel: a swatch + hex readout that opens the custom ColorPicker in a
// popover, or a read-only "themed" note when the source paints this channel through
// a CSS variable (Muse leaves those). The popover closes on outside-click or Esc.
// Reused by the design-token editor (a token name as the label), so `label` is a node.
export function ColorRow({
  label,
  ariaLabel,
  value,
  themed,
  contrastAgainst,
  portalContainer,
  onPreview,
  onCommit,
  onClose,
}: {
  label: React.ReactNode
  ariaLabel?: string // overrides the button's accessible name (label may be a node)
  value: string
  themed: boolean
  contrastAgainst?: string // paired color for the WCAG check (Fill behind Text, etc.)
  portalContainer?: React.RefObject<HTMLElement> // themed overlay root to portal the popover into
  onPreview: (v: string) => void
  onCommit: (v: string) => void
  onClose?: () => void // fires when the picker popover closes (token editor uses it to drop a live preview)
}) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null)
  // Keep the picker mounted through its exit transition so it scales/fades out
  // instead of vanishing (paired with the .muse-pop class + data-state below).
  const { mounted, state } = usePresence(open && !themed)

  // Tell the parent when the picker closes (open → false), so a token row can drop
  // its live CSS-var preview and let the committed source value govern again.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) onCloseRef.current?.()
    wasOpen.current = open
  }, [open])

  // The popover renders in a PORTAL into the overlay root, NOT inline — the panel
  // is an overflow-y-auto/overflow-x-hidden scroll box, which would clip an inline
  // popover (and its height would add phantom scroll space). Position it `fixed`,
  // to the left of the panel, clamped to the viewport. Re-place on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = rowRef.current?.getBoundingClientRect()
      if (!r) return
      // Anchor to the PANEL's edge, not the row's, so the picker sits cleanly
      // beside the whole panel. Default to the RIGHT of the panel; flip to the
      // left only when the right side would clip off-screen.
      const panel = (rowRef.current?.closest('[data-muse-panel]') as HTMLElement | null)?.getBoundingClientRect() ?? r
      const W = 226
      const h = popRef.current?.offsetHeight ?? 320
      const gap = 8
      const fitsRight = panel.right + gap + W + gap <= window.innerWidth
      const left = fitsRight ? panel.right + gap : Math.max(gap, panel.left - W - gap)
      // Vertically align to the clicked row, clamped so the whole picker stays on-screen.
      const top = Math.max(gap, Math.min(r.top, window.innerHeight - h - gap))
      setPos({ left, top, side: fitsRight ? 'right' : 'left' })
    }
    place()
    // Re-clamp when the popover's own height changes after open — the token
    // swatch row arrives async (museTokens), and without this a picker opened
    // near the viewport bottom would grow past the edge and clip the row.
    const ro = new ResizeObserver(place)
    if (popRef.current) ro.observe(popRef.current)
    // A second pass after the popover has measured (height affects the top
    // clamp) — and a second chance to attach the observer, since the popover
    // node may not exist on the first synchronous pass (re-observing the same
    // node is a no-op).
    const raf = requestAnimationFrame(() => {
      place()
      if (popRef.current) ro.observe(popRef.current)
    })
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Close on outside-click / Esc. The popover lives in a portal (outside rowRef),
  // so the outside test must exclude it too, or clicking the picker would close it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      // The overlay lives in a Shadow DOM, so a document-level listener sees the
      // event RETARGETED to the shadow host — e.target is no longer the real inner
      // node, and contains() would (wrongly) report every click as outside, closing
      // the picker on its own controls. composedPath() keeps the true path through
      // the shadow boundary; test membership against it instead.
      const path = e.composedPath()
      const inside = (el: Node | null) => !!el && path.includes(el)
      if (inside(rowRef.current) || inside(popRef.current)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const popover =
    mounted && pos ? (
      <div
        ref={popRef}
        data-state={state}
        className="muse-pop pointer-events-auto fixed z-[1000000] rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur"
        // Scale from the panel-facing edge (Emil tip #5): when the picker sits to the
        // right of the panel it grows from its left edge, and vice-versa.
        style={{ left: pos.left, top: pos.top, '--muse-pop-origin': pos.side === 'right' ? 'left center' : 'right center' } as React.CSSProperties}
      >
        <ColorPicker value={value} contrastAgainst={contrastAgainst} onPreview={onPreview} onCommit={onCommit} />
      </div>
    ) : null

  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="min-w-0 select-none truncate text-fg-faint">{label}</span>
      {themed ? (
        <span className="text-[10px] italic text-fg-faint" title="This color is themed via a CSS variable; edit the design token instead">
          themed
        </span>
      ) : (
        <button
          ref={rowRef}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 transition hover:bg-line/10"
          aria-expanded={open}
          aria-label={ariaLabel ?? (typeof label === 'string' ? `Edit ${label} color` : 'Edit color')}
          title="Edit color"
        >
          <span className="font-mono tabular-nums text-fg-muted">{value}</span>
          <span className="h-5 w-5 shrink-0 rounded border border-line/20" style={{ backgroundColor: value }} />
        </button>
      )}
      {popover && portalContainer?.current ? createPortal(popover, portalContainer.current) : popover}
    </div>
  )
}

// A padding/margin group: one field when all sides match, four when they don't —
// with a toggle to expand/collapse. `base` is the shorthand property name
// ('padding'/'margin'); the per-side names follow Tailwind/CSS convention.
export function SideGroup({
  title,
  base,
  values,
  minSide,
  onPreview,
  onCommit,
}: {
  title: string
  base: 'padding' | 'margin'
  values: Sides
  minSide: number
} & EditProps) {
  const [expanded, setExpanded] = useState(!sidesEqual(values))
  const sideProp = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => `${base}${side}` as StyleProperty
  // Single-letter side labels (T/R/B/L) so they never truncate inside the field box;
  // the full name is the title attribute. (Figma uses the same compact convention.)
  const sides = [
    { key: 'Top', short: 'T' },
    { key: 'Right', short: 'R' },
    { key: 'Bottom', short: 'B' },
    { key: 'Left', short: 'L' },
  ] as const

  return (
    <div className="space-y-1">
      {/* Sub-label: lighter + uppercase tracking, distinct from the bold section
          headers (Color / Spacing) so the hierarchy reads clearly. */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-fg-faint">{title}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-fg-faint transition hover:text-fg-muted"
          title={expanded ? 'Link sides' : 'Edit each side'}
          aria-expanded={expanded}
          aria-label={expanded ? 'Link sides' : 'Edit each side'}
        >
          {expanded ? <ArrowsInSimple size={12} /> : <ArrowsOutSimple size={12} />}
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {sides.map(({ key, short }) => (
            <ScrubField
              key={key}
              label={short}
              ariaLabel={key}
              value={values[key.toLowerCase() as keyof Sides]}
              min={minSide}
              onPreview={(v) => onPreview([{ property: sideProp(key), value: `${v}px` }])}
              onCommit={(v) => onCommit([{ property: sideProp(key), value: `${v}px` }])}
            />
          ))}
        </div>
      ) : (
        <ScrubField
          label="All"
          value={values.top}
          min={minSide}
          onPreview={(v) => onPreview([{ property: base, value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: base, value: `${v}px` }])}
        />
      )}
    </div>
  )
}

// ── Section atoms — the panel's content, broken into pieces every variant reuses ──

// The ancestor breadcrumb: outermost → selected (left → right), like devtools.
// Click any crumb to select that ancestor.
export function Breadcrumb({
  chain,
  selectedKey,
  onPick,
}: {
  chain: CanvasElement[]
  selectedKey: string
  onPick: (c: CanvasElement) => void
}) {
  const crumbs = [...chain].reverse()
  return (
    <div className="flex flex-wrap items-center gap-0.5 text-[10px] leading-tight">
      {crumbs.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 && <span className="text-fg-faint/40">›</span>}
          <button
            onClick={() => onPick(c)}
            title={c.node.getAttribute('class') || c.tag}
            className={`max-w-[120px] truncate rounded px-1 py-0.5 font-mono transition ${
              c.key === selectedKey
                ? 'bg-accent/15 text-accent'
                : 'text-fg-faint hover:bg-line/10 hover:text-fg-muted'
            }`}
          >
            {crumbLabel(c)}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

// Maps the on-canvas band hues to their meaning.
export function Legend({ hasGap }: { hasGap: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-[9px] text-fg-faint">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400/70" />Padding</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400/70" />Margin</span>
      {hasGap && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400/70" />Gap</span>}
    </div>
  )
}

// Precise W/H — complements the on-canvas corner handles.
export function SizeFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <ScrubField label="W" value={values.size.width} min={0}
          onPreview={(v) => onPreview([{ property: 'width', value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: 'width', value: `${v}px` }])} />
        <ScrubField label="H" value={values.size.height} min={0}
          onPreview={(v) => onPreview([{ property: 'height', value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: 'height', value: `${v}px` }])} />
      </div>
    </div>
  )
}

const TEXT_ALIGN_OPTIONS = [
  { name: 'left', label: <TextAlignLeft size={13} />, title: 'Align left' },
  { name: 'center', label: <TextAlignCenter size={13} />, title: 'Align center' },
  { name: 'right', label: <TextAlignRight size={13} />, title: 'Align right' },
  { name: 'justify', label: <TextAlignJustify size={13} />, title: 'Justify' },
]

// Font size / weight / line-height / letter-spacing / align — only where text renders.
export function TypeFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <ScrubField label="Size" value={values.type.fontSize} min={1}
          onPreview={(v) => onPreview([{ property: 'fontSize', value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: 'fontSize', value: `${v}px` }])} />
        <ScrubField label="Weight" value={values.type.fontWeight} min={100} max={900} unit=""
          onPreview={(v) => onPreview([{ property: 'fontWeight', value: `${v}` }])}
          onCommit={(v) => onCommit([{ property: 'fontWeight', value: `${v}` }])} />
        <ScrubField label="Line" value={values.type.lineHeight} min={1}
          onPreview={(v) => v > 0 && onPreview([{ property: 'lineHeight', value: `${v}px` }])}
          onCommit={(v) => v > 0 && onCommit([{ property: 'lineHeight', value: `${v}px` }])} />
        <ScrubField label="Letter" value={values.type.letterSpacing}
          onPreview={(v) => onPreview([{ property: 'letterSpacing', value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: 'letterSpacing', value: `${v}px` }])} />
      </div>
      <SegmentRow
        label="Align"
        options={TEXT_ALIGN_OPTIONS}
        current={values.type.align}
        onPick={(name) => onCommit([{ property: 'textAlign', value: name }])}
      />
    </div>
  )
}

// Text / fill / border color. Text row only where the element renders text. Each
// row opens the custom ColorPicker (with a WCAG check). The contrast pairing is
// Text↔Fill (the usual readability question); Border has no natural pair, so it
// gets no contrast badge.
export function ColorFields({
  values,
  portalContainer,
  onPreview,
  onCommit,
}: { values: CanvasValues; portalContainer?: React.RefObject<HTMLElement> } & EditProps) {
  return (
    <div className="space-y-1.5">
      {values.rendersText && (
        <ColorRow label="Text" value={values.color.text} themed={values.colorThemed.text}
          contrastAgainst={values.color.background} portalContainer={portalContainer}
          onPreview={(v) => onPreview([{ property: 'color', value: v }])}
          onCommit={(v) => onCommit([{ property: 'color', value: v }])} />
      )}
      <ColorRow label="Fill" value={values.color.background} themed={values.colorThemed.background}
        contrastAgainst={values.rendersText ? values.color.text : undefined} portalContainer={portalContainer}
        onPreview={(v) => onPreview([{ property: 'backgroundColor', value: v }])}
        onCommit={(v) => onCommit([{ property: 'backgroundColor', value: v }])} />
      <ColorRow label="Border" value={values.color.border} themed={values.colorThemed.border}
        portalContainer={portalContainer}
        onPreview={(v) => onPreview([{ property: 'borderColor', value: v }])}
        onCommit={(v) => onCommit([{ property: 'borderColor', value: v }])} />
    </div>
  )
}

// Radius: one field when all corners match, four when they don't — the same
// expand/collapse interaction as SideGroup, with corner naming (TL/TR/BR/BL).
const cornersEqual = (c: Corners) =>
  c.topLeft === c.topRight && c.topRight === c.bottomRight && c.bottomRight === c.bottomLeft

function CornerGroup({ values, onPreview, onCommit }: { values: Corners } & EditProps) {
  const [expanded, setExpanded] = useState(!cornersEqual(values))
  const corners = [
    { key: 'topLeft', prop: 'borderTopLeftRadius', short: 'TL', full: 'Top left' },
    { key: 'topRight', prop: 'borderTopRightRadius', short: 'TR', full: 'Top right' },
    { key: 'bottomRight', prop: 'borderBottomRightRadius', short: 'BR', full: 'Bottom right' },
    { key: 'bottomLeft', prop: 'borderBottomLeftRadius', short: 'BL', full: 'Bottom left' },
  ] as const
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-fg-faint">Radius</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-fg-faint transition hover:text-fg-muted"
          title={expanded ? 'Link corners' : 'Edit each corner'}
          aria-expanded={expanded}
          aria-label={expanded ? 'Link corners' : 'Edit each corner'}
        >
          {expanded ? <ArrowsInSimple size={12} /> : <ArrowsOutSimple size={12} />}
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {corners.map(({ key, prop, short, full }) => (
            <ScrubField
              key={key}
              label={short}
              ariaLabel={`${full} radius`}
              value={values[key]}
              min={0}
              onPreview={(v) => onPreview([{ property: prop, value: `${v}px` }])}
              onCommit={(v) => onCommit([{ property: prop, value: `${v}px` }])}
            />
          ))}
        </div>
      ) : (
        <ScrubField
          label="All"
          ariaLabel="Radius"
          value={values.topLeft}
          min={0}
          onPreview={(v) => onPreview([{ property: 'borderRadius', value: `${v}px` }])}
          onCommit={(v) => onCommit([{ property: 'borderRadius', value: `${v}px` }])}
        />
      )}
    </div>
  )
}

// One compact segmented chip row — a radio group of exclusive choices (shadow
// presets, text align, justify/align). `current` matches an option's name to
// check it; a current value off the option list renders with nothing selected.
function SegmentRow({
  label,
  options,
  current,
  onPick,
}: {
  label: string
  options: Array<{ name: string; label: React.ReactNode; title?: string }>
  current: string
  onPick: (name: string) => void
}) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-line/10 p-0.5">
        {options.map((o) => (
          <button
            key={o.name}
            type="button"
            role="radio"
            aria-checked={current === o.name}
            aria-label={o.title}
            title={o.title}
            onClick={() => onPick(o.name)}
            className={`flex flex-1 items-center justify-center rounded-md px-1 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              current === o.name ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// The shadow presets the panel offers (Tailwind's steps; the base and 2xl steps
// exist in the engine but stay off the row — five chips is the readable cap, and
// a base/2xl/custom current value simply renders with no chip selected).
const SHADOW_PRESETS: Record<string, string> = {
  none: 'none',
  sm: SHADOW.sm,
  md: SHADOW.md,
  lg: SHADOW.lg,
  xl: SHADOW.xl,
}
const SHADOW_OPTIONS = [
  { name: 'none', label: 'None' },
  { name: 'sm', label: 'S' },
  { name: 'md', label: 'M' },
  { name: 'lg', label: 'L' },
  { name: 'xl', label: 'XL' },
]

// Radius, border width, opacity, and shadow presets. A width scrub on an element
// with no visible border also sets border-style (the computed style is `none`, so
// width alone would paint nothing — same in Tailwind-less hosts without preflight).
export function AppearanceFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  const a = values.appearance
  const withStyle = (v: number, m: StyleMutation[]): StyleMutation[] =>
    a.borderStyleNone && v > 0 ? [...m, { property: 'borderStyle', value: 'solid' }] : m
  return (
    <div className="space-y-2">
      <CornerGroup values={a.radius} onPreview={onPreview} onCommit={onCommit} />
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        {/* "Stroke", not "Border": the Color section already has a Border row (its
            color), and two visible "Border" labels two sections apart read as the
            same control. Stroke is the term this persona knows from Figma. */}
        <ScrubField label="Stroke" ariaLabel="Border width" value={a.borderWidth} min={0}
          onPreview={(v) => onPreview(withStyle(v, [{ property: 'borderWidth', value: `${v}px` }]))}
          onCommit={(v) => onCommit(withStyle(v, [{ property: 'borderWidth', value: `${v}px` }]))} />
        <ScrubField label="Opacity" value={a.opacity} min={0} max={100} unit="%"
          onPreview={(v) => onPreview([{ property: 'opacity', value: `${v / 100}` }])}
          onCommit={(v) => onCommit([{ property: 'opacity', value: `${v / 100}` }])} />
      </div>
      <SegmentRow
        label="Shadow"
        options={SHADOW_OPTIONS}
        current={a.shadow}
        onPick={(name) => onCommit([{ property: 'boxShadow', value: SHADOW_PRESETS[name] }])}
      />
    </div>
  )
}

// Gap (flex/grid only). Always two half-width fields — Row (vertical) and Col
// (horizontal) — so it matches the Size/Type 2-col rows instead of one field
// stretching full width. Editing one writes that axis; they can still hold equal
// values (a plain `gap` reads as both).
export function GapFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  if (!values.gap) return null
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
      <ScrubField label="Row" value={values.gap.row} min={0}
        onPreview={(v) => onPreview([{ property: 'rowGap', value: `${v}px` }])}
        onCommit={(v) => onCommit([{ property: 'rowGap', value: `${v}px` }])} />
      <ScrubField label="Col" value={values.gap.column} min={0}
        onPreview={(v) => onPreview([{ property: 'columnGap', value: `${v}px` }])}
        onCommit={(v) => onCommit([{ property: 'columnGap', value: `${v}px` }])} />
    </div>
  )
}

// The chip names are the normalized keywords readValues reports; the committed
// values are real CSS so the inline and CSS-file writers use them verbatim.
const JUSTIFY_OPTIONS = [
  { name: 'start', label: 'Start', value: 'flex-start' },
  { name: 'center', label: 'Center', value: 'center' },
  { name: 'end', label: 'End', value: 'flex-end' },
  { name: 'between', label: 'Btwn', value: 'space-between', title: 'Space between' },
]
const ALIGN_OPTIONS = [
  { name: 'start', label: 'Start', value: 'flex-start' },
  { name: 'center', label: 'Center', value: 'center' },
  { name: 'end', label: 'End', value: 'flex-end' },
  { name: 'stretch', label: 'Stretch', value: 'stretch' },
]

// Container alignment + gap (flex/grid only): how this element arranges ITS
// children — distinct from Spacing, which is the element's own box.
export function LayoutFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  if (!values.layout) return null
  return (
    <div className="space-y-2">
      <SegmentRow
        label="Justify"
        options={JUSTIFY_OPTIONS}
        current={values.layout.justify}
        onPick={(name) => {
          const v = JUSTIFY_OPTIONS.find((o) => o.name === name)
          if (v) onCommit([{ property: 'justifyContent', value: v.value }])
        }}
      />
      <SegmentRow
        label="Align"
        options={ALIGN_OPTIONS}
        current={values.layout.align}
        onPick={(name) => {
          const v = ALIGN_OPTIONS.find((o) => o.name === name)
          if (v) onCommit([{ property: 'alignItems', value: v.value }])
        }}
      />
      <GapFields values={values} onPreview={onPreview} onCommit={onCommit} />
    </div>
  )
}

// The padding + margin pair (shared "spacing" block).
export function SpacingFields({ values, onPreview, onCommit }: { values: CanvasValues } & EditProps) {
  return (
    <>
      <SideGroup title="Padding" base="padding" values={values.padding} minSide={0} onPreview={onPreview} onCommit={onCommit} />
      {divider}
      <SideGroup title="Margin" base="margin" values={values.margin} minSide={-Infinity} onPreview={onPreview} onCommit={onCommit} />
    </>
  )
}

// The outer panel shell — surface/ring/blur, with a viewport cap so a tall panel
// scrolls inside instead of running off-screen when the element sits low.
function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-muse-panel className="flex max-h-[min(70vh,520px)] w-[232px] flex-col gap-2.5 overflow-y-auto overflow-x-hidden rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line/20">
      {children}
    </div>
  )
}

// One collapsible section: a clickable header + (when open) its body. The chevron
// rotates to show state. Sections toggle independently (you can open several).
// `dot` marks a COLLAPSED section that holds non-default values (a shadow set,
// opacity below 100, a radius) — what makes collapsed-by-default safe: the header
// says when it's load-bearing, so nothing is silently hidden. Only sections where
// "all defaults" is the common case pass it; an always-on dot would be noise.
function Section({ label, open, dot, onToggle, children }: { label: string; open: boolean; dot?: boolean; onToggle: () => void; children: React.ReactNode }) {
  const showDot = !!dot && !open
  return (
    <div className="space-y-1.5">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left transition hover:opacity-80"
        aria-expanded={open}
        aria-label={showDot ? `${label}, has values set` : label}
      >
        <span className="flex items-center gap-1.5">
          <SectionLabel>{label}</SectionLabel>
          {showDot && <span aria-hidden className="h-1 w-1 rounded-full bg-accent" title="Has values set" />}
        </span>
        <span className={`text-[10px] leading-none text-fg-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && children}
    </div>
  )
}

// Non-default detection for the dot. Deliberately only Appearance + Layout: every
// element HAS a size/color/spacing, so a dot there would always be on; these two
// sections are commonly all-defaults, which is exactly when a quiet signal helps.
function appearanceSet(values: CanvasValues): boolean {
  const a = values.appearance
  return (
    a.radius.topLeft > 0 || a.radius.topRight > 0 || a.radius.bottomRight > 0 || a.radius.bottomLeft > 0 ||
    a.borderWidth > 0 ||
    a.opacity < 100 ||
    a.shadow !== 'none'
  )
}
function layoutSet(values: CanvasValues): boolean {
  if (!values.layout) return false
  const unsetAlign = values.layout.justify === 'normal' && values.layout.align === 'normal'
  const noGap = !values.gap || (values.gap.row === 0 && values.gap.column === 0)
  return !(unsetAlign && noGap)
}

type SectionKey = 'size' | 'type' | 'color' | 'appearance' | 'spacing' | 'layout'

// Which sections are open — PERSISTED at module scope so it survives the panel's
// remount on every selection (the render site keys the panel by element). This is
// the friction-killer: open Color once and it stays open as you click through a
// run of elements doing a color pass — one click per TASK, not per element. null
// until the first panel initializes it from the first element's smart default.
let persistedOpen: Set<SectionKey> | null = null

// Smart default the FIRST time a panel mounts this session: a text element opens
// Type (the likely edit), anything else opens Size. After that, the user's toggles
// own it (persistedOpen), so we never override a deliberate choice.
function initialOpen(values: CanvasValues): Set<SectionKey> {
  if (persistedOpen) return new Set(persistedOpen)
  return new Set<SectionKey>([values.rendersText ? 'type' : 'size'])
}

// The live canvas properties panel — collapsible sections (independent toggles)
// with persistence + a smart default, so it stays concise and never clips while
// keeping every control one click away.
// When the selected element's style is a shared const (`style={body}`), a segmented
// control choosing the edit's blast radius: just this element (default) or the const
// definition (every instance). The active "all" state carries the accent selected-state
// treatment (loud, but still accent-as-flourish) so you can't forget you're editing
// globally — the visibility half of the mode-error guard. Only rendered when "all"
// actually broadens (≥2 in-file uses, or the const is exported and escapes the file).
function ScopeToggle({
  shared,
  scope,
  onChange,
}: {
  shared: SharedConst
  scope: 'element' | 'const'
  onChange: (s: 'element' | 'const') => void
}) {
  // Honest label: an un-exported const's same-file count is the exact blast radius; an
  // exported const escapes the file, so a count would understate — say "all uses".
  const allLabel = shared.exported ? 'All uses' : `All ${shared.sameFileCount}`
  // Focus ring matches the panel's other interactive buttons (e.g. MuseToolbar).
  const seg =
    'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>
        Shared style · <code className="font-mono text-fg-faint">{shared.name}</code>
      </SectionLabel>
      {/* A two-option segmented control = a radio group: the selection is exclusive, and
          screen readers should announce which scope is active (the visual accent state
          alone isn't conveyed). */}
      <div role="radiogroup" aria-label="Edit scope" className="flex gap-0.5 rounded-lg bg-line/10 p-0.5">
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'element'}
          onClick={() => onChange('element')}
          className={`${seg} ${scope === 'element' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
        >
          This element
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={scope === 'const'}
          onClick={() => onChange('const')}
          // Identical neutral chip to "This element" — the toggle reads as one calm
          // segmented control (no accent on the panel), and the scope is carried by
          // the label. Accent-on-tint draws the eye and fails contrast at this size;
          // cream/ink-on-surface is high-contrast in both themes.
          className={`${seg} ${scope === 'const' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
        >
          {allLabel}
        </button>
      </div>
    </div>
  )
}

export function PropertiesPanel({
  values,
  chain,
  selectedKey,
  onPick,
  portalContainer,
  sharedConst,
  scope = 'element',
  onScopeChange,
  onPreview,
  onCommit,
}: {
  values: CanvasValues
  chain: CanvasElement[]
  selectedKey: string
  onPick: (c: CanvasElement) => void
  portalContainer?: React.RefObject<HTMLElement> // themed overlay root for popovers
  sharedConst?: SharedConst | null // set when style={X} resolves to a shared const
  scope?: 'element' | 'const'
  onScopeChange?: (s: 'element' | 'const') => void
} & EditProps) {
  const [open, setOpen] = useState<Set<SectionKey>>(() => initialOpen(values))
  const toggle = (k: SectionKey) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      persistedOpen = next // remember across selections (survives remount)
      return next
    })

  return (
    <PanelShell>
      <Breadcrumb chain={chain} selectedKey={selectedKey} onPick={onPick} />
      {/* Scope toggle only when "all" would actually broaden the edit — a single
          in-file, non-exported use means the const edit equals this element's edit. */}
      {sharedConst && onScopeChange && (sharedConst.exported || sharedConst.sameFileCount > 1) && (
        <ScopeToggle shared={sharedConst} scope={scope} onChange={onScopeChange} />
      )}
      <Legend hasGap={!!values.gap} />

      <Section label="Size" open={open.has('size')} onToggle={() => toggle('size')}>
        <SizeFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Section>

      {values.rendersText && (
        <>
          {divider}
          <Section label="Type" open={open.has('type')} onToggle={() => toggle('type')}>
            <TypeFields values={values} onPreview={onPreview} onCommit={onCommit} />
          </Section>
        </>
      )}

      {divider}
      <Section label="Color" open={open.has('color')} onToggle={() => toggle('color')}>
        <ColorFields values={values} portalContainer={portalContainer} onPreview={onPreview} onCommit={onCommit} />
      </Section>

      {divider}
      <Section label="Appearance" open={open.has('appearance')} dot={appearanceSet(values)} onToggle={() => toggle('appearance')}>
        <AppearanceFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Section>

      {divider}
      <Section label="Spacing" open={open.has('spacing')} onToggle={() => toggle('spacing')}>
        <SpacingFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Section>

      {values.layout && (
        <>
          {divider}
          <Section label="Layout" open={open.has('layout')} dot={layoutSet(values)} onToggle={() => toggle('layout')}>
            <LayoutFields values={values} onPreview={onPreview} onCommit={onCommit} />
          </Section>
        </>
      )}
    </PanelShell>
  )
}

export { PanelShell, divider, SectionLabel }
