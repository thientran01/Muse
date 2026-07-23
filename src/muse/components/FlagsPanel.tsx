import { useEffect, useRef, useState } from 'react'
import { Check, Crosshair, X } from '@phosphor-icons/react'
import { dismissFlag, refreshFlags, resolveFlag } from '../flagsActions'
import { revealFlag } from '../flagLocate'
import { EPHEMERAL, MOCK } from '../config'
import { useMuseStore } from '../store'
import { EmptyState, Row } from './ui'

// Same gate shape as MuseToolbar's SHARE_UI / CanvasMode's BP_UI: in the demo
// modes flags live in an in-browser array (api.ts ephemeralFlags) and no agent
// ever picks them up, so the empty state must not promise the handoff.
const AGENT_HANDOFF = !EPHEMERAL && !MOCK
import type { Flag } from '../types'

// The flag list — the reliable surface for captured flags (pins are best-effort; the
// panel lists every OPEN flag, newest on top). Resolving a flag removes it from the list
// (its job is done; the resolution still lives in .muse/flags.json). Each open flag carries
// the same 1..N ordinal as its on-page pin. Actions are visually tiered: Resolve (primary,
// ink), Jump (ghost), Dismiss (faint icon, isolated right).
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
      <EmptyState>
        No flags yet.
        <br />
        {AGENT_HANDOFF
          ? 'Shift-click an element to hand one to your agent.'
          : 'Shift-click an element to flag it. Demo flags stay in your browser; with the backend on, your agent picks them up.'}
      </EmptyState>
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
          <Row as="li" key={f.id}>
            <div className="flex items-start gap-2">
              <span className="mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-badge font-semibold leading-none text-white">
                {ordinal}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-row font-medium leading-snug text-fg [overflow-wrap:anywhere]" title={f.comment || undefined}>
                  {f.comment ? (
                    <span className="line-clamp-4">{f.comment}</span>
                  ) : (
                    <span className="font-normal text-fg-faint">(no note)</span>
                  )}
                </p>
                <p className="mt-1 flex items-center gap-1 font-mono text-chip text-fg-faint">
                  <span className="truncate" title={`${f.file}:${f.line}`}>
                    {basename}:{f.line}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{f.tag}</span>
                </p>
                {missId === f.id && (
                  <p className="mt-1 text-chip text-fg-faint">Couldn’t find it on the page — the code may have moved.</p>
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
                    className="rounded-chip p-1 text-fg-faint transition hover:bg-rose-500/10 hover:text-rose-400 active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              </div>
            </div>
          </Row>
        )
      })}
    </ul>
  )
}

// A labeled action chip. `primary` (Resolve) is the surface's one committing action,
// so it takes the ink treatment (bg-fg/text-surface — the same primary as the Changes
// panel's Share); the default (Jump) is a quiet ghost. Accent-on-tint text was dropped
// here: brick on a 10% brick tint is 2.00:1 on the dark theme (fails AA). See the spec.
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
      className={`inline-flex items-center gap-1 rounded-field px-1.5 py-1 text-field font-medium transition active:scale-95 motion-reduce:active:scale-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
        primary ? 'bg-fg text-surface hover:opacity-90' : 'text-fg-muted hover:bg-wash hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
