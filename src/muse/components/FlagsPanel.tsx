import { useEffect, useRef, useState } from 'react'
import { Check, Crosshair, X } from '@phosphor-icons/react'
import { dismissFlag, refreshFlags, resolveFlag } from '../flagsActions'
import { revealFlag } from '../flagLocate'
import { useMuseStore } from '../store'
import type { Flag } from '../types'

// The flag list — the reliable surface for captured flags (pins are best-effort; the
// panel always shows everything). Open flags first, newest on top; resolved below.
// Each open flag carries the same 1..N ordinal as its on-page pin. Actions are visually
// tiered: Resolve (primary, accent), Jump (ghost), Dismiss (faint icon, isolated right).
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
    <ul className="flex flex-col gap-1.5">
      {ordered.map((f) => {
        const basename = f.file.split('/').pop() ?? f.file
        const isResolved = f.status === 'resolved'
        const ordinal = open.indexOf(f) + 1 // matches the on-page pin number
        const isBusy = busy === f.id
        return (
          <li
            key={f.id}
            className={`rounded-lg border border-line/10 bg-line/5 px-2.5 py-2 ${isResolved ? 'opacity-55' : ''}`}
          >
            <div className="flex items-start gap-2">
              {isResolved ? (
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-fg-faint/15 text-fg-faint">
                  <Check size={10} weight="bold" />
                </span>
              ) : (
                <span className="mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                  {ordinal}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-snug text-fg">
                  {f.comment || <span className="font-normal text-fg-faint">(no note)</span>}
                </p>
                <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-fg-faint">
                  <span className="truncate" title={`${f.file}:${f.line}`}>
                    {basename}:{f.line}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{f.tag}</span>
                </p>
                {isResolved && f.resolution && (
                  <p className="mt-1 text-[11px] leading-snug text-fg-muted">→ {f.resolution}</p>
                )}
                {missId === f.id && (
                  <p className="mt-1 text-[10px] text-fg-faint">Couldn’t find it on the page — the code may have moved.</p>
                )}
                <div className="mt-2 flex items-center gap-1">
                  {!isResolved && (
                    <ActionBtn icon={<Check size={12} weight="bold" />} label="Resolve" primary disabled={isBusy} onClick={() => void act(f.id, () => resolveFlag(f.id))} />
                  )}
                  <ActionBtn icon={<Crosshair size={12} />} label="Jump" disabled={isBusy} onClick={() => jump(f)} />
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => void act(f.id, () => dismissFlag(f.id))}
                    disabled={isBusy}
                    title="Dismiss"
                    aria-label="Dismiss flag"
                    className="rounded p-1 text-fg-faint transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// A labeled action chip. `primary` (Resolve) gets the accent tint to read as the main
// action; the default (Jump) is a quiet ghost — so the two never look interchangeable.
function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        primary ? 'bg-accent/10 text-accent hover:bg-accent/15' : 'text-fg-muted hover:bg-line/10 hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
