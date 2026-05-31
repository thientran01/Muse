import { Fragment, useState } from 'react'
import { ArrowsOutSimple, ArrowsInSimple } from '@phosphor-icons/react'
import type { CanvasElement, StyleMutation, StyleProperty } from '../../types'
import { ScrubField } from './ScrubField'

// A short, devtools-style label for a breadcrumb crumb: the tag plus its first
// simple class token (e.g. "div.flex-1"), so a column of <div>s is tellable apart.
function crumbLabel(c: CanvasElement): string {
  const first = (c.node.getAttribute('class') ?? '').split(/\s+/).find((t) => t && !t.includes('['))
  return first ? `${c.tag}.${first.slice(0, 12)}` : c.tag
}

export type Sides = { top: number; right: number; bottom: number; left: number }
export type CanvasValues = {
  padding: Sides
  margin: Sides
  gap: { row: number; column: number } | null // null when not flex/grid
  size: { width: number; height: number }
  type: { fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: number }
  rendersText: boolean // the element directly shows text — gates the Type controls
  color: { text: string; background: string; border: string } // current values as #hex
  colorThemed: { text: boolean; background: boolean; border: boolean } // source uses a CSS var → read-only
}

const sidesEqual = (s: Sides) => s.top === s.right && s.right === s.bottom && s.bottom === s.left

