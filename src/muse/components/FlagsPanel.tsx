import { useEffect, useRef, useState } from 'react'
import { Check, Crosshair, X } from '@phosphor-icons/react'
import { dismissFlag, refreshFlags, resolveFlag } from '../flagsActions'
import { revealFlag } from '../flagLocate'
import { useMuseStore } from '../store'
import type { Flag } from '../types'

// The flag list — the reliable surface for captured flags (pins are best-effort; the
// panel lists every OPEN flag, newest on top). Resolving a flag removes it from the list
// (its job is done; the resolution still lives in .muse/flags.json). Each open flag carries
// the same 1..N ordinal as its on-page pin. Actions are visually tiered: Resolve (primary,
// accent), Jump (ghost), Dismiss (faint icon, isolated right).
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

  // Show OPEN flags only — a resolved flag's work is done, so it leaves the list (the
  // resolution still lives in .muse/flags.json for the agent's record + clear_resolved).
  const open = flags.filter((f) => f.status === 'open')

  if (open.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
        No flags yet.
        <br />
        Shift-click an element to hand one to your agent.
      </p>
    )
  }

  const ordered = [...open].reverse() // newest on top

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
      {ordered.map((f, i) => {
        const basename = f.file.split('/').pop() ?? f.file
        const ordinal = open.length - i // newest-first display, so the oldest open flag stays #1 (matches the pins)
        const isBusy = busy === f.id
        return (
          <li key={f.id} className="rounded-lg border border-line/10 bg-line/5 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-white">
                {ordinal}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[13px] font-medium leading-snug text-fg [overflow-wrap:anywhere]" title={f.comment || undefined}>
                  {f.comment ? (
                    <span className="line-clamp-4">{f.comment}</span>
                  ) : (
                    <span className="font-normal text-fg-faint">(no note)</span>
                  )}
                </p>
                <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-fg-faint">
                  <span className="truncate" title={`${f.file}:${f.line}`}>
                    {basename}:{f.line}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{f.tag}</span>
                </p>
                {missId === f.id && (
                  <p className="mt-1 text-[10px] text-fg-faint">Couldn’t find it on the page — the code may have moved.</p>
                )}
                <div className="mt-2 flex items-center gap-1">
                  <ActionBtn icon={<Check size={12} weight="bold" />} label="Resolve" primary disabled={isBusy} onClick={() => void act(f.id, () => resolveFlag(f.id))} />
                  <ActionBtn icon={<Crosshair size={12} />} label="Jump" disabled={isBusy} onClick={() => jump(f)} />
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => void act(f.id, () => dismissFlag(f.id))}
                    disabled={isBusy}
                    title="Dismiss"
                    aria-label="Dismiss flag"
                    className="rounded p-1 text-fg-faint transition hover:bg-rose-500/10 hover:text-rose-400 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        primary ? 'bg-accent/10 text-accent hover:bg-accent/15' : 'text-fg-muted hover:bg-line/10 hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
