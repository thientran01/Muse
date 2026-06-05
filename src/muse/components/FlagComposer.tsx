import { useEffect, useRef, useState } from 'react'
import { addFlag } from '../flagsActions'
import type { Flag, FlagDraft } from '../types'

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
  onSaved: (flag: Flag) => void
}) {
  const [comment, setComment] = useState(draft.comment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    // Put the caret at the end of a pre-filled suggestion so the user can keep typing.
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const flag = await addFlag({ ...draft, comment: comment.trim() })
      onSaved(flag)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  // Clamp to the viewport so a flag dropped near an edge stays fully on screen.
  const left = Math.max(8, Math.min(pos.x + 14, window.innerWidth - 272))
  const top = Math.max(8, Math.min(pos.y + 14, window.innerHeight - 188))
  const firstClass = draft.className.split(/\s+/).filter(Boolean)[0]
  const basename = draft.fileName.split(/[\\/]/).pop() ?? draft.fileName

  return (
    <div
      data-muse-panel
      onKeyDown={onKeyDown}
      className="pointer-events-auto absolute z-30 w-[264px] rounded-lg bg-surface/95 p-3 shadow-xl ring-1 ring-line/15 backdrop-blur animate-muse-step motion-reduce:animate-none"
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
        ref={ref}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Describe the change you want…"
        rows={3}
        className="w-full resize-none rounded-md border border-line/20 bg-line/5 px-2 py-1.5 text-[12px] leading-snug text-fg placeholder:text-fg-faint focus:border-accent/40 focus:outline-none"
      />
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] text-fg-faint" title={`${basename}:${draft.line}`}>
          {basename}:{draft.line}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-fg-muted transition hover:bg-line/10 hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded bg-fg px-2.5 py-1 text-[11px] font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Flagging…' : 'Flag it'}
          </button>
        </div>
      </div>
    </div>
  )
}
