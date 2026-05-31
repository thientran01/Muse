import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { museStyleEdit, museTextEdit, museWrite } from '../../api'
import { museStore } from '../../store'
import { PROPERTIES } from '../../style/properties'
import type { CanvasElement, HistoryEntry, SelectedElement, StyleMutation } from '../../types'
import { getSourceLocation } from '../../sourceLocation'
import { isVarColorToken } from '../../style/tailwindScales'
import { canvasChain, useCanvasMode } from '../../useCanvasMode'
import { HoverHighlight } from '../SelectionOverlay'
import { BoxModelOverlay } from './BoxModelOverlay'
import { GapOverlay } from './GapOverlay'
import { PropertiesPanel, type CanvasValues, type Sides } from './PropertiesPanel'
import { ResizeHandles } from './ResizeHandles'

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
  const classTokens = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  return {
    padding: sidesOf(cs, 'padding'),
    margin: sidesOf(cs, 'margin'),
    gap: isFlexGrid ? { row: px(cs.rowGap), column: px(cs.columnGap) } : null,
    size: { width: Math.round(px(cs.width)), height: Math.round(px(cs.height)) },
    type: {
      fontSize: Math.round(px(cs.fontSize) * 10) / 10,
      fontWeight: Number(cs.fontWeight) || 400,
      lineHeight: cs.lineHeight === 'normal' ? 0 : Math.round(px(cs.lineHeight)),
      letterSpacing: cs.letterSpacing === 'normal' ? 0 : Math.round(px(cs.letterSpacing) * 100) / 100,
    },
    // Direct text content (not just descendants) → this element styles visible text.
    rendersText: [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0),
    color: { text: rgbToHex(cs.color), background: rgbToHex(cs.backgroundColor), border: rgbToHex(cs.borderColor) },
    // A var-themed channel reads its color from a CSS variable in the source class
    // (e.g. text-[color:var(--c-on-bg)]) — Muse leaves those alone, so mark read-only.
    colorThemed: {
      text: classTokens.some((t) => isVarColorToken('text', t)),
      background: classTokens.some((t) => isVarColorToken('bg', t)),
      border: classTokens.some((t) => isVarColorToken('border', t)),
    },
  }
}

