import { useEffect, useRef, useState } from 'react'

// A Figma-style numeric field: drag the label left/right to scrub the value, or
// click the number and type. Reports `preview` continuously while dragging (for
// the live inline restyle) and `commit` once on release / Enter / blur (which is
// when the real source edit fires). Escape cancels a typed edit without
// committing.
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
  // `draft` (a number) drives the drag scrub + live preview. `text` (a string)
  // backs the input only while typing, so partial entries like "-" or "" are
  // allowed without snapping back.
  const [draft, setDraft] = useState<number>(value)
  const [text, setText] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [typing, setTyping] = useState(false)
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)
  const latestRef = useRef<number>(value) // last scrubbed value, for a race-free commit
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!dragging && !typing) setDraft(value)
  }, [value, dragging, typing])

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || typing) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startVal: draft }
    latestRef.current = draft
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    // 1px of value per px dragged; hold Shift for fine (0.25px/px) control.
    const step = e.shiftKey ? 0.25 : 1
    const next = clamp(Math.round((d.startVal + (e.clientX - d.startX) * step) * 100) / 100)
    latestRef.current = next
    setDraft(next)
    onPreview(next)
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDragging(false)
    onCommit(latestRef.current) // ref, not state — never a frame behind
  }

  const commitTyped = () => {
    setTyping(false)
    if (cancelRef.current) {
      cancelRef.current = false
      return // Escape path: discard the typed value
    }
    const n = Number(text)
    const v = Number.isFinite(n) ? clamp(n) : value
    setDraft(v)
    onCommit(v)
  }

  const shown = dragging ? draft : typing ? text : String(Math.round(value * 100) / 100)

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
          value={shown}
          onFocus={() => {
            cancelRef.current = false
            setTyping(true)
            setText(String(Math.round(value * 100) / 100))
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') {
              cancelRef.current = true
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={commitTyped}
          className="w-12 rounded border border-line/15 bg-surface px-1.5 py-1 text-right tabular-nums text-fg outline-none transition-colors focus:border-accent/60 motion-reduce:transition-none disabled:opacity-40"
        />
        <span className="w-4 text-fg-faint">{unit}</span>
      </span>
    </label>
  )
}
