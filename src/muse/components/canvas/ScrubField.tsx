import { useEffect, useRef, useState } from 'react'

// A Figma-style numeric field: drag the label left/right to scrub the value, or
// click the number and type. Reports `preview` continuously while dragging (for
// the live inline restyle) and `commit` once on release / Enter / blur (which is
// when the real source edit fires).
export function ScrubField({
  label,
  value,
  min = -Infinity,
  max = Infinity,
  unit = 'px',
  disabled = false,
  onPreview,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  unit?: string
  disabled?: boolean
  onPreview: (v: number) => void
  onCommit: (v: number) => void
}) {
  // While editing (drag or typing) we hold a local draft so the field doesn't
  // fight the prop. Outside editing it mirrors `value`.
  const [draft, setDraft] = useState<number>(value)
  const [editing, setEditing] = useState(false)
  const [typing, setTyping] = useState(false)
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || typing) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startVal: draft }
    setEditing(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    // 1px of value per px dragged; hold Shift for fine (0.25px/px) control.
    const step = e.shiftKey ? 0.25 : 1
    const next = clamp(Math.round((d.startVal + (e.clientX - d.startX) * step) * 100) / 100)
    setDraft(next)
    onPreview(next)
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setEditing(false)
    onCommit(draft)
  }

  const commitTyped = () => {
    setTyping(false)
    setEditing(false)
    const v = clamp(draft)
    setDraft(v)
    onCommit(v)
  }

  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`select-none text-fg-faint ${disabled ? 'opacity-40' : 'cursor-ew-resize hover:text-fg-muted'}`}
        title={disabled ? undefined : 'Drag to scrub · Shift for fine'}
      >
        {label}
      </span>
      <span className="flex items-center gap-0.5">
        <input
          type="text"
          inputMode="decimal"
          data-testid={`scrub-${label}`}
          disabled={disabled}
          value={editing || typing ? String(draft) : String(Math.round(value * 100) / 100)}
          onFocus={() => {
            setTyping(true)
            setEditing(true)
            setDraft(value)
          }}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^\d.-]/g, ''))
            if (Number.isFinite(n)) setDraft(n)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') {
              setDraft(value)
              setTyping(false)
              setEditing(false)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={commitTyped}
          className="w-12 rounded border border-line/15 bg-surface px-1.5 py-1 text-right tabular-nums text-fg outline-none focus:border-accent/60 disabled:opacity-40"
        />
        <span className="w-4 text-fg-faint">{unit}</span>
      </span>
    </label>
  )
}