// The element's OWN direct text (not descendants') — what computeTextEdit actually
// rewrites (its single JSXText child). Reading full textContent would fold in a
// child element's text and send the wrong string to the engine.
function directText(node: HTMLElement): string {
  return [...node.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
}

// rgb()/rgba() → #rrggbb for the color picker's current value (alpha dropped).
function rgbToHex(c: string): string {
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return '#000000'
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

// Every live DOM node that renders from the SAME source location as `el` — i.e.
// the same JSX element instantiated N times (a component in a list). A source edit
// changes all of them on commit, so the live preview should too, or the siblings
// visibly lag behind the one being scrubbed.
function peerNodes(el: CanvasElement): HTMLElement[] {
  const peers: HTMLElement[] = [el.node]
  document.querySelectorAll<HTMLElement>('*').forEach((n) => {
    if (n === el.node) return
    const loc = getSourceLocation(n)
    if (loc && loc.fileName === el.fileName && loc.lineNumber === el.line && loc.columnNumber === el.column) {
      peers.push(n)
    }
  })
  return peers
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
  const { active, setActive, hoverRect, hoverInfo, cursor, selected, selectElement, editing, exitEditing, miss } = useCanvasMode()
  const [revision, bump] = useState(0)
  const [values, setValues] = useState<CanvasValues | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null)
  // The live inline preview: the anchor node (used to detect a target change), all
  // peer nodes we've overridden (same-source instances), and which CSS keys. Held
  // as one object so a commit can SNAPSHOT the exact nodes + keys to strip after
  // HMR — even if the selection moves on first. A stale override left on a node
  // would survive an undo and lie about the source.
  const previewRef = useRef<{ anchor: HTMLElement; nodes: HTMLElement[]; keys: Set<string> } | null>(null)
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

  // Remove a specific set of inline overrides from specific nodes.
  const stripInline = (nodes: HTMLElement[], keys: Iterable<string>) => {
    const cssKeys = [...keys].map(camelToKebab)
    for (const node of nodes) for (const k of cssKeys) node.style.removeProperty(k)
  }
  // Clear the CURRENTLY-live preview (whatever nodes it's on), no-op if none.
  const clearPreview = () => {
    const p = previewRef.current
    if (!p) return
    stripInline(p.nodes, p.keys)
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
    if (!selected) return
    // Start (or continue) a preview entry for THIS target. A different target means
    // a fresh entry (the prior one's overrides are cleared by the selection-change
    // effect). Resolve the same-source peers once per entry — not per frame — so a
    // list of N instances all preview together, matching what the commit will do.
    let p = previewRef.current
    if (!p || p.anchor !== selected.node) {
      p = { anchor: selected.node, nodes: peerNodes(selected), keys: new Set() }
      previewRef.current = p
    }
    for (const m of mutations) {
      for (const key of PROPERTIES[m.property].css) {
        const cssKey = camelToKebab(key)
        for (const node of p.nodes) node.style.setProperty(cssKey, m.value)
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
      // stays honest). Snapshot the nodes+keys so a selection change in the
      // meantime can't redirect the strip to the wrong nodes; detach the live ref
      // so a fresh scrub starts clean. Cancel any prior pending strip.
      const snap = previewRef.current
      previewRef.current = null
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = window.setTimeout(() => {
        if (snap) stripInline(snap.nodes, snap.keys)
        bump((v) => v + 1)
      }, 160)
    } catch (e) {
      clearPreview()
      setError((e as Error).message)
    }
  }

  // Write a committed text change to source (same deterministic write + history as
  // styles). The DOM already shows the typed text (contentEditable), so there's no
  // inline-preview strip — HMR repaints the same text. Restores the original on a
  // refusal (dynamic text) or error.
  async function commitText(el: CanvasElement, node: HTMLElement, original: string) {
    const restore = () => {
      if (node.isConnected) node.textContent = original
    }
    const raw = directText(node).replace(/\s+/g, ' ').trim()
    if (raw === original.replace(/\s+/g, ' ').trim()) {
      exitEditing()
      return
    }
    try {
      const { edits, originals, warnings } = await museTextEdit([
        { fileName: el.fileName, line: el.line, column: el.column, tag: el.tag, classNames: node.getAttribute('class') ?? '', text: raw },
      ])
      if (warnings.length) console.warn('[muse] text-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        restore() // refusal (e.g. dynamic text) — put it back
        setError(warnings[0] ?? "Couldn't edit this text.")
        exitEditing()
        return
      }
      await museWrite(edits)
      // Keep sibling instances in sync so they don't lag the HMR repaint.
      for (const peer of peerNodes(el)) if (peer !== node) peer.textContent = raw
      const haveAllOriginals = edits.every((e) => typeof originals[e.fileName] === 'string')
      if (haveAllOriginals) {
        const entry: HistoryEntry = {
          files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName], after: e.newContent })),
          elements: [asSelected(el)],
          label: `text "${raw.slice(0, 40)}"`,
        }
        museStore.setState((cur) => ({ past: [...cur.past, entry], future: [], applied: true }))
      }
      exitEditing()
    } catch (e) {
      restore()
      setError((e as Error).message)
      exitEditing()
    }
  }

  // Enter contentEditable when `editing` is set (double-click). Gate on the node
  // actually rendering direct text. Enter / blur commit; Escape restores + exits.
  useEffect(() => {
    if (!editing) return
    const node = editing.node
    const rendersText = [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0)
    if (!node.isConnected || !rendersText) {
      exitEditing()
      return
    }
    const original = directText(node)
    node.contentEditable = 'plaintext-only'
    // Outline ON the node so it tracks the element as text grows / the page scrolls
    // (a separate overlay div would drift). Inline, never written to source.
    const prevOutline = node.style.outline
    const prevOffset = node.style.outlineOffset
    node.style.outline = '2px solid rgb(var(--muse-accent))'
    node.style.outlineOffset = '2px'
    node.focus()
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    let cancel = false
    let done = false
    const teardown = () => {
      node.removeEventListener('keydown', onKeyDown)
      node.removeEventListener('blur', onBlur)
      node.removeEventListener('paste', onPaste)
      if (node.isConnected) {
        if (node.isContentEditable) node.contentEditable = 'false'
        node.style.outline = prevOutline
        node.style.outlineOffset = prevOffset
      }
    }
    const finish = () => {
      if (done) return
      done = true
      teardown()
      if (cancel) {
        if (node.isConnected) node.textContent = original
        exitEditing()
      } else {
        void commitText(editing, node, original)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault() // single line — Enter commits
        finish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel = true
        finish()
      }
    }
    const onBlur = () => finish() // click-away also commits
    // Force plaintext on paste (Firefox treats plaintext-only as rich-text).
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ')
      document.execCommand('insertText', false, text)
    }
    node.addEventListener('keydown', onKeyDown)
    node.addEventListener('blur', onBlur)
    node.addEventListener('paste', onPaste)
    return () => {
      if (!done) teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

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

      {/* While editing text, the style overlays step aside (the outline lives on
          the node itself) so the caret is free. */}
      {selected && values && !editing && (
        <>
          <BoxModelOverlay
            node={selected.node}
            padding={values.padding}
            margin={values.margin}
            onPreview={applyPreview}
            onCommit={commit}
          />
          {values.gap && <GapOverlay node={selected.node} onPreview={applyPreview} onCommit={commit} />}
          <ResizeHandles node={selected.node} onPreview={applyPreview} onCommit={commit} />
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
            {editing
              ? '· editing text · Enter to save · Esc to cancel'
              : selected
                ? '· double-click to edit text · Alt-click selects the container · Esc to deselect'
                : '· click an element · Alt-click for its container · Esc to exit'}
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
