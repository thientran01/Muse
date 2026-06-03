import { useEffect, useState } from 'react'
import { museTokenEdit, museTokens, museWrite, type DesignToken } from '../api'
import { EPHEMERAL, MOCK } from '../config'
import { museStore } from '../store'
import type { HistoryEntry } from '../types'

// One token row: a swatch (color tokens) + the name + an editable value field. Commits
// on blur / Enter. A spacer keeps non-color rows aligned with color ones.
function TokenRow({ token, busy, onCommit }: { token: DesignToken; busy: boolean; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(token.value)
  // Re-sync if the parent updates the value (optimistic apply, or undo).
  useEffect(() => setVal(token.value), [token.value])
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={token.isColor ? 'h-4 w-4 shrink-0 rounded ring-1 ring-line/20' : 'h-4 w-4 shrink-0'}
        style={token.isColor ? { background: token.value } : undefined}
      />
      <code className="w-[84px] shrink-0 truncate font-mono text-[10px] text-fg-muted" title={token.name}>
        {token.name}
      </code>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => onCommit(val)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') setVal(token.value)
        }}
        disabled={busy}
        aria-label={`Value for ${token.name}`}
        className="min-w-0 flex-1 rounded-md border border-line/10 bg-line/[0.04] px-1.5 py-1 font-mono text-[11px] text-fg outline-none transition focus:border-accent focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
      />
    </div>
  )
}

// The host's design tokens, editable in place. Self-contained: reads tokens on mount and
// commits each edit through the same write + shared-history path as canvas edits (no props
// to thread from the overlay). Editing a token rewrites its base value in the defining
// stylesheet, and HMR repaints everything that uses it.
export function TokenList() {
  const [tokens, setTokens] = useState<DesignToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    museTokens()
      .then((t) => { if (!cancelled) setTokens(t) })
      // Leave tokens null on a fetch failure so the error shows instead of being
      // swallowed into the empty "no tokens" state.
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [])

  const commit = async (name: string, next: string, prev: string) => {
    const value = next.trim()
    if (!value || value === prev.trim()) return
    // MOCK / EPHEMERAL: no backend write — apply optimistically so the demo's panel works
    // (a swatch/value updates) instead of erroring on every edit.
    if (MOCK || EPHEMERAL) {
      setTokens((cur) => cur?.map((t) => (t.name === name ? { ...t, value } : t)) ?? null)
      return
    }
    setBusy(name)
    try {
      const { edits, originals, warnings } = await museTokenEdit(name, value)
      if (warnings.length) console.warn('[muse] token-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        setError(warnings[0] ?? "Couldn't update that token.")
        return
      }
      await museWrite(edits)
      const entry: HistoryEntry = {
        files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName], after: e.newContent })),
        elements: [],
        label: `token ${name}`,
      }
      museStore.setState((cur) => ({ past: [...cur.past, entry], future: [], applied: true }))
      setTokens((cur) => cur?.map((t) => (t.name === name ? { ...t, value } : t)) ?? null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const errorChip = (msg: string) => (
    <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300 ring-1 ring-rose-500/20">{msg}</p>
  )

  if (error && !tokens) return errorChip("Couldn't read your tokens.")
  if (!tokens) return <p className="text-[11px] text-fg-faint">Reading tokens…</p>
  if (tokens.length === 0) return <p className="text-[11px] text-fg-faint">No CSS custom properties found.</p>

  return (
    // Cap height + scroll so a token-heavy host doesn't let this list swallow the panel.
    <div className="max-h-44 space-y-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line/20">
      {tokens.map((t) => (
        <TokenRow key={t.name} token={t} busy={busy === t.name} onCommit={(v) => commit(t.name, v, t.value)} />
      ))}
      {error && errorChip(error)}
    </div>
  )
}
