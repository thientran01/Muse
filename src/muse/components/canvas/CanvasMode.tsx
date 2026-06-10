import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Flag } from '@phosphor-icons/react'
import { museReorder, museReorderable, museStyleEdit, museStyleScope, museTextEdit, museTextEditable, museWrite } from '../../api'
import { EPHEMERAL } from '../../config'
import { useHostTheme } from '../../hooks/useHostTheme'
import { museStore } from '../../store'
import { PROPERTIES } from '../../style/properties'
import type { CanvasElement, FlagDraft, HistoryEntry, ReorderChild, Reorderable, SharedConst, StyleMutation } from '../../types'
import { FlagComposer } from '../FlagComposer'
import { getSourceLocation } from '../../sourceLocation'
import { isVarColorToken } from '../../style/tailwindScales'
import { asSelected, canvasChain, useCanvasMode } from '../../useCanvasMode'
import { HoverHighlight } from '../SelectionOverlay'
import { BoxModelOverlay } from './BoxModelOverlay'
import { GapOverlay } from './GapOverlay'
import { PropertiesPanel, type CanvasValues, type Sides } from './PropertiesPanel'
import { ReorderOverlay, resolveMembers, SETTLE_CAP_MS } from './ReorderOverlay'
import { ResizeHandles } from './ResizeHandles'

