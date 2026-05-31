import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { museStyleEdit, museWrite } from '../../api'
import { museStore } from '../../store'
import { PROPERTIES } from '../../style/properties'
import type { CanvasElement, HistoryEntry, SelectedElement, StyleMutation } from '../../types'
import { useCanvasMode } from '../../useCanvasMode'
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
  const { active, setActive, hoverRect, hoverInfo, cursor, selected, setSelected } = useCanvasMode()
  const [revision, bump] = useState(0)
  const [values, setValues] = useState<CanvasValues | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // CSS keys we've overridden inline on the live node for the live preview, so
  // we can clear them once the real edit's HMR repaint lands (else a stale
  // override would survive an undo and lie about the source).
  const appliedKeys = useRef<Set<string>>(new Set())

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

  const clearPreview = () => {
    const node = selected?.node
    if (node) for (const k of appliedKeys.current) node.style.removeProperty(camelToKebab(k))
    appliedKeys.current.clear()
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

  // Native-feeling undo/redo on the SAME shared history stack chat writes to —
  // file-only (no chat-panel side effects), so Cmd/Ctrl+Z works in canvas too.
  useEffect(() => {
    const step = async (dir: 'undo' | 'redo') => {
      const s = museStore.getState()
      const entry = dir === 'undo' ? s.past[s.past.length - 1] : s.future[0]
      if (!entry) return
      const side = dir === 'undo' ? 'before' : 'after'
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
    for (const m of mutations) {
      for (const key of PROPERTIES[m.property].css) {
        node.style.setProperty(camelToKebab(key), m.value)
        appliedKeys.current.add(key)
      }
    }
  }

  async function commit(mutations: StyleMutation[]) {
    if (!selected) return
    applyPreview(mutations) // make sure the final value is showing
    const label = mutations.map((m) => `${m.property} ${m.value}`).join(', ').slice(0, 80)
    try {
      const { edits, originals, warnings } = await museStyleEdit([
        { fileName: selected.fileName, line: selected.line, column: selected.column, mutations },
      ])
      if (warnings.length) console.warn('[muse] style-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        setError(warnings[0] ?? "Couldn't apply that change.")
        return
      }
      const entry: HistoryEntry = {
        files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName] ?? '', after: e.newContent })),
        elements: [asSelected(selected)],
        label,
      }
      await museWrite(edits)
      museStore.setState((cur) => ({ past: [...cur.past, entry], future: [], applied: true }))
      // Let HMR repaint from the new source, then drop the inline overrides and
      // re-read so the panel/overlay reflect source truth (and undo stays honest).
      window.setTimeout(() => {
        clearPreview()
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

      {selected && values && (
        <>
          <BoxModelOverlay node={selected.node} padding={values.padding} />
          {panelPos && (
            <div className="pointer-events-auto absolute" style={{ top: panelPos.top, left: panelPos.left }}>
              {/* Key by element so the per-side expand state re-derives from the
                  new element's values instead of carrying over the last one's. */}
              <PropertiesPanel key={selected.key} tag={selected.tag} values={values} onPreview={applyPreview} onCommit={commit} />
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
            {selected ? '· drag a value to scrub · Esc to deselect' : '· click an element to edit · Esc to exit'}
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
