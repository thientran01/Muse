// ============================================================
//  Live preview — derive DOM restyles from a proposed edit
// ------------------------------------------------------------
//  The preview is DERIVED FROM THE EDIT (single source of truth), never a
//  parallel field the model returns. An option is one or more full-file
//  rewrites; we diff each against its original to recover every className
//  CHANGE as an (oldClassName → newClassName) pair, then match each pair to
//  live DOM node(s) BY THEIR CURRENT CLASSNAME — not by source line. That makes
//  the preview robust to line shifts and loops, lets a single option restyle
//  several elements (the selected one and/or its children), and — crucially —
//  can never misattribute a child's change to the wrong node: a pair only
//  applies where the current className matches exactly. If nothing matches, the
//  card simply doesn't preview (apply + the diff still work).
//
//  Each matched node gets:
//   1. newClassName — applied via className swap. Any class already in the
//      Tailwind JIT bundle styles instantly.
//   2. style — a small inline-style resolution of the visually-dominant,
//      JIT-risky utilities (size / weight / tracking / leading / radius /
//      padding). Inline styles beat className, so these render even when the
//      class isn't in the bundle yet (it won't be until the file is written).
// ============================================================
import { diffLines } from './diff'
import { FONT_WEIGHT, FONT_SIZE, TRACKING, LEADING, ROUNDED, spaceRem } from './style/tailwindScales'
import type { ProposedOption } from './types'

export type PreviewDelta = { newClassName: string; style: Record<string, string> }
// A className change recovered from a diff, before it's matched to the DOM.
export type ElementPreview = { oldClassName: string } & PreviewDelta
// A change matched to a concrete live node, ready to apply.
export type PreviewMatch = { node: HTMLElement; delta: PreviewDelta }

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')
// Whitespace-insensitive className: JSX may write classes across lines or with
// odd spacing; the DOM collapses runs differently. Compare on a canonical form.
const normClass = (c: string) => c.trim().replace(/\s+/g, ' ')

// Pull the className value out of a JSX line: handles "...", '...', {`...`}, {"..."}.
function classNameOf(line: string): string | null {
  const m = line.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\})/)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
}

// Every className change in one file's diff, as (old → new) pairs. Within each
// contiguous changed run we zip the removed classNames against the added ones in
// order. We ONLY pair a hunk whose removed/added className counts are EQUAL — a
// pure restyle where del[k] reliably corresponds to add[k]. If the counts differ
// the hunk inserted or removed an element (its className shifts the positions),
// so positional pairing would misattribute a class to the wrong node — we skip
// the hunk entirely (no preview beats a wrong one). Unchanged pairs are dropped.
function classNamePairs(original: string, newContent: string): Array<{ oldClassName: string; newClassName: string }> {
  const lines = diffLines(original, newContent)
  const pairs: Array<{ oldClassName: string; newClassName: string }> = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'same') {
      i++
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (i < lines.length && lines[i].type !== 'same') {
      const c = classNameOf(lines[i].text)
      if (c !== null) (lines[i].type === 'del' ? dels : adds).push(c)
      i++
    }
    if (dels.length !== adds.length) continue // structural change — can't pair safely
    for (let k = 0; k < dels.length; k++) {
      if (normClass(dels[k]) !== normClass(adds[k])) pairs.push({ oldClassName: dels[k], newClassName: adds[k] })
    }
  }
  return pairs
}

// --- Tailwind → inline-style resolution (focused subset) -------------------
// The scale tables (FONT_WEIGHT / FONT_SIZE / TRACKING / LEADING / ROUNDED /
// spaceRem) live in ./style/tailwindScales — the single source of truth shared
// with the deterministic style editor (server/styleEdit.ts), so preview and
// codegen can never drift apart.
const arbitrary = (token: string, prefix: string): string | null => {
  const m = token.match(new RegExp(`^${prefix}-\\[(.+)\\]$`))
  return m ? m[1].replace(/_/g, ' ') : null
}

