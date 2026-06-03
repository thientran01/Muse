import { useEffect, useState } from 'react'
import { museTokenEdit, museTokens, museWrite, type DesignToken } from '../api'
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
      {token.isColor ? (
        <span className="h-4 w-4 shrink-0 rounded ring-1 ring-line/20" style={{ background: token.value }} />
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
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
        className="min-w-0 flex-1 rounded-md border border-line/10 bg-line/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-fg outline-none transition focus:border-accent focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
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
      .catch((e) => { if (!cancelled) { setTokens([]); setError((e as Error).message) } })
    return () => { cancelled = true }
  }, [])

  const commit = async (name: string, next: string, prev: string) => {
    const value = next.trim()
    if (!value || value === prev.trim()) return
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

  if (!tokens) return <p className="text-[11px] text-fg-faint">Reading tokens…</p>
  if (tokens.length === 0) return <p className="text-[11px] text-fg-faint">No CSS custom properties found.</p>

  return (
    <div className="space-y-1">
      {tokens.map((t) => (
        <TokenRow key={t.name} token={t} busy={busy === t.name} onCommit={(v) => commit(t.name, v, t.value)} />
      ))}
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  )
}