const PANEL_W = 232 // keep in sync with PanelShell's w-[232px] (PropertiesPanel)
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
    color: { text: rgbToHex(cs.color), background: effectiveBgHex(node), border: rgbToHex(cs.borderColor) },
    // A var-themed channel reads its color from a CSS variable in the source class
    // (e.g. text-[color:var(--c-on-bg)]) — Muse leaves those alone, so mark read-only.
    colorThemed: {
      text: classTokens.some((t) => isVarColorToken('text', t)),
      background: classTokens.some((t) => isVarColorToken('bg', t)),
      border: classTokens.some((t) => isVarColorToken('border', t)),
    },
    appearance: {
      radius: {
        // Computed radii can be elliptical pairs ("8px 16px") — px() reads the
        // leading length, which is the value the scrub round-trips.
        topLeft: Math.round(px(cs.borderTopLeftRadius)),
        topRight: Math.round(px(cs.borderTopRightRadius)),
        bottomRight: Math.round(px(cs.borderBottomRightRadius)),
        bottomLeft: Math.round(px(cs.borderBottomLeftRadius)),
      },
      borderWidth: Math.round(px(cs.borderTopWidth) * 10) / 10,
      borderStyleNone: cs.borderTopStyle === 'none',
      opacity: Math.round(parseFloat(cs.opacity || '1') * 100),
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

// Build a flag work-order from a Canvas element + optional refusal context. Captures
// the live className + a text snippet so the agent gets file:line:col + tag + class +
// text + intent — the precision edge over a bare component-name annotation. `extra`
// seeds the intent (and property/reason) when the flag is born from a Canvas refusal.
function draftFromElement(
  el: CanvasElement,
  extra?: { property?: string; reason?: string; comment?: string },
): FlagDraft {
  return {
    fileName: el.fileName,
    line: el.line,
    column: el.column,
    tag: el.tag,
    className: el.node.getAttribute('class') ?? '',
    text: (el.node.textContent ?? '').trim().slice(0, 80),
    comment: extra?.comment ?? '',
    property: extra?.property,
    reason: extra?.reason,
  }
}

// Parse an rgb()/rgba() string into channels + alpha (alpha defaults to 1).
function parseRgba(c: string): { r: number; g: number; b: number; a: number } | null {
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/)
  if (!m) return null
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

// rgb()/rgba() → #rrggbb for the color picker's current value (alpha dropped).
function rgbToHex(c: string): string {
  const p = parseRgba(c)
  if (!p) return '#000000'
  return '#' + hex2(p.r) + hex2(p.g) + hex2(p.b)
}

// The EFFECTIVE background a designer actually sees: the element's own background
// composited over whatever shows through it. Dropping the alpha makes a transparent
// or low-opacity fill (e.g. a `hover:bg-white/5` nav item over a dark page) read as
// a misleading solid #ffffff / #000000. Walk ancestors collecting background layers
// until an opaque one, then composite them bottom-up so the result is what's on
// screen at that spot.
function effectiveBgHex(node: HTMLElement): string {
  const layers: Array<{ r: number; g: number; b: number; a: number }> = []
  let el: HTMLElement | null = node
  while (el) {
    const c = parseRgba(getComputedStyle(el).backgroundColor)
    if (c && c.a > 0) {
      layers.push(c)
      if (c.a >= 1) break // opaque backdrop — nothing below it shows through
    }
    el = el.parentElement
  }
  const bottom = layers[layers.length - 1]
  let base = bottom && bottom.a >= 1 ? { r: bottom.r, g: bottom.g, b: bottom.b } : { r: 255, g: 255, b: 255 }
  // Composite each layer above the base, from just-above-base up to the element.
  for (let i = (bottom && bottom.a >= 1 ? layers.length - 2 : layers.length - 1); i >= 0; i--) {
    const { r, g, b, a } = layers[i]
    base = { r: r * a + base.r * (1 - a), g: g * a + base.g * (1 - a), b: b * a + base.b * (1 - a) }
  }
  return '#' + hex2(base.r) + hex2(base.g) + hex2(base.b)
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

// Which margin properties on `node` are actually controlled by a PARENT's Tailwind
// `space-y-*` / `space-x-*` utility, and so can't be changed by a child margin
// class (the `& > * + *` selector outspecifies `mt-*`/`ml-*`). Returns the set of
// blocked StyleProperty names. space-y owns the BLOCK-START margin of every child
// after the first (margin-top in normal flow) → blocks marginTop/marginY; space-x
// owns margin-left → blocks marginLeft/marginX. The `margin` shorthand touches the
// controlled side too, so it's blocked by either. The first child is unaffected
// (the `+ *` selector skips it), so we only block non-first children.
function spaceControlledMargins(node: HTMLElement, mutations: StyleMutation[]): Set<string> {
  const blocked = new Set<string>()
  const parent = node.parentElement
  if (!parent) return blocked
  const pcls = (parent.getAttribute('class') ?? '').split(/\s+/)
  const hasSpaceY = pcls.some((c) => /^-?space-y-/.test(c))
  const hasSpaceX = pcls.some((c) => /^-?space-x-/.test(c))
  if (!hasSpaceY && !hasSpaceX) return blocked
  // Only children after the first visible one get the space margin (the `+ *`).
  const kids = [...parent.children].filter((c) => c instanceof HTMLElement && c.getClientRects().length > 0)
  if (kids.indexOf(node) <= 0) return blocked
  const yProps = new Set(['marginTop', 'marginBottom', 'marginY', 'margin'])
  const xProps = new Set(['marginLeft', 'marginRight', 'marginX', 'margin'])
  for (const m of mutations) {
    if (hasSpaceY && yProps.has(m.property)) blocked.add(m.property)
    if (hasSpaceX && xProps.has(m.property)) blocked.add(m.property)
  }
  return blocked
}

// Whether `el`'s visual position is PINNED by explicit CSS placement — grid line/area
// placement, flex/grid `order`, or out-of-flow positioning. A source reorder shuffles
// DOM/source order but WON'T move a pinned element (its placement re-fixes it), so we
// refuse the drag handle on it rather than silently shuffle source to no visual effect
// (the homepage bento's grid-placed cards).
//
// getComputedStyle is the primary read — it resolves placement from ANY source (class,
// inline style, Tailwind v4 arbitrary props) at the current viewport. Its one blind spot
// is RESPONSIVE placement inactive at the current width (e.g. `lg:col-start-1` viewed on
// mobile), so we supplement with a scan for breakpoint-prefixed placement utilities in the
// class string. Together: viewport-independent. Scoped to THIS element only — a pinned
// sibling (a decorative absolute badge) must never lock its in-flow neighbours.
function isPositionPinned(el: HTMLElement): boolean {
  // getComputedStyle on a DETACHED node (e.g. mid-HMR, between select and probe) returns
  // empty strings, and `'' !== 'auto'` would read as a false-positive "pinned" → wrongly
  // refusing a valid reorder. A disconnected node isn't laid out, so treat it as not pinned.
  if (!el.isConnected) return false
  const cs = getComputedStyle(el)
  if (cs.position === 'absolute' || cs.position === 'fixed') return true
  // Explicit grid line/area placement — auto-flow leaves these 'auto'.
  if (cs.gridColumnStart && cs.gridColumnStart !== 'auto') return true
  if (cs.gridRowStart && cs.gridRowStart !== 'auto') return true
  if (cs.order && cs.order !== '0') return true // flex/grid visual reorder ≠ DOM order
  // Responsive placement that's inactive at the current width — getComputedStyle can't see
  // it, so catch the breakpoint-prefixed Tailwind utilities statically.
  const cls = el.getAttribute('class') ?? ''
  if (/(^|\s)(sm|md|lg|xl|2xl):(col-start-|col-end-|row-start-|row-end-|order-)/.test(cls)) return true
  return false
}

// Resolve when `parent` next mutates (children/content change = the new order painted) or
// after `cap` ms — host-agnostic, so the reorder finalizes on the ACTUAL repaint rather than
// a clock-specific delay. Vite HMR repaints in tens of ms (the write IS the repaint);
// Next/Turbopack's RSC refresh runs on its own slower clock, decoupled from the write, so a
// fixed delay can't serve both. The cap (shared SETTLE_CAP_MS) only bites if no repaint ever
// lands. Observes attribute-free (childList/characterData) so the dragged node's own inline-
// style transforms don't spuriously trip it.
function waitForParentRepaint(parent: HTMLElement | null, cap: number): Promise<void> {
  return new Promise((resolve) => {
    if (!parent || !parent.isConnected) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      obs.disconnect()
      window.clearTimeout(timer)
      resolve()
    }
    const obs = new MutationObserver(finish)
    obs.observe(parent, { childList: true, subtree: true, characterData: true })
    const timer = window.setTimeout(finish, cap)
  })
}

// The direct-manipulation mode. Picks an element, shows a floating spacing
// popover + box-model overlay, scrubs live (inline style), and commits each
// change to source deterministically — landing in the shared undo/redo history.
export function CanvasMode({
  onExit,
}: {
  onExit: () => void
}) {
  // True while a reorder drag is in flight. Declared before useCanvasMode so it can
  // SUSPEND Canvas's hover + selection during the drag — otherwise moving the cursor
  // over another element mid-drag re-hovers/re-selects it, which remounts the overlay
  // on a new node and kills the drag (and leaves the passed-over element wedged).
  const [reordering, setReordering] = useState(false)
  // An open flag composer: the draft being captured + where to float the card. Set by a
  // shift-click (empty draft) or a refusal's "Flag it" button (draft pre-filled).
  const [flagDraft, setFlagDraft] = useState<{ draft: FlagDraft; x: number; y: number } | null>(null)
  const onFlag = useCallback((el: CanvasElement, at: { x: number; y: number }) => {
    setFlagDraft({ draft: draftFromElement(el), x: at.x, y: at.y })
  }, [])
  const { active, setActive, hoverRect, hoverInfo, cursor, selected, selectElement, editing, exitEditing, miss, shiftHeld } =
    useCanvasMode({ suspended: reordering, onFlag })
  const [revision, bump] = useState(0)
  const [values, setValues] = useState<CanvasValues | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Whether the selected element's siblings can be reordered. Gates the drag handle so
  // it only appears when a drop will actually commit. Probed per selection, container-
  // anchor first (the DOM parent), then self-anchor (the clicked element itself) as a
  // fallback — see the probe effect.
  const [reorderable, setReorderable] = useState<Reorderable | null>(null)
  // Set when reorder addresses the host CONTAINER (the DOM parent, stamped at the usage
  // site) instead of the clicked element — its source location + the commit's container
  // flag. This is the PRIMARY path (host children + component instances). Null when the
  // self-anchor fallback won instead.
  const [reorderContainer, setReorderContainer] = useState<{ fileName: string; line: number; column: number; tag: string; classNames: string } | null>(null)
  // Set when the SELF-ANCHOR fallback won (container-anchor refused): the clicked element
  // is content authored inside a component (e.g. a <p> written as <Section>'s child), so
  // we reorder among the located element's own AST siblings. Carries the probe's source
  // child key-list so the overlay can match DOM↔source members (skipping component-injected
  // nodes + out-of-flow phantoms). Null on the container path.
  const [reorderSelfKeys, setReorderSelfKeys] = useState<ReorderChild[] | null>(null)
  // (`reordering` is declared above useCanvasMode so it can suspend hover/selection
  // during a drag; the other overlays + panel also hide while it's true so they don't
  // sit on top of the element being dragged.)
  // When the selected element's style is `style={X}` (a shared same-file const), the
  // probe returns its summary so the panel can offer an "all instances" scope toggle.
  // `scope` is the user's choice for the NEXT commit, reset to per-element on every new
  // selection so a global mode never silently persists across elements (mode-error guard).
  const [styleScope, setStyleScope] = useState<SharedConst | null>(null)
  const [scope, setScope] = useState<'element' | 'const'>('element')
  // A hint over the page: `calm` = a brief auto-dismissing note (the old behavior);
  // `refusal` = a sticky note carrying a flag draft, so a refused edit can become a
  // "Flag it for your agent" hand-off (the de-cloning spine — flags are the overflow
  // valve of direct manipulation).
  const [hint, setHint] = useState<{ x: number; y: number; text: string; kind: 'calm' | 'refusal'; draft?: FlagDraft } | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  // Flash a brief, calm hint at a point (e.g. "this text comes from data").
  const flashHint = (x: number, y: number, text: string, ms = 2200) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    setHint({ x, y, text, kind: 'calm' })
    hintTimerRef.current = window.setTimeout(() => setHint(null), ms)
  }
  // A REFUSAL hint: Canvas can't make this edit, but the user's agent can. Sticky so
  // the "Flag it" button is reachable (a generous fallback timer still clears a
  // forgotten one; selection changes clear it too). Carries the pre-filled flag draft.
  const refuse = (x: number, y: number, text: string, draft: FlagDraft) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    setHint({ x, y, text, kind: 'refusal', draft })
    hintTimerRef.current = window.setTimeout(() => setHint(null), 7000)
  }
  // The live inline preview: the anchor node (used to detect a target change), all
  // peer nodes we've overridden (same-source instances), and which CSS keys. Held
  // as one object so a commit can SNAPSHOT the exact nodes + keys to strip after
  // HMR — even if the selection moves on first. A stale override left on a node
  // would survive an undo and lie about the source.
  // `before` holds each node's inline `cssText` at the moment this preview entry
  // was created — the EPHEMERAL undo baseline (it captures all prior committed
  // inline edits, so undo lands on the state right before THIS scrub). Unused in
  // the normal server path (where undo restores file content).
  const previewRef = useRef<{ anchor: HTMLElement; nodes: HTMLElement[]; keys: Set<string>; before: Map<HTMLElement, string> } | null>(null)
  const clearTimerRef = useRef<number | null>(null)
  const stripObsRef = useRef<MutationObserver | null>(null)
  // Canvas renders its OWN [data-muse-ui] root (separate from the dock's),
  // so it needs its own data-theme or muse.css's dark defaults win on a light host.
  // This ref doubles as the portal target for popovers that must escape the panel's
  // overflow (the color picker).
  const rootRef = useRef<HTMLDivElement>(null)
  useHostTheme(rootRef)

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

  // A refusal hint is anchored to the element the user just acted on — drop it when the
  // selection changes (or clears) so a stale "Flag it" affordance can't linger over a
  // different element. Calm hints keep their own short timer.
  useEffect(() => {
    setHint((h) => (h?.kind === 'refusal' ? null : h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key])

  // Opening the composer (shift-click OR a refusal's "Flag it") supersedes any hint —
  // clear it so a refusal bubble can't linger beside/behind the composer. Covers the
  // shift-click path, which doesn't change `selected` and so skips the effect above.
  useEffect(() => {
    if (!flagDraft) return
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    setHint(null)
  }, [flagDraft])

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

  const cancelStripWatch = () => {
    if (stripObsRef.current) { stripObsRef.current.disconnect(); stripObsRef.current = null }
    if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null }
  }
  // After a source write, keep the inline preview until the host RE-RENDERS the
  // element from the new source, THEN strip it. A fixed 160ms timer stripped too
  // early on slower HMR (Next/Turbopack does an RSC refresh, not instant Vite HMR),
  // so the element snapped back to its old look until a re-select re-read it. Watch
  // for the re-render — the node's class/style mutating in place (Fast Refresh) OR
  // the node being replaced/removed (RSC) — and strip then. The preview value equals
  // the committed value, so it stays visually correct while we wait; a generous
  // fallback strips anyway so it can't linger if no re-render ever fires.
  const stripAfterRerender = (snap: { nodes: HTMLElement[]; keys: Set<string> }) => {
    cancelStripWatch()
    const nodes = snap.nodes
    const finish = () => {
      cancelStripWatch()
      stripInline(snap.nodes, snap.keys)
      bump((v) => v + 1)
    }
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && nodes.includes(r.target as HTMLElement)) return finish()
        if (r.type === 'childList') {
          for (const n of r.removedNodes) if (nodes.includes(n as HTMLElement)) return finish()
        }
      }
    })
    for (const n of nodes) {
      obs.observe(n, { attributes: true, attributeFilter: ['class', 'style'] })
      if (n.parentNode) obs.observe(n.parentNode, { childList: true })
    }
    stripObsRef.current = obs
    clearTimerRef.current = window.setTimeout(finish, 5000)
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
      // Clamp the top so the WHOLE panel stays on-screen. Use its real measured
      // height (capped at min(70vh,520px) + scrolls, but a short panel is much
      // smaller) so a low element doesn't push the panel off the bottom. Falls back
      // to the max cap before the first measure. Prefer the element's top; only lift
      // it up when it would overflow, never above GAP.
      const measured = panelRef.current?.offsetHeight
      const panelH = measured ?? Math.min(window.innerHeight * 0.7, 520)
      const top = Math.max(GAP, Math.min(r.top, window.innerHeight - panelH - GAP))
      // Sit beside the element — to its RIGHT by default, flipped to its LEFT when
      // the right won't fit OR would cover the bottom-right dock (the FAB/toolbar,
      // which marks itself with data-muse-dock). Two guards keep the flip from misfiring:
      //   - CLAMP each dock rect to the viewport so only its visible footprint counts.
      //   - Skip avoidance until the panel's real height is measured: the first pass
      //     uses the tall fallback cap, which would over-report vertical overlap and
      //     flip for one frame before the rAF re-measure corrects it.
      const vw = window.innerWidth
      const vh = window.innerHeight
      const rightX = r.right + GAP
      const leftX = Math.max(GAP, r.left - GAP - PANEL_W)
      const docks =
        measured == null
          ? []
          : // The dock lives in Muse's shadow root now, so query the same root the
            // canvas chrome is in (getRootNode → the ShadowRoot), not the document.
            [...((rootRef.current?.getRootNode() as ShadowRoot | Document | null) ?? document).querySelectorAll('[data-muse-dock]')].map((d) => {
              const b = d.getBoundingClientRect()
              return { left: Math.max(0, b.left), right: Math.min(vw, b.right), top: Math.max(0, b.top), bottom: Math.min(vh, b.bottom) }
            })
      const hitsDock = (x: number) =>
        docks.some((d) => d.right > d.left && x < d.right && x + PANEL_W > d.left && top < d.bottom && top + panelH > d.top)
      const fitsRight = rightX + PANEL_W <= vw
      let left = rightX
      if (!fitsRight || hitsDock(rightX)) {
        left = leftX >= GAP && !hitsDock(leftX) ? leftX : fitsRight ? rightX : leftX
      }
      setPanelPos({ top, left })
    }
    place()
    // Re-place after paint: on the first selection the panel isn't mounted yet when
    // place() first runs, so panelRef is null and the clamp uses the max-cap height.
    // A rAF re-run measures the real (often much shorter) panel and re-clamps, and
    // lets the ResizeObserver attach to the now-mounted node.
    const raf = requestAnimationFrame(() => {
      place()
      if (panelRef.current) ro.observe(panelRef.current)
    })
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // Re-place when the panel's own height changes (sections expand/collapse) so the
    // bottom-edge clamp tracks the real height — a tall→short toggle won't leave it
    // lifted, and short→tall near the bottom lifts it just enough to fit.
    const ro = new ResizeObserver(place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      ro.disconnect()
    }
  }, [selected, revision])

  // Clear any stray inline preview when the target changes or we leave.
  useEffect(() => clearPreview, [selected])

  // Probe whether the selected element's siblings can be reordered, so the drag
  // handle only shows when a drop will commit. Cancel-guarded so a fast reselect
  // can't apply a stale verdict to the current target.
  useEffect(() => {
    if (!selected) {
      setReorderable(null)
      setReorderContainer(null)
      setReorderSelfKeys(null)
      return
    }
    setReorderContainer(null)
    setReorderSelfKeys(null)

    // PINNING GATE (selected element only): refuse the handle on an element whose visual
    // position is pinned by explicit CSS placement (grid lines/area, flex/grid order,
    // absolute/fixed) — a source reorder shuffles DOM order but wouldn't move it, so a
    // silent no-effect shuffle is worse than no handle. Never gate on a sibling's pinning.
    if (isPositionPinned(selected.node)) {
      setReorderable({ reorderable: false, reason: 'this element is placed by CSS — reordering the source won’t move it' })
      return
    }

    // EPHEMERAL: there's no server probe — answer from the live DOM. A run is
    // reorderable when the parent has ≥2 visible element children including the
    // selection (DOM order is authoritative; an ephemeral move can't corrupt a
    // file, so this safely fails open where the real probe fails closed).
    if (EPHEMERAL) {
      const parent = selected.node.parentElement
      const kids = parent
        ? ([...parent.children] as Element[]).filter(
            (c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0,
          )
        : []
      setReorderable(
        kids.length >= 2 && kids.includes(selected.node)
          ? {
              reorderable: true,
              count: kids.length,
              children: kids.map((k, i) => ({ index: i, tag: k.tagName.toLowerCase(), classNames: k.getAttribute('class') })),
            }
          : { reorderable: false, reason: 'not a reorderable run' },
      )
      return
    }
    let cancelled = false
    setReorderable(null)
    // Resolve the reorderable group CONTAINER-ANCHOR first (the DOM parent, stamped at the
    // usage site): covers host children + component instances (the marquee) — the proven
    // path, unchanged. If that refuses — e.g. the DOM parent is a component-internal
    // projector whose children are `{children}` — fall back to SELF-ANCHOR on the clicked
    // element itself, which now reorders among its own AST siblings even when the AST parent
    // is a component (content authored inside a <Section>). The self-anchor commit derives
    // fromIndex from source, and the overlay matches DOM↔source members via the key-list.
    const parentEl = selected.node.parentElement
    const contLoc = parentEl ? getSourceLocation(parentEl) : null
    const container =
      contLoc && parentEl
        ? { fileName: contLoc.fileName, line: contLoc.lineNumber, column: contLoc.columnNumber, tag: parentEl.tagName.toLowerCase(), classNames: parentEl.getAttribute('class') ?? '' }
        : null
    const self = { fileName: selected.fileName, line: selected.line, column: selected.column, tag: selected.tag, classNames: selected.node.getAttribute('class') ?? '' }
    void (async () => {
      if (container) {
        const r = await museReorderable({ ...container, container: true })
        if (cancelled) return
        if (r.reorderable) {
          setReorderable(r)
          setReorderContainer(container)
          setReorderSelfKeys(null)
          return
        }
      }
      // Self-anchor fallback — the clicked element's own loc, no container flag.
      const r = await museReorderable(self)
      if (cancelled) return
      setReorderable(r)
      setReorderContainer(null)
      setReorderSelfKeys(r.reorderable ? r.children : null)
    })()
    return () => {
      cancelled = true
    }
  }, [selected])

  // Probe whether the selection's style is a shared const, so the scope toggle shows
  // when a global edit is possible. Reset the scope choice to per-element on every new
  // selection (mode never persists across elements). Cancel-guarded against a fast
  // reselect. EPHEMERAL has no backend write path for a const edit, so never offers it.
  useEffect(() => {
    setScope('element')
    setStyleScope(null)
    if (!selected || EPHEMERAL) return
    let cancelled = false
    void museStyleScope({
      fileName: selected.fileName,
      line: selected.line,
      column: selected.column,
      tag: selected.tag,
      classNames: selected.node.getAttribute('class') ?? '',
    }).then((s) => {
      if (!cancelled) setStyleScope(s)
    })
    return () => {
      cancelled = true
    }
  }, [selected])
  // Keyboard reorder (a11y) — a keyboard-only equivalent of the drag, since the
  // pointer path isn't reachable without a mouse/touch. When a reorderable element
  // is selected, Cmd/Ctrl + arrow moves it one slot: Up/Left = back, Down/Right =
  // forward (accepts both axes so it works in a row OR a column without the user
  // having to know which). Per Emil's rule, a keyboard-initiated action does NOT
  // animate — it commits straight through commitReorder (write → HMR → re-select),
  // the same deterministic path the drag uses. Matches the undo handler's modifier
  // + input-guard convention.
  useEffect(() => {
    if (!selected || !reorderable?.reorderable) return
    const onKey = (e: KeyboardEvent) => {
      if (reordering) return // a pointer drag is mid-flight — don't fire a second concurrent write
      if (!(e.metaKey || e.ctrlKey)) return
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
      if (dir === 0) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const parent = selected.node.parentElement
      if (!parent) return
      // Same movable run the drag uses: matched members for self-anchor (skips the
      // component-injected nodes via the selected element's source file), every visible
      // child otherwise.
      const kids = resolveMembers(parent, reorderSelfKeys, selected.node)
      const from = kids.indexOf(selected.node)
      if (from < 0) return
      // toIndex is an insertion slot in SOURCE order (lands BEFORE the child there).
      // back one = from-1; forward one = from+2 (skip self + the next sibling). Out of
      // range = already at an end → no-op, and DON'T preventDefault so the key passes
      // through normally.
      const toIndex = dir < 0 ? from - 1 : from + 2
      if (toIndex < 0 || toIndex > kids.length) return
      e.preventDefault()
      void commitReorder(selected, toIndex)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, reorderable, reorderSelfKeys, reordering])

  // Cancel a pending post-commit strip on unmount so it can't fire on a gone node.
  useEffect(() => () => cancelStripWatch(), [])

  // Show a brief "can't edit this" hint at the click point on an unmappable click.
  useEffect(() => {
    if (!miss) return
    flashHint(miss.x, miss.y, "Can't edit this one — no source mapping")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miss?.id])

  // Native-feeling undo/redo on the shared history stack — file-only, so
  // Cmd/Ctrl+Z works in canvas alongside the toolbar's undo/redo buttons.
  useEffect(() => {
    const step = async (dir: 'undo' | 'redo') => {
      // EPHEMERAL: undo/redo run on the DOM-snapshot stack, not file content.
      if (EPHEMERAL) {
        clearPreview()
        if (dir === 'undo' ? museStore.ephemeralUndo() : museStore.ephemeralRedo()) bump((v) => v + 1)
        return
      }
      const s = museStore.getState()
      const entry = dir === 'undo' ? s.past[s.past.length - 1] : s.future[0]
      if (!entry) return
      const side = dir === 'undo' ? 'before' : 'after'
      clearPreview() // drop any live scrub override so it can't mask the restore
      try {
        await museWrite(entry.files.map((f) => ({ fileName: f.fileName, newContent: f[side] })))
        museStore.setState((st) =>
          dir === 'undo'
            ? { past: st.past.slice(0, -1), future: [entry, ...st.future] }
            : { future: st.future.slice(1), past: [...st.past, entry] },
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
      const nodes = peerNodes(selected)
      // Snapshot each node's current inline style as the EPHEMERAL undo baseline.
      const before = new Map(nodes.map((n) => [n, n.style.cssText]))
      p = { anchor: selected.node, nodes, keys: new Set(), before }
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

    // Guard: a margin governed by a parent's Tailwind `space-y-*`/`space-x-*` can't
    // be changed from the child — that utility's `& > * + *` selector outspecifies a
    // child `mt-*`/`ml-*`, so the engine would write a class that has no visible
    // effect (looks like "margin won't save"). Detect it from the live DOM (the
    // engine only sees the file) and refuse with a calm hint pointing at the real
    // lever, mirroring how var-themed colors are skipped. Only blocks the AXIS the
    // space utility controls; the other axis + padding still flow through.
    const spaceBlocked = spaceControlledMargins(selected.node, mutations)
    if (spaceBlocked.size === mutations.length) {
      const r = selected.node.getBoundingClientRect()
      const props = [...spaceBlocked].join(', ')
      refuse(
        r.left,
        r.top,
        'Spacing here is set by the parent’s space-y/x — adjust it on the parent',
        draftFromElement(selected, {
          property: props,
          reason: 'spacing is controlled by the parent’s space-y/x utility',
          comment: `Adjust the ${props} spacing on this ${selected.tag} — it’s set by the parent’s space-y/x, so it can’t change from here.`,
        }),
      )
      clearPreview()
      return
    }
    if (spaceBlocked.size > 0) mutations = mutations.filter((m) => !spaceBlocked.has(m.property))

    applyPreview(mutations) // make sure the final value is showing
    const label = mutations.map((m) => `${m.property} ${m.value}`).join(', ').slice(0, 80)

    // EPHEMERAL: the inline preview IS the committed state. Record a DOM-snapshot
    // undo entry (before/after cssText, captured per peer node), keep the inline
    // style on the nodes, and skip the server + disk write entirely.
    if (EPHEMERAL) {
      const p = previewRef.current
      if (p) {
        const nodes = p.nodes
        const before = p.before
        const after = new Map(nodes.map((n) => [n, n.style.cssText]))
        // Skip a no-op commit (e.g. a re-fire on the same value) so it doesn't add
        // an undo step that visibly does nothing.
        const changed = nodes.some((n) => (before.get(n) ?? '') !== (after.get(n) ?? ''))
        if (changed) {
          const apply = (snap: Map<HTMLElement, string>) => {
            for (const n of nodes) if (n.isConnected) n.style.cssText = snap.get(n) ?? ''
          }
          museStore.pushEphemeral({ label, undo: () => apply(before), redo: () => apply(after) })
        }
      }
      previewRef.current = null // keep the inline style ON the nodes; stop tracking it
      bump((v) => v + 1) // re-read the panel from the new (inline) state
      return
    }

    try {
      const { edits, originals, warnings } = await museStyleEdit([
        {
          fileName: selected.fileName,
          line: selected.line,
          column: selected.column,
          tag: selected.tag,
          classNames: selected.node.getAttribute('class') ?? '',
          mutations,
          scope,
        },
      ])
      // (The shared-const toggle is driven solely by the on-select probe — not the commit
      // response — so a slow commit can't clobber a newer selection's scope state.)
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
        museStore.setState((cur) => ({ past: [...cur.past, entry], future: [] }))
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
      if (snap) stripAfterRerender(snap)
      else bump((v) => v + 1)
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

    // EPHEMERAL: the node already shows the typed text (contentEditable). Sync the
    // same-source peers and record a text-snapshot undo entry; no server, no write.
    if (EPHEMERAL) {
      const peers = peerNodes(el).filter((p) => p !== node)
      for (const peer of peers) peer.textContent = raw
      const all = [node, ...peers]
      const set = (text: string) => {
        for (const n of all) if (n.isConnected) n.textContent = text
      }
      museStore.pushEphemeral({ label: `text "${raw.slice(0, 40)}"`, undo: () => set(original), redo: () => set(raw) })
      exitEditing()
      return
    }

    try {
      const { edits, originals, warnings } = await museTextEdit([
        { fileName: el.fileName, line: el.line, column: el.column, tag: el.tag, classNames: node.getAttribute('class') ?? '', text: raw, renderedText: original },
      ])
      if (warnings.length) console.warn('[muse] text-edit:', warnings.join(' · '))
      if (edits.length === 0) {
        restore() // refusal (e.g. dynamic text) — put it back, calm hint (no red error)
        const r = node.getBoundingClientRect()
        const msg = (warnings[0] ?? "this text can't be edited here").replace(/^[^:]*:\s*/, '')
        refuse(r.left, r.top, msg, draftFromElement(el, {
          property: 'text',
          reason: msg,
          comment: `Change this text to: “${raw}”`,
        }))
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
        museStore.setState((cur) => ({ past: [...cur.past, entry], future: [] }))
      }
      exitEditing()
    } catch (e) {
      restore()
      setError((e as Error).message)
      exitEditing()
    }
  }

  // Move the selected element to source slot `toIndex` among its siblings, then
  // write + record history on the SAME shared stack as styles/text. A reorder
  // changes structure, so after HMR repaints we re-select the element at its new
  // index (best-effort) to keep the panel anchored to what the user just moved.
  async function commitReorder(el: CanvasElement, toIndex: number) {
    const parent = el.node.parentElement
    // Capture the self-anchor key-list NOW: the post-HMR re-select reads it ~200ms later
    // inside a setTimeout, by which point the live `reorderSelfKeys` could belong to a
    // different selection — which would build the wrong member run and re-select the wrong
    // node. Pin it to this commit (same reason `frozen`/`prevStyle` are captured up front).
    const selfKeys = reorderSelfKeys
    // The dragged element's index among its movable siblings (the matched member run for
    // self-anchor, every visible child otherwise) — used to land selection back on it
    // post-HMR. EPHEMERAL has no self keys, so this is the raw visible-child list there.
    const siblings = parent ? resolveMembers(parent, selfKeys, el.node) : []
    const fromIndex = siblings.indexOf(el.node)
    const newIndex = fromIndex !== -1 && toIndex > fromIndex ? toIndex - 1 : toIndex

    // EPHEMERAL: physically move the DOM node among its siblings (DOM order ===
    // source order under the host-only gate), record an order-snapshot undo, and
    // re-select the same (still-live) node — no server, no write, no HMR to await.
    if (EPHEMERAL) {
      if (!parent) return
      const beforeOrder = [...parent.children] as HTMLElement[]
      const target = siblings[toIndex] ?? null // element at the source slot, or null = append
      if (target === el.node) return // dropping onto self — no move
      parent.insertBefore(el.node, target)
      const afterOrder = [...parent.children] as HTMLElement[]
      if (afterOrder.every((n, i) => n === beforeOrder[i])) return // no visible change
      const restore = (order: HTMLElement[]) => {
        if (!parent.isConnected) return
        // Only re-order children that are STILL in this parent — never resurrect a
        // node that was detached, nor steal one that moved elsewhere, since the
        // snapshot is an array of element references captured at commit time.
        for (const c of order) if (c.parentElement === parent) parent.appendChild(c)
      }
      museStore.pushEphemeral({ label: `reorder ${el.tag}`, undo: () => restore(beforeOrder), redo: () => restore(afterOrder) })
      const c = canvasChain(el.node)[0]
      if (c) selectElement(c)
      bump((v) => v + 1)
      // Settle two frames so ReorderOverlay's eased set-down finds the chrome
      // re-anchored at the new position (mirrors the server path's resolve timing).
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      return
    }

    try {
      // Container mode (component child): address the host CONTAINER + pass the dragged
      // child's DOM index as fromIndex. Child mode: address the host element itself.
      const req = reorderContainer
        ? { ...reorderContainer, toIndex, fromIndex }
        : { fileName: el.fileName, line: el.line, column: el.column, tag: el.tag, classNames: el.node.getAttribute('class') ?? '', toIndex }
      const { edits, originals, warnings } = await museReorder(req)
      if (warnings.length) console.warn('[muse] reorder:', warnings.join(' · '))
      if (edits.length === 0) {
        const r = el.node.getBoundingClientRect()
        const msg = (warnings[0] ?? "couldn't reorder these").replace(/^[^:]*:\s*/, '')
        refuse(r.left, r.top, msg, draftFromElement(el, {
          property: 'order',
          reason: msg,
          comment: `Reorder this ${el.tag} — Canvas can’t move it from here.`,
        }))
        return // ReorderOverlay's no-op/cancel teardown already un-hid the chrome
      }
      // Start listening for the repaint BEFORE the write triggers it — the parent's order
      // changing is the only DOM signal that the new order is on screen, and on Vite the
      // write IS the repaint (it can fire the instant the write lands). Starting first
      // closes the race where a fast HMR mutation beats the observer.
      const repainted = waitForParentRepaint(parent, SETTLE_CAP_MS)
      await museWrite(edits)
      const haveAllOriginals = edits.every((e) => typeof originals[e.fileName] === 'string')
      if (haveAllOriginals) {
        const entry: HistoryEntry = {
          files: edits.map((e) => ({ fileName: e.fileName, before: originals[e.fileName], after: e.newContent })),
          elements: [asSelected(el)],
          label: `reorder ${el.tag}`,
        }
        museStore.setState((cur) => ({ past: [...cur.past, entry], future: [] }))
      } else {
        console.warn('[muse] reorder: missing originals, skipping undo entry')
      }
      // Hold the overlay's eased set-down + hidden chrome until the parent ACTUALLY shows the
      // new order (the repaint mutation), then re-select the moved element — now correctly
      // painted — and resolve, so the overlay un-hides re-anchored at the new location with no
      // flash at the old slot. Gating on the real repaint (not a fixed delay) keeps Vite
      // instant AND survives Next/Turbopack's slower, write-decoupled RSC refresh. Best-effort
      // re-select: never throw on a stale/detached parent (e.g. RSC replaced the subtree).
      await repainted
      const kids = parent?.isConnected ? resolveMembers(parent, selfKeys, el.node) : []
      const moved = kids[newIndex]
      if (moved instanceof HTMLElement) {
        const c = canvasChain(moved)[0]
        if (c) selectElement(c)
      }
      bump((v) => v + 1)
      // Two rAFs so the re-select's useLayoutEffect re-anchors the panel before we resolve.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    } catch (e) {
      setError((e as Error).message)
      setReordering(false) // an error path won't reach the overlay's finalize — un-hide here
    }
  }

  // Enter contentEditable when `editing` is set (double-click). First probe the
  // server: only static text (a single JSXText) is editable, so data-bound text
  // gets a calm hint instead of a caret you'd type into then have bounced.
  useEffect(() => {
    if (!editing) return
    const el = editing
    const node = el.node
    const rendersText = [...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0)
    if (!node.isConnected || !rendersText) {
      exitEditing()
      return
    }
    // EPHEMERAL: the server probe (which only allows a single static JSXText) is
    // bypassed, so guard the structural risk here — editing a node that also has
    // ELEMENT children would let contentEditable + peer textContent-sync destroy
    // them, and undo (which restores text only) couldn't bring them back. Refuse
    // with the same calm hint the probe would give.
    if (EPHEMERAL && [...node.childNodes].some((n) => n.nodeType === Node.ELEMENT_NODE)) {
      const r = node.getBoundingClientRect()
      refuse(r.left, r.top, "This text can't be edited here", draftFromElement(el, {
        property: 'text',
        reason: 'this element mixes text with child elements',
        comment: 'Edit this text — Canvas can’t edit it in place.',
      }))
      exitEditing()
      return
    }

    let cancelled = false
    let teardown: (() => void) | null = null

    void (async () => {
      const { editable, reason } = await museTextEditable({
        fileName: el.fileName,
        line: el.line,
        column: el.column,
        tag: el.tag,
        classNames: node.getAttribute('class') ?? '',
        renderedText: directText(node), // current rendered text — lets the server resolve a prop-text trace
      })
      if (cancelled) return
      if (!editable || !node.isConnected) {
        const r = node.getBoundingClientRect()
        const msg = reason ?? "This text can't be edited here"
        refuse(r.left, r.top, msg, draftFromElement(el, {
          property: 'text',
          reason: msg,
          comment: 'Edit this text — Canvas can’t edit it here.',
        }))
        exitEditing()
        return
      }

      const original = directText(node)
      node.contentEditable = 'plaintext-only'
      // Outline ON the node so it tracks the element as text grows / the page
      // scrolls (a separate overlay div would drift). Inline, never written to source.
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
      const teardownFn = () => {
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
        teardownFn()
        if (cancel) {
          if (node.isConnected) node.textContent = original
          exitEditing()
        } else {
          void commitText(el, node, original)
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
      teardown = () => {
        if (!done) teardownFn()
      }
    })()

    return () => {
      cancelled = true
      if (teardown) teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  return (
    <div ref={rootRef} data-muse-ui className="pointer-events-none fixed inset-0 z-[999998] font-sans">
      {/* Hover affordance while no edit is in flight — lets you retarget. While Shift is
          held the flag chip replaces the element tooltip (don't stack both over the target). */}
      {hoverRect && <HoverHighlight rect={hoverRect} cursor={cursor} info={shiftHeld ? null : hoverInfo} />}

      {/* Shift-held discoverability cue: tells the user the hover target will be flagged
          (the gesture is otherwise invisible). Follows the cursor like the hover tooltip. */}
      {shiftHeld && cursor && hoverRect && !editing && !flagDraft && (
        <div
          className="pointer-events-none absolute z-30 flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white shadow-lg ring-1 ring-fg/10 animate-muse-fade motion-reduce:animate-none"
          style={{ top: cursor.y + 16, left: cursor.x + 16 }}
        >
          <Flag size={12} weight="fill" /> Flag for your agent
        </div>
      )}

      {/* Quiet hint — unmappable click, or text that isn't statically editable.
          z-20 keeps it above the properties panel (same overlay container). */}
      {hint && (
        <div
          className={`absolute z-20 max-w-[240px] rounded-md bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg-muted shadow-lg ring-1 ring-line/10 backdrop-blur animate-muse-step motion-reduce:animate-none ${hint.kind === 'refusal' ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={{ top: hint.y + 14, left: hint.x + 14 }}
        >
          <div>{hint.text}</div>
          {hint.kind === 'refusal' && hint.draft && (
            <button
              type="button"
              onClick={() => setFlagDraft({ draft: hint.draft!, x: hint.x, y: hint.y })}
              className="mt-1.5 inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/20 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Flag it for your agent
            </button>
          )}
        </div>
      )}

      {/* Flag composer — opened by a shift-click or a refusal's "Flag it" button. */}
      {flagDraft && (
        <FlagComposer
          key={`${flagDraft.draft.fileName}:${flagDraft.draft.line}:${flagDraft.draft.column}:${flagDraft.x},${flagDraft.y}`}
          draft={flagDraft.draft}
          pos={{ x: flagDraft.x, y: flagDraft.y }}
          onClose={() => setFlagDraft(null)}
          onSaved={() => {
            const at = flagDraft
            setFlagDraft(null)
            flashHint(at.x, at.y, 'Flagged', 1100)
          }}
        />
      )}

      {/* While editing text, the style overlays step aside (the outline lives on
          the node itself) so the caret is free. */}
      {selected && values && !editing && (
        <>
          {/* The spacing/size/panel chrome stays MOUNTED while a reorder drag is in
              flight but FADES out (so it doesn't cover the dragged element), then
              fades back in on drop — a transition, not a hard mount/unmount, so it's
              not abrupt. Uses the project's motion tokens (EASE.out / DUR scale,
              Decision #21). pointer-events off while hidden so the fading panel can't
              catch the drag. ReorderOverlay (listeners + bar) stays outside, always
              live. Honors reduced-motion via motion-reduce:transition-none. */}
          <div
            className="transition-opacity ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
            style={{
              opacity: reordering ? 0 : 1,
              transitionDuration: reordering ? '120ms' : '160ms', // out a touch quicker than in
              pointerEvents: reordering ? 'none' : undefined,
            }}
          >
            <BoxModelOverlay
              node={selected.node}
              padding={values.padding}
              margin={values.margin}
              onPreview={applyPreview}
              onCommit={commit}
            />
            {values.gap && <GapOverlay node={selected.node} onPreview={applyPreview} onCommit={commit} />}
            <ResizeHandles node={selected.node} onPreview={applyPreview} onCommit={commit} />
            {/* The properties card reveals on selection, positioned beside the element.
                It mounts on reveal, so animate-muse-step gives it the system's "appears
                on action" entrance. */}
            {panelPos && (
              <div ref={panelRef} className="pointer-events-auto absolute animate-muse-step motion-reduce:animate-none" style={{ top: panelPos.top, left: panelPos.left }}>
                {/* Key by element so the per-side expand state re-derives from the
                    new element's values instead of carrying over the last one's. */}
                <PropertiesPanel
                  key={selected.key}
                  values={values}
                  chain={selected.node.isConnected ? canvasChain(selected.node) : [selected]}
                  selectedKey={selected.key}
                  onPick={selectElement}
                  portalContainer={rootRef}
                  sharedConst={styleScope}
                  scope={scope}
                  onScopeChange={setScope}
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
          </div>

          {/* ReorderOverlay lives OUTSIDE the fading wrapper — its listeners + the
              insertion bar must stay fully live through the drag, never faded. */}
          {reorderable?.reorderable && (
            <ReorderOverlay
              node={selected.node}
              expectedCount={reorderable.count}
              sourceKeys={reorderSelfKeys}
              onReorder={(toIndex) => commitReorder(selected, toIndex)}
              onDragChange={setReordering}
            />
          )}
        </>
      )}

      {/* Active-selection banner — teaches the direct-manipulation gestures. Drops in
          from the top edge when Canvas opens (matches where it arrives from). */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="pointer-events-auto flex animate-muse-drop items-center gap-3 whitespace-nowrap rounded-full bg-surface/95 px-4 py-2 text-sm text-fg-faint shadow-lg ring-1 ring-line/10 backdrop-blur motion-reduce:animate-none">
          <span>
            {editing
              ? 'Editing text · Enter to save · Esc to cancel'
              : selected
                ? reorderable?.reorderable
                  ? 'Drag to reorder · double-click to edit · Esc to deselect'
                  : 'Double-click to edit · Esc to deselect'
                : <>Click to edit · <BannerKbd>⇧</BannerKbd> click to flag · <BannerKbd>Esc</BannerKbd> to exit</>}
          </span>
          <button onClick={() => setActive(false)} className="rounded-full px-2 py-0.5 text-fg-muted transition hover:bg-line/10 hover:text-fg">
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

// A compact key chip for the banner — mirrors the docs <Kbd> look (bordered, mono,
// semibold) in overlay tokens. text-[11px] + leading-none keep it inside the
// banner's text line, so the bar holds its height and never wraps to a second row.
function BannerKbd({ children }: { children: string }) {
  return (
    <kbd className="mx-px inline-block rounded border border-line/25 bg-line/10 px-1 py-px align-middle font-mono text-[11px] font-semibold leading-none text-fg-muted">
      {children}
    </kbd>
  )
}
