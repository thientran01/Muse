import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { museStyleEdit, museWrite } from '../../api'
import { museStore } from '../../store'
import { PROPERTIES } from '../../style/properties'
import type { CanvasElement, HistoryEntry, SelectedElement, StyleMutation } from '../../types'
import { canvasChain, useCanvasMode } from '../../useCanvasMode'
import { HoverHighlight } from '../SelectionOverlay'
import { BoxModelOverlay } from './BoxModelOverlay'
import { PropertiesPanel, type CanvasValues, type Sides } from './PropertiesPanel'

const PANEL_W = 208
const GAP = 12

const px = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
const sidesOf = (cs: CSSStyleDeclaration, p: 'padding' | 'margin'): Sides => ({
  top: px(cs[`${p}Top` as 'paddingTop']),
  right: px(cs[`${p}Right` as 'paddingRight']),
  bottom: px(cs[`${p}Bottom` as 'paddingBottom']),
  left: px(cs[`${p}Left` as 'paddingLeft']),
})

function readValues(node: HTMLElement): CanvasValues {
  const cs = getComputedStyle(node)
  const isFlexGrid = /(^|\s|-)(flex|grid)$/.test(cs.display)
  return {
    padding: sidesOf(cs, 'padding'),
    margin: sidesOf(cs, 'margin'),
    gap: isFlexGrid ? { row: px(cs.rowGap), column: px(cs.columnGap) } : null,
  }
}

const asSelected = (el: CanvasElement): SelectedElement => ({
  fileName: el.fileName,
  line: el.line,
  tag: el.tag,
  classNames: el.node.getAttribute('class') ?? '',
  text: (el.node.textContent ?? '').trim().slice(0, 80),
  key: el.key,
  node: el.node,
})

