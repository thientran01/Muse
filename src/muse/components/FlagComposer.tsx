import { useEffect, useRef, useState } from 'react'
import { addFlag } from '../flagsActions'
import type { FlagDraft } from '../types'

// A small floating card that captures a flag's plain-English intent and persists it.
// Both capture entry points converge here: a shift-click (empty comment) and a Canvas
// refusal's "Flag it for your agent" button (comment + reason pre-filled from the
// refused edit). Rendered inside CanvasMode's [data-muse-ui] root, so Canvas's own
// click/hover handlers leave it alone (isMuseUI guard).
export function FlagComposer({
  draft,
  pos,
  onClose,
  onSaved,
}: {
  draft: FlagDraft
  pos: { x: number; y: number }
  onClose: () => void
  onSaved: () => void
}) {
  const [comment, setComment] = useState(draft.comment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = taRef.current
    if (!t) return
    t.focus()
    // Put the caret at the end of a pre-filled suggestion so the user can keep typing.
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])

  // Close on outside-click (mirrors ColorRow). The overlay lives in a Shadow DOM, so a
  // document listener sees the event retargeted to the host — composedPath() keeps the
  // true path through the boundary, so a click on the card's own controls isn't "outside".
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const card = cardRef.current
      if (card && e.composedPath().includes(card)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await addFlag({ ...draft, comment: comment.trim() })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  // Clamp to the viewport so a flag dropped near an edge stays fully on screen. The
  // reserve leaves room for the (optional) reason + error lines so the card never clips.
  const left = Math.max(8, Math.min(pos.x + 14, window.innerWidth - 272))
  const top = Math.max(8, Math.min(pos.y + 14, window.innerHeight - 232))
  const firstClass = draft.className.split(/\s+/).filter(Boolean)[0]
  const basename = draft.fileName.split(/[\\/]/).pop() ?? draft.fileName
  const btnFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

  return (
    <div
      ref={cardRef}
      data-muse-panel
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
      className="pointer-events-auto absolute z-30 w-[264px] rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur animate-muse-step motion-reduce:animate-none"
      style={{ top, left }}
    >
      <div className="mb-1.5 flex items-baseline gap-1.5 text-[11px]">
        <span className="font-semibold text-fg">Flag for your agent</span>
        <span className="truncate font-mono text-fg-faint">
          {draft.tag}
          {firstClass ? `.${firstClass}` : ''}
        </span>
      </div>
      {draft.reason && (
        <p className="mb-1.5 text-[11px] leading-snug text-fg-muted">Canvas can’t do this: {draft.reason}</p>
      )}
      <textarea
        ref={taRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits ONLY from the textarea (Shift+Enter = newline). Buttons handle
          // their own Enter/Space via type="button".
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
        aria-label="Describe the change you want for your agent"
        placeholder="Describe the change you want…"
        rows={3}
        className="w-full resize-none rounded-md border border-line/20 bg-line/5 px-2 py-1.5 text-[12px] leading-snug text-fg placeholder:text-fg-faint focus:border-fg/40 focus:outline-none focus:ring-1 focus:ring-fg/20"
      />
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] text-fg-faint" title={`${basename}:${draft.line}`}>
          {basename}:{draft.line}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className={`rounded px-2 py-1 text-[11px] text-fg-muted transition hover:bg-line/10 hover:text-fg active:scale-95 motion-reduce:active:scale-100 ${btnFocus}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={`rounded bg-fg px-2.5 py-1 text-[11px] font-medium text-surface transition hover:opacity-90 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-50 ${btnFocus}`}
          >
            {busy ? 'Flagging…' : 'Flag it'}
          </button>
        </div>
      </div>
    </div>
  )
}