// One color channel: a native swatch + hex readout, or a read-only "themed" note
// when the source paints this channel through a CSS variable (Muse leaves those).
function ColorRow({
  label,
  value,
  themed,
  onPreview,
  onCommit,
}: {
  label: string
  value: string
  themed: boolean
  onPreview: (v: string) => void
  onCommit: (v: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="select-none text-fg-faint">{label}</span>
      {themed ? (
        <span className="text-[10px] italic text-fg-faint" title="This color is themed via a CSS variable — edit the design token instead">
          themed
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-fg-muted">{value}</span>
          <input
            type="color"
            value={value}
            onInput={(e) => onPreview((e.target as HTMLInputElement).value)}
            onChange={(e) => onCommit((e.target as HTMLInputElement).value)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded border border-line/20 bg-transparent p-0"
          />
        </span>
      )}
    </label>
  )
}

// A padding/margin group: one field when all sides match, four when they don't —
// with a toggle to expand/collapse. `base` is the shorthand property name
// ('padding'/'margin'); the per-side names follow Tailwind/CSS convention.
function SideGroup({
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
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}) {
  const [expanded, setExpanded] = useState(!sidesEqual(values))
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
  const sideProp = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => `${base}${side}` as StyleProperty

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-fg-muted">{title}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-fg-faint transition hover:text-fg-muted"
          title={expanded ? 'Link sides' : 'Edit each side'}
        >
          {expanded ? <ArrowsInSimple size={13} /> : <ArrowsOutSimple size={13} />}
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => (
            <ScrubField
              key={side}
              label={cap(side)}
              value={values[side.toLowerCase() as keyof Sides]}
              min={minSide}
              onPreview={(v) => onPreview([{ property: sideProp(side), value: `${v}px` }])}
              onCommit={(v) => onCommit([{ property: sideProp(side), value: `${v}px` }])}
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

export function PropertiesPanel({
  values,
  chain,
  selectedKey,
  onPick,
  onPreview,
  onCommit,
}: {
  values: CanvasValues
  chain: CanvasElement[]
  selectedKey: string
  onPick: (c: CanvasElement) => void
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}) {
  const gapLinked = values.gap && values.gap.row === values.gap.column
  // Breadcrumb runs outermost → selected (left → right), like devtools. Click any
  // crumb to select that ancestor — the discoverable "grab the container" path.
  const crumbs = [...chain].reverse()
  return (
    <div className="w-[208px] space-y-3 rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur">
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

      {/* Legend — maps the on-canvas band hues to what they mean. */}
      <div className="flex items-center gap-2.5 text-[9px] text-fg-faint">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400/70" />Padding</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400/70" />Margin</span>
        {values.gap && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400/70" />Gap</span>}
      </div>

      {/* Size — precise W/H, complements the on-canvas corner handles. */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-fg-muted">Size</span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <ScrubField
            label="W"
            value={values.size.width}
            min={0}
            onPreview={(v) => onPreview([{ property: 'width', value: `${v}px` }])}
            onCommit={(v) => onCommit([{ property: 'width', value: `${v}px` }])}
          />
          <ScrubField
            label="H"
            value={values.size.height}
            min={0}
            onPreview={(v) => onPreview([{ property: 'height', value: `${v}px` }])}
            onCommit={(v) => onCommit([{ property: 'height', value: `${v}px` }])}
          />
        </div>
      </div>

      {/* Type — only on elements that directly render text (not container divs). */}
      {values.rendersText && (
        <>
          <div className="h-px bg-line/10" />
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-fg-muted">Type</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <ScrubField
                label="Size"
                value={values.type.fontSize}
                min={1}
                onPreview={(v) => onPreview([{ property: 'fontSize', value: `${v}px` }])}
                onCommit={(v) => onCommit([{ property: 'fontSize', value: `${v}px` }])}
              />
              <ScrubField
                label="Weight"
                value={values.type.fontWeight}
                min={100}
                max={900}
                unit=""
                onPreview={(v) => onPreview([{ property: 'fontWeight', value: `${v}` }])}
                onCommit={(v) => onCommit([{ property: 'fontWeight', value: `${v}` }])}
              />
              <ScrubField
                label="Line"
                value={values.type.lineHeight}
                min={0}
                onPreview={(v) => onPreview([{ property: 'lineHeight', value: `${v}px` }])}
                onCommit={(v) => onCommit([{ property: 'lineHeight', value: `${v}px` }])}
              />
              <ScrubField
                label="Letter"
                value={values.type.letterSpacing}
                onPreview={(v) => onPreview([{ property: 'letterSpacing', value: `${v}px` }])}
                onCommit={(v) => onCommit([{ property: 'letterSpacing', value: `${v}px` }])}
              />
            </div>
          </div>
        </>
      )}

      {/* Color — background + border on any element; text only where there's text. */}
      <div className="h-px bg-line/10" />
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-fg-muted">Color</span>
        {values.rendersText && (
          <ColorRow
            label="Text"
            value={values.color.text}
            themed={values.colorThemed.text}
            onPreview={(v) => onPreview([{ property: 'color', value: v }])}
            onCommit={(v) => onCommit([{ property: 'color', value: v }])}
          />
        )}
        <ColorRow
          label="Fill"
          value={values.color.background}
          themed={values.colorThemed.background}
          onPreview={(v) => onPreview([{ property: 'backgroundColor', value: v }])}
          onCommit={(v) => onCommit([{ property: 'backgroundColor', value: v }])}
        />
        <ColorRow
          label="Border"
          value={values.color.border}
          themed={values.colorThemed.border}
          onPreview={(v) => onPreview([{ property: 'borderColor', value: v }])}
          onCommit={(v) => onCommit([{ property: 'borderColor', value: v }])}
        />
      </div>

      <div className="h-px bg-line/10" />

      <SideGroup title="Padding" base="padding" values={values.padding} minSide={0} onPreview={onPreview} onCommit={onCommit} />
      <div className="h-px bg-line/10" />
      <SideGroup title="Margin" base="margin" values={values.margin} minSide={-Infinity} onPreview={onPreview} onCommit={onCommit} />

      {values.gap && (
        <>
          <div className="h-px bg-line/10" />
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-fg-muted">Gap</span>
            {gapLinked ? (
              <ScrubField
                label="Gap"
                value={values.gap.row}
                min={0}
                onPreview={(v) => onPreview([{ property: 'gap', value: `${v}px` }])}
                onCommit={(v) => onCommit([{ property: 'gap', value: `${v}px` }])}
              />
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <ScrubField
                  label="Row"
                  value={values.gap.row}
                  min={0}
                  onPreview={(v) => onPreview([{ property: 'rowGap', value: `${v}px` }])}
                  onCommit={(v) => onCommit([{ property: 'rowGap', value: `${v}px` }])}
                />
                <ScrubField
                  label="Col"
                  value={values.gap.column}
                  min={0}
                  onPreview={(v) => onPreview([{ property: 'columnGap', value: `${v}px` }])}
                  onCommit={(v) => onCommit([{ property: 'columnGap', value: `${v}px` }])}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