// The direct-manipulation mode. Picks an element, shows a floating spacing
// popover + box-model overlay, scrubs live (inline style), and commits each
// change to source deterministically — landing in the same undo/redo history as
// chat edits.
export function CanvasMode({ onExit }: { onExit: () => void }) {
  const { active, setActive, hoverRect, hoverInfo, cursor, selected, selectElement, miss } = useCanvasMode()
  const [revision, bump] = useState(0)
  const [values, setValues] = useState<CanvasValues | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null)
  // The live inline preview: which node we've overridden and which CSS keys. Held
  // as a single object (not a bare Set) so a commit can SNAPSHOT the exact node +
  // keys to strip after HMR — even if the selection moves on first. A stale
  // override left on a node would survive an undo and lie about the source.
  const previewRef = useRef<{ node: HTMLElement; keys: Set<string> } | null>(null)
  const clearTimerRef = useRef<number | null>(null)

  // Enter canvas mode on mount; tell the parent when it's dismissed (Esc).
  const startedRef = useRef(false)
  useEffect(() => {
    setActive(true)
    return () => setActive(false)
  }, [setActive])
  useEffect(() => {
    // Only report a dismissal AFTER we've actually activated — otherwise the
    // initial render (active still false, before setActive lands) would exit
    // immediately.
    if (active) startedRef.current = true
    else if (startedRef.current) onExit()
  }, [active, onExit])

  // Remove a specific set of inline overrides from a specific node.
  const stripInline = (node: HTMLElement, keys: Iterable<string>) => {
    for (const k of keys) node.style.removeProperty(camelToKebab(k))
  }
  // Clear the CURRENTLY-live preview (whatever node it's on), no-op if none.
  const clearPreview = () => {
    const p = previewRef.current
    if (!p) return
    stripInline(p.node, p.keys)
    previewRef.current = null
  }

  // Re-read computed values + reposition when the target or revision changes.
  useLayoutEffect(() => {
    if (!selected) {
      setValues(null)
      setPanelPos(null)
      return
    }
    setValues(readValues(selected.node))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, revision])

  // Keep the popover glued to the element through scroll/resize.
  useLayoutEffect(() => {
    if (!selected) return
    const place = () => {
      const r = selected.node.getBoundingClientRect()
      const right = r.right + GAP
      const left = right + PANEL_W <= window.innerWidth ? right : Math.max(GAP, r.left - GAP - PANEL_W)
      const top = Math.min(Math.max(GAP, r.top), window.innerHeight - 240)
      setPanelPos({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [selected, revision])

  // Clear any stray inline preview when the target changes or we leave.
  useEffect(() => clearPreview, [selected])
  // Cancel a pending post-commit strip on unmount so it can't fire on a gone node.
  useEffect(() => () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current) }, [])

  // Show a brief "can't edit this" hint at the click point on an unmappable click.
  useEffect(() => {
    if (!miss) return
    setHint({ x: miss.x, y: miss.y })
    const t = window.setTimeout(() => setHint(null), 1600)
    return () => clearTimeout(t)
  }, [miss?.id])

  // Native-feeling undo/redo on the SAME shared history stack chat writes to —
  // file-only (no chat-panel side effects), so Cmd/Ctrl+Z works in canvas too.
  useEffect(() => {
    const step = async (dir: 'undo' | 'redo') => {
      const s = museStore.getState()
      const entry = dir === 'undo' ? s.past[s.past.length - 1] : s.future[0]
      if (!entry) return
      const side = dir === 'undo' ? 'before' : 'after'
      clearPreview() // drop any live scrub override so it can't mask the restore
      try {
        await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f[side] })))
        museStore.setState((st) =>
          dir === 'undo'
            ? { past: st.past.slice(0, -1), future: [entry, ...st.future], applied: false }
            : { future: st.future.slice(1), past: [...st.past, entry], applied: true },
        )
        window.setTimeout(() => bump((v) => v + 1), 160)
      } catch (e) {
        setError((e as Error).message)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      void step(e.shiftKey ? 'redo' : 'undo')
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  const applyPreview = (mutations: StyleMutation[]) => {
    const node = selected?.node
    if (!node) return
    // Start (or continue) a preview entry for THIS node. A different node means a
    // fresh entry — the prior node's overrides are cleared by the selection-change
    // effect, so we don't carry its keys over.
    let p = previewRef.current
    if (!p || p.node !== node) {
      p = { node, keys: new Set() }
      previewRef.current = p
    }
    for (const m of mutations) {
      for (const key of PROPERTIES[m.property].css) {
        node.style.setProperty(camelToKebab(key), m.value)
        p.keys.add(key)
      }
    }
  }

  async function commit(mutations: StyleMutation[]) {
    if (!selected) return
    applyPreview(mutations) // make sure the final value is showing
    const label = mutations.map((m) => `${m.property} ${m.value}`).join(', ').slice(0, 80)
    try {
      const { edits, originals, warnings } = await museStyleEdit([
        {
          fileName: selected.fileName,
          line: selected.line,
          column: selected.column,
          tag: selected.tag,
          classNames: selected.node.getAttribute('class') ?? '',
          mutations,
        },
      ])
      if (warnings.length) console.warn('[muse] style-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        clearPreview() // nothing was written — don't leave a phantom inline override
        setError(warnings[0] ?? "Couldn't apply that change.")
        return
      }
      await museWrite(edits)
      // Build the undo entry only if every file's pre-edit content is known —
      // an empty `before` would zero the file on undo. (Keys always align today;
      // this guards against a future server/key drift rather than silently
      // corrupting the undo stack.)
      const haveAllOriginals = edits.every((e) => typeof originals[e.fileName] === 'string')
      if (haveAllOriginals) {
        const entry: HistoryEntry = {
          files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName], after: e.newContent })),
          elements: [asSelected(selected)],
          label,
        }
        museStore.setState((cur) => ({ past: [...cur.past, entry], future: [], applied: true }))
      } else {
        console.warn('[muse] style-edit: missing originals, skipping undo entry')
      }
      // Let HMR repaint from the new source, THEN strip this commit's exact inline
      // overrides and re-read so the panel/overlay reflect source truth (and undo
      // stays honest). Snapshot the node+keys so a selection change in the
      // meantime can't redirect the strip to the wrong node; detach the live ref
      // so a fresh scrub starts clean. Cancel any prior pending strip.
      const snap = previewRef.current
      previewRef.current = null
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = window.setTimeout(() => {
        if (snap) stripInline(snap.node, snap.keys)
        bump((v) => v + 1)
      }, 160)
    } catch (e) {
      clearPreview()
      setError((e as Error).message)
    }
  }

  return (
    <div data-muse-ui className="pointer-events-none fixed inset-0 z-[999998] font-sans">
      {/* Hover affordance while no edit is in flight — lets you retarget. */}
      {hoverRect && <HoverHighlight rect={hoverRect} cursor={cursor} info={hoverInfo} />}

      {/* Quiet hint when a click lands on an element with no source mapping. */}
      {hint && (
        <div
          className="pointer-events-none absolute rounded-md bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-lg ring-1 ring-line/10 backdrop-blur animate-muse-step motion-reduce:animate-none"
          style={{ top: hint.y + 14, left: hint.x + 14 }}
        >
          Can't edit this one — no source mapping
        </div>
      )}

      {selected && values && (
        <>
          <BoxModelOverlay
            node={selected.node}
            padding={values.padding}
            margin={values.margin}
            onPreview={applyPreview}
            onCommit={commit}
          />
          {panelPos && (
            <div className="pointer-events-auto absolute" style={{ top: panelPos.top, left: panelPos.left }}>
              {/* Key by element so the per-side expand state re-derives from the
                  new element's values instead of carrying over the last one's. */}
              <PropertiesPanel
                key={selected.key}
                values={values}
                chain={selected.node.isConnected ? canvasChain(selected.node) : [selected]}
                selectedKey={selected.key}
                onPick={selectElement}
                onPreview={applyPreview}
                onCommit={commit}
              />
              {error && (
                <p className="mt-1.5 w-[208px] rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300 ring-1 ring-rose-500/20">
                  {error}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Mode banner — mirrors chat's SelectBanner. */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface/95 px-4 py-2 text-sm font-medium text-fg shadow-lg ring-1 ring-line/10 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Canvas
          <span className="text-fg-faint">
            {selected ? '· Alt-click or the breadcrumb selects the container · Esc to deselect' : '· click an element · Alt-click for its container · Esc to exit'}
          </span>
          <button onClick={() => setActive(false)} className="ml-1 rounded-full px-2 py-0.5 text-fg-muted transition hover:bg-line/10 hover:text-fg">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// node.style.setProperty needs kebab-case; our property model speaks camelCase.
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
