import { useState } from 'react'
import { ArrowsOutSimple, ArrowsInSimple } from '@phosphor-icons/react'
import type { StyleMutation, StyleProperty } from '../../types'
import { ScrubField } from './ScrubField'

export type Sides = { top: number; right: number; bottom: number; left: number }
export type CanvasValues = {
  padding: Sides
  margin: Sides
  gap: { row: number; column: number } | null // null when not flex/grid
}

const sidesEqual = (s: Sides) => s.top === s.right && s.right === s.bottom && s.bottom === s.left

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
  tag,
  values,
  onPreview,
  onCommit,
}: {
  tag: string
  values: CanvasValues
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}) {
  const gapLinked = values.gap && values.gap.row === values.gap.column
  return (
    <div className="w-[208px] space-y-3 rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-accent">{tag}</span>
        <span className="text-fg-faint">Spacing</span>
      </div>

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
