import { useEffect, useState } from 'react'
import { museTokenEdit, museTokens, museWrite, type DesignToken } from '../api'
import { EPHEMERAL, MOCK } from '../config'
import { museStore } from '../store'
import type { HistoryEntry } from '../types'
import { ColorRow, SectionLabel } from './canvas/PropertiesPanel'

// A hex literal the ColorPicker can round-trip losslessly. Color tokens authored
// as rgb()/hsl()/oklch() keep their format via a text field instead, so editing
// one doesn't silently rewrite the author's color space to hex.
const isHexColor = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v.trim())

// A value token: name + an editable field, in the same row shape as the canvas
// color rows (label left, control right) — with a leading swatch for color tokens.
// Commits on blur / Enter.
function ValueRow({ token, busy, onCommit }: { token: DesignToken; busy: boolean; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(token.value)
  // Re-sync if the parent updates the value (optimistic apply, or undo).
  useEffect(() => setVal(token.value), [token.value])
  return (
    <div className="flex items-center justify-between gap-2 text-field">
      <code className="min-w-0 truncate font-mono text-fg-faint" title={token.name}>
        {token.name}
      </code>
      <div className="flex shrink-0 items-center gap-1.5">
        {token.isColor && (
          <span className="h-5 w-5 shrink-0 rounded border border-line/20" style={{ backgroundColor: val }} />
        )}
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
          className="w-[84px] shrink-0 rounded-md border border-line/10 bg-line/[0.04] px-1.5 py-0.5 text-right font-mono tabular-nums text-fg outline-none transition focus:border-accent focus:ring-1 focus:ring-accent/25 disabled:opacity-50"
        />
      </div>
    </div>
  )
}

// The host's design tokens, editable in place — color tokens open the same Canvas
// color picker (live-previewing the CSS var on the page), other tokens get a value
// field. Self-contained: reads tokens on mount and commits each edit through the
// same write + shared-history path as canvas edits.
export function TokenList({ portalContainer }: { portalContainer?: React.RefObject<HTMLElement> }) {
  const [tokens, setTokens] = useState<DesignToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Non-fatal write notes (e.g. "themed in 2 selectors — updated the base value").
  // Shown in the panel, not just the console: in dark mode a base-value edit can be
  // visually masked by the theme override, and this is the only thing that says why.
  const [notice, setNotice] = useState<string | null>(null)
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

  // Live-preview a value by overriding the CSS var on the host root, so dragging the
  // color picker repaints the page in real time — the same feel as a canvas color
  // scrub. The override is TRANSIENT: when the picker closes (onClose) we drop it so
  // the source value (HMR'd in by a real write) governs again — otherwise the inline
  // override would beat the stylesheet and silently mask later edits / undo. In MOCK
  // / EPHEMERAL there's no source to fall back to, so the override is kept as the
  // applied state.
  const applyLive = (name: string, value: string) => {
    document.documentElement.style.setProperty(name, value)
  }
  const clearLive = (name: string) => {
    if (MOCK || EPHEMERAL) return // the override IS the persistence in the demo
    document.documentElement.style.removeProperty(name)
  }

  const commit = async (name: string, next: string, prev: string) => {
    const value = next.trim()
    if (!value || value === prev.trim()) return
    applyLive(name, value)
    setTokens((cur) => cur?.map((t) => (t.name === name ? { ...t, value } : t)) ?? null)
    // MOCK / EPHEMERAL: no backend write — the live override IS the applied state.
    if (MOCK || EPHEMERAL) return
    setBusy(name)
    setNotice(null)
    try {
      const { edits, originals, warnings } = await museTokenEdit(name, value)
      if (warnings.length) console.warn('[muse] token-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        setError(warnings[0] ?? "Couldn't update that token.")
        return
      }
      if (warnings.length) setNotice(warnings.join(' '))
      await museWrite(edits)
      const entry: HistoryEntry = {
        files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName], after: e.newContent })),
        elements: [],
        label: `token ${name}`,
      }
      museStore.setState((cur) => ({ past: [...cur.past, entry], future: [] }))
      setError(null)
    } catch (e) {
      // Write failed — back out the optimistic value + the live override, and
      // drop any pre-write notice (it implied a write that didn't land).
      applyLive(name, prev)
      setTokens((cur) => cur?.map((t) => (t.name === name ? { ...t, value: prev } : t)) ?? null)
      setNotice(null)
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const errorChip = (msg: string) => (
    <p role="status" className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-field text-rose-300 ring-1 ring-rose-500/20">{msg}</p>
  )

  if (error && !tokens) return errorChip("Couldn't read your tokens.")
  if (!tokens) return <p className="py-1 text-field text-fg-faint">Reading tokens…</p>
  if (tokens.length === 0) return <p className="py-1 text-field text-fg-faint">No CSS custom properties found.</p>

  // Hex color tokens get the visual picker; everything else (non-hex colors, sizes,
  // radii, …) gets a value field. Colors group together regardless.
  const colorTokens = tokens.filter((t) => t.isColor)
  const valueTokens = tokens.filter((t) => !t.isColor)

  return (
    <div className="space-y-2.5">
      {colorTokens.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Colors</SectionLabel>
          {colorTokens.map((t) =>
            isHexColor(t.value) ? (
              <ColorRow
                key={t.name}
                label={t.name}
                ariaLabel={`Edit ${t.name}`}
                value={t.value}
                themed={false}
                portalContainer={portalContainer}
                onPreview={(v) => applyLive(t.name, v)}
                onCommit={(v) => commit(t.name, v, t.value)}
                onClose={() => clearLive(t.name)}
              />
            ) : (
              <ValueRow key={t.name} token={t} busy={busy === t.name} onCommit={(v) => commit(t.name, v, t.value)} />
            ),
          )}
        </div>
      )}
      {valueTokens.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Values</SectionLabel>
          {valueTokens.map((t) => (
            <ValueRow key={t.name} token={t} busy={busy === t.name} onCommit={(v) => commit(t.name, v, t.value)} />
          ))}
        </div>
      )}
      {error && errorChip(error)}
      {notice && (
        <p role="status" className="rounded-lg bg-line/[0.06] px-2.5 py-1.5 text-field leading-relaxed text-fg-muted ring-1 ring-line/15">
          {notice}
        </p>
      )}
    </div>
  )
}