// Resolve the high-impact, JIT-risky utilities in a className into inline styles.
// Anything not in this focused map is left to the className swap.
function resolveStyles(className: string): Record<string, string> {
  const out: Record<string, string> = {}
  const tokens = className.split(/\s+/).filter(Boolean)
  // An explicit leading-* always wins over the line-height bundled with text-*,
  // regardless of token order (Tailwind's own precedence).
  const hasLeading = tokens.some((t) => /^leading-/.test(t))
  for (const t of tokens) {
    let m: RegExpMatchArray | null

    if ((m = t.match(/^font-(\w+)$/)) && FONT_WEIGHT[m[1]]) out.fontWeight = FONT_WEIGHT[m[1]]
    else if ((m = t.match(/^text-(xs|sm|base|lg|xl|\dxl)$/)) && FONT_SIZE[m[1]]) {
      const [fs, lh] = FONT_SIZE[m[1]]
      out.fontSize = fs
      if (!hasLeading) out.lineHeight = lh
    } else if ((m = t.match(/^text-\[length:(.+)\]$/))) out.fontSize = m[1]
    else if ((m = t.match(/^tracking-(\w+)$/)) && TRACKING[m[1]]) out.letterSpacing = TRACKING[m[1]]
    else if ((m = t.match(/^tracking-\[(.+)\]$/))) out.letterSpacing = m[1]
    else if ((m = t.match(/^leading-(\w+)$/)) && LEADING[m[1]]) out.lineHeight = LEADING[m[1]]
    else if ((m = t.match(/^leading-(\d+)$/))) out.lineHeight = `${Number(m[1]) * 0.25}rem`
    else if (t === 'rounded') out.borderRadius = ROUNDED['']
    else if ((m = t.match(/^rounded-(\w+)$/)) && ROUNDED[m[1]] !== undefined) out.borderRadius = ROUNDED[m[1]]
    else if ((m = t.match(/^rounded-\[(.+)\]$/))) out.borderRadius = m[1]
    else if ((m = t.match(/^p-(\d+(?:\.5)?)$/)) && spaceRem(m[1])) out.padding = spaceRem(m[1])!
    else if ((m = t.match(/^px-(\d+(?:\.5)?)$/)) && spaceRem(m[1])) {
      out.paddingLeft = spaceRem(m[1])!
      out.paddingRight = spaceRem(m[1])!
    } else if ((m = t.match(/^py-(\d+(?:\.5)?)$/)) && spaceRem(m[1])) {
      out.paddingTop = spaceRem(m[1])!
      out.paddingBottom = spaceRem(m[1])!
    } else {
      const a = arbitrary(t, 'p')
      if (a) out.padding = a
    }
  }
  return out
}

/** Every className change an option makes, across all the files it edits, as a
 * flat list of (old → new) deltas. De-duped on the (old, new) pair so a class
 * that recurs in several files is matched once. Pure — no DOM access. */
export function elementPreviewsForOption(
  option: ProposedOption,
  originals: Record<string, string>,
): ElementPreview[] {
  const out: ElementPreview[] = []
  const seen = new Set<string>()
  for (const edit of option.edits) {
    // edits are normally keyed identically to `originals` (both root-relative);
    // fall back to a suffix match in case an edit carries an absolute path.
    const original =
      originals[edit.fileName] ??
      originals[normPath(edit.fileName)] ??
      Object.entries(originals).find(([k]) => {
        const a = normPath(k)
        const b = normPath(edit.fileName)
        return a === b || a.endsWith('/' + b) || b.endsWith('/' + a)
      })?.[1]
    if (original === undefined) continue
    for (const { oldClassName, newClassName } of classNamePairs(original, edit.newContent)) {
      const k = `${oldClassName}\n${newClassName}` // \n separator — classNames contain spaces
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ oldClassName, newClassName, style: resolveStyles(newClassName) })
    }
  }
  return out
}

/** Match each className-change to live DOM node(s) by their CURRENT className.
 * Scans the document once, applying a delta to every node whose current class
 * equals the pair's old class (so repeated/looped elements all preview). Muse's
 * own UI is skipped. Reads the DOM but never mutates it — the caller applies the
 * returned matches, so a pair's new class can't chain into another pair. */
export function matchPreviews(previews: ElementPreview[]): PreviewMatch[] {
  if (previews.length === 0 || typeof document === 'undefined') return []
  // Index by old className. If the same current class would map to two DIFFERENT
  // new classes (two edited elements happen to share an exact class string but
  // change differently), it's ambiguous — drop it rather than apply whichever
  // came last to every matching node.
  const byOld = new Map<string, PreviewDelta>()
  const ambiguous = new Set<string>()
  for (const p of previews) {
    const key = normClass(p.oldClassName)
    const existing = byOld.get(key)
    if (existing && existing.newClassName !== p.newClassName) {
      ambiguous.add(key)
      continue
    }
    byOld.set(key, { newClassName: p.newClassName, style: p.style })
  }
  const out: PreviewMatch[] = []
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    // HTMLElement only — SVG/MathML nodes have a read-only `className`, so the
    // apply step would throw; their classes also aren't Tailwind utilities.
    if (!(el instanceof HTMLElement)) continue
    if (el.closest('[data-muse-ui]')) continue // never restyle Muse's own chrome
    const key = normClass(el.getAttribute('class') ?? '')
    if (ambiguous.has(key)) continue
    const delta = byOld.get(key)
    if (delta) out.push({ node: el, delta })
  }
  return out
}
