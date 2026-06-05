import { useEffect, useRef, useState } from 'react'
import { dismissFlag, refreshFlags, resolveFlag } from '../flagsActions'
import { revealFlag } from '../flagLocate'
import { useMuseStore } from '../store'
import type { Flag } from '../types'

// The flag list — the reliable surface for captured flags (pins are best-effort; the
// panel always shows everything). Open flags first, newest on top; resolved below.
// Actions per flag: jump-to-element (best-effort), resolve, dismiss. Reads the reactive
// store and refreshes on open so it reflects anything captured this session.
export function FlagsPanel() {
  const { flags } = useMuseStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [missId, setMissId] = useState<string | null>(null)
  const missTimer = useRef<number | null>(null)

  useEffect(() => {
    void refreshFlags()
    return () => {
      if (missTimer.current) clearTimeout(missTimer.current)
    }
  }, [])

  if (flags.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
        No flags yet.
        <br />
        Shift-click an element to hand one to your agent.
      </p>
    )
  }

  const open = flags.filter((f) => f.status === 'open')
  const resolved = flags.filter((f) => f.status === 'resolved')
  const ordered = [...open].reverse().concat([...resolved].reverse())

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } catch {
      /* flagsActions.refreshFlags warns; leave the row as-is */
    } finally {
      setBusy(null)
    }
  }

  const jump = (f: Flag) => {
    if (revealFlag(f)) return
    if (missTimer.current) clearTimeout(missTimer.current)
    setMissId(f.id)
    missTimer.current = window.setTimeout(() => setMissId((c) => (c === f.id ? null : c)), 2400)
  }

  return (
    <ul className="flex flex-col gap-1">
      {ordered.map((f) => {
        const basename = f.file.split('/').pop() ?? f.file
        const isResolved = f.status === 'resolved'
        return (
          <li
            key={f.id}
            className={`rounded-lg border border-line/10 bg-line/5 px-2.5 py-2 ${isResolved ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start gap-1.5">
              <span
                aria-hidden
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isResolved ? 'bg-fg-faint' : 'bg-accent'}`}
              />
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-fg">
                {f.comment || <span className="text-fg-faint">(no note)</span>}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-1.5 pl-3 font-mono text-[10px] text-fg-faint">
              <span className="truncate" title={`${f.file}:${f.line}`}>
                {basename}:{f.line}
              </span>
              <span>·</span>
              <span>{f.tag}</span>
            </div>
            {isResolved && f.resolution && (
              <p className="mt-1 pl-3 text-[11px] leading-snug text-fg-muted">→ {f.resolution}</p>
            )}
            {missId === f.id && (
              <p className="mt-1 pl-3 text-[10px] text-fg-faint">Couldn’t find it on the page — the code may have moved.</p>
            )}
            <div className="mt-1.5 flex items-center gap-1 pl-3">
              <RowBtn onClick={() => jump(f)} disabled={busy === f.id}>
                Jump
              </RowBtn>
              {!isResolved && (
                <RowBtn onClick={() => void act(f.id, () => resolveFlag(f.id))} disabled={busy === f.id}>
                  Resolve
                </RowBtn>
              )}
              <RowBtn onClick={() => void act(f.id, () => dismissFlag(f.id))} disabled={busy === f.id} danger>
                Dismiss
              </RowBtn>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function RowBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-1.5 py-0.5 text-[11px] transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        danger
          ? 'text-fg-faint hover:bg-rose-500/10 hover:text-rose-300' // tinted bg lifts the rose text to a readable ratio on the light theme too
          : 'text-fg-muted hover:bg-line/10 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
