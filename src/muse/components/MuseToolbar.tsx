import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ClockCounterClockwise, FileText, X } from '@phosphor-icons/react'
import { museDesignGenerate, museDesignGet } from '../api'
import type { ArchivedThread } from '../store'
import { UfoIcon } from './UfoIcon'
import { MuseHistory } from './MuseHistory'
import { MessageDesign } from './messages/MessageDesign'

// Muse's idle "home" — a compact icon toolbar, NOT a panel. The top banner
// already teaches the gesture (Shift-click hands an element to the agent), so the
// home explains nothing: it's pure utility. The FAB grows into this bar (decision
// 2A); history + the design brief open as a POPOVER above it, the bar staying put
// (decision 1B). Shift-clicking an element on the page is what opens the full
// agent panel — this is only the resting state.

type Pop = 'none' | 'history' | 'design'
type DesignState = { status: 'offer' | 'generating' | 'view'; content?: string; path?: string }

function IconBtn({
  label,
  accent = false,
  onClick,
  children,
}: {
  label: string
  accent?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-95 motion-reduce:active:scale-100 ${
        accent ? 'text-accent hover:bg-accent/10' : 'text-fg-faint hover:bg-line/10 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

export function MuseToolbar({
  archived,
  onPickHistory,
  onClose,
  closing = false,
}: {
  archived: ArchivedThread[]
  onPickHistory: (id: string) => void
  onClose: () => void
  // True while Muse is collapsing back to the FAB — the bar shrinks toward the
  // corner so the close reads as the toolbar folding into the FAB (mirrors 2A's
  // grow, in reverse).
  closing?: boolean
}) {
  const [pop, setPop] = useState<Pop>('none')
  const [design, setDesign] = useState<DesignState | null>(null)
  // Guards for the lazy design fetch: `fetching` blocks a concurrent GET (a
  // double-click on the design icon), `mounted` drops a late setState if the
  // toolbar unmounted mid-fetch (Shift-click escalates → home flips false). Mirror
  // of the parent's showingDesignRef pattern.
  const fetchingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // The design brief is fetched lazily the first time its popover opens (then
  // cached for the session). Self-contained here — the idle toolbar has no thread
  // to append a bubble to, unlike the agent panel's design flow.
  const openDesign = async () => {
    setPop((p) => (p === 'design' ? 'none' : 'design'))
    if (design || fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await museDesignGet()
      if (mountedRef.current) {
        setDesign(res.exists && res.content ? { status: 'view', content: res.content, path: res.path } : { status: 'offer' })
      }
    } catch {
      if (mountedRef.current) setDesign({ status: 'offer' })
    } finally {
      fetchingRef.current = false
    }
  }
  const generateDesign = async () => {
    setDesign({ status: 'generating' })
    try {
      const res = await museDesignGenerate()
      if (mountedRef.current) setDesign({ status: 'view', content: res.content, path: res.path })
    } catch {
      if (mountedRef.current) setDesign({ status: 'offer' })
    }
  }

  return (
    <div
      data-closing={closing ? 'true' : undefined}
      className="muse-panel-surface pointer-events-auto absolute bottom-6 right-6 flex flex-col items-end gap-2"
    >
      {/* 1B popover — opens above the bar; the bar below stays put. */}
      {pop !== 'none' && !closing && (
        // Origin-aware entrance — scales up from the bar/FAB corner below it
        // (Emil: popovers grow from their trigger), reusing the panel keyframe.
        <div className="w-72 origin-bottom-right animate-muse-panel overflow-hidden rounded-2xl bg-surface/95 shadow-xl shadow-black/20 ring-1 ring-line/10 backdrop-blur-xl motion-reduce:animate-none">
          <header className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
              <UfoIcon size={16} className="text-accent" />
              {pop === 'history' ? 'Past proposals' : 'Design system'}
            </div>
            <button
              onClick={() => setPop('none')}
              aria-label={`Close ${pop === 'history' ? 'past proposals' : 'design system'}`}
              className="rounded-md p-1.5 text-fg-faint transition hover:bg-line/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <X size={15} />
            </button>
          </header>
          <div className="max-h-[50vh] overflow-y-auto px-3 pb-3">
            {pop === 'history' ? (
              archived.length > 0 ? (
                <MuseHistory entries={archived} onPick={onPickHistory} />
              ) : (
                <p className="px-1 py-2 text-xs leading-relaxed text-fg-faint">
                  No past proposals yet. Closed edits you haven't applied show up here.
                </p>
              )
            ) : design ? (
              <MessageDesign status={design.status} content={design.content} path={design.path} onGenerate={generateDesign} />
            ) : (
              <p className="px-1 py-2 text-xs text-fg-faint">Loading…</p>
            )}
          </div>
        </div>
      )}

      {/* The bar: manta (identity) · past proposals · design system · X. */}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-surface-soft p-1.5 shadow-lg shadow-black/20 ring-1 ring-line/10">
        <span className="flex h-8 w-8 items-center justify-center" aria-hidden="true">
          <UfoIcon size={18} className="text-accent" />
        </span>
        <IconBtn label="Past proposals" onClick={() => setPop((p) => (p === 'history' ? 'none' : 'history'))}>
          <ClockCounterClockwise size={17} weight="bold" />
        </IconBtn>
        <IconBtn label="Design system" onClick={openDesign}>
          <FileText size={17} />
        </IconBtn>
        <span className="mx-0.5 h-5 w-px bg-line/15" />
        <IconBtn label="Close Muse" onClick={onClose}>
          <X size={16} weight="bold" />
        </IconBtn>
      </div>
    </div>
  )
}
