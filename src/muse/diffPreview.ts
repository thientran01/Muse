// ============================================================
//  Live preview — derive a DOM restyle from a proposed edit
// ------------------------------------------------------------
//  The preview is DERIVED FROM THE EDIT (single source of truth), never a
//  parallel field the model returns. Given an option's full-file rewrite and
//  the target element's current className, we recover the element's NEW
//  className and turn it into something we can apply to the live DOM node:
//
//   1. newClassName — applied via className swap. Any class already in the
//      Tailwind JIT bundle styles instantly.
//   2. style — a small inline-style resolution of the visually-dominant,
//      JIT-risky utilities (size / weight / tracking / leading / radius /
//      padding). Inline styles beat className, so these render even when the
//      class isn't in the bundle yet (it won't be until the file is written).
// ============================================================
import { diffLines } from './diff'
import type { FileEdit, ProposedOption, SelectedElement } from './types'

export type PreviewDelta = { newClassName: string; style: Record<string, string> }

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')

// Pull the className value out of a JSX line: handles "...", '...', {`...`}, {"..."}.
function classNameOf(line: string): string | null {
  const m = line.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\})/)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
}

// Find the target element's new className by diffing the file. We look for the
// removed line that still carries the element's CURRENT className, and read the
// new className off its paired added line. Falls back to the first changed
// className pair if the exact match isn't found (LLM may have reformatted).
function newClassNameForTarget(
  original: string,
  newContent: string,
  currentClass: string,
): string | null {
  const lines = diffLines(original, newContent)
  const dels: string[] = []
  const adds: string[] = []
  for (const l of lines) {
    if (l.type === 'del') {
      const c = classNameOf(l.text)
      if (c !== null) dels.push(c)
    } else if (l.type === 'add') {
      const c = classNameOf(l.text)
      if (c !== null) adds.push(c)
    }
  }
  if (adds.length === 0) return null
  const want = currentClass.trim()
  // Prefer the add whose paired del matches the live element's className.
  const matchIdx = dels.findIndex((d) => d === want)
  if (matchIdx !== -1 && adds[matchIdx] !== undefined) return adds[matchIdx]
  // Otherwise: if exactly one className changed, it's almost certainly ours.
  if (adds.length === 1) return adds[0]
  return null
}

// --- Tailwind → inline-style resolution (focused subset) -------------------
const FONT_WEIGHT: Record<string, string> = {
  thin: '100', extralight: '200', light: '300', normal: '400',
  medium: '500', semibold: '600', bold: '700', extrabold: '800', black: '900',
}
const FONT_SIZE: Record<string, [string, string]> = {
  xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'], base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'], xl: ['1.25rem', '1.75rem'], '2xl': ['1.5rem', '2rem'],
  '3xl': ['1.875rem', '2.25rem'], '4xl': ['2.25rem', '2.5rem'], '5xl': ['3rem', '1'],
  '6xl': ['3.75rem', '1'], '7xl': ['4.5rem', '1'], '8xl': ['6rem', '1'], '9xl': ['8rem', '1'],
}
const TRACKING: Record<string, string> = {
  tighter: '-0.05em', tight: '-0.025em', normal: '0em',
  wide: '0.025em', wider: '0.05em', widest: '0.1em',
}
const LEADING: Record<string, string> = {
  none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2',
}
const ROUNDED: Record<string, string> = {
  none: '0px', sm: '0.125rem', '': '0.25rem', md: '0.375rem', lg: '0.5rem',
  xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px',
}
// Tailwind spacing scale → rem (covers the steps the presets actually emit).
const space = (n: string): string | null => {
  const v = Number(n)
  return Number.isFinite(v) ? `${v * 0.25}rem` : null
}
const arbitrary = (token: string, prefix: string): string | null => {
  const m = token.match(new RegExp(`^${prefix}-\\[(.+)\\]$`))
  return m ? m[1].replace(/_/g, ' ') : null
}

// Resolve the high-impact, JIT-risky utilities in a className into inline styles.
// Anything not in this focused map is left to the className swap.
function resolveStyles(className: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of className.split(/\s+/).filter(Boolean)) {
    let m: RegExpMatchArray | null

    if ((m = t.match(/^font-(\w+)$/)) && FONT_WEIGHT[m[1]]) out.fontWeight = FONT_WEIGHT[m[1]]
    else if ((m = t.match(/^text-(xs|sm|base|lg|xl|\dxl)$/)) && FONT_SIZE[m[1]]) {
      const [fs, lh] = FONT_SIZE[m[1]]
      out.fontSize = fs
      out.lineHeight = lh
    } else if ((m = t.match(/^text-\[length:(.+)\]$/))) out.fontSize = m[1]
    else if ((m = t.match(/^tracking-(\w+)$/)) && TRACKING[m[1]]) out.letterSpacing = TRACKING[m[1]]
    else if ((m = t.match(/^tracking-\[(.+)\]$/))) out.letterSpacing = m[1]
    else if ((m = t.match(/^leading-(\w+)$/)) && LEADING[m[1]]) out.lineHeight = LEADING[m[1]]
    else if ((m = t.match(/^leading-(\d+)$/))) out.lineHeight = `${Number(m[1]) * 0.25}rem`
    else if (t === 'rounded') out.borderRadius = ROUNDED['']
    else if ((m = t.match(/^rounded-(\w+)$/)) && ROUNDED[m[1]] !== undefined) out.borderRadius = ROUNDED[m[1]]
    else if ((m = t.match(/^rounded-\[(.+)\]$/))) out.borderRadius = m[1]
    else if ((m = t.match(/^p-(\d+(?:\.5)?)$/)) && space(m[1])) out.padding = space(m[1])!
    else if ((m = t.match(/^px-(\d+(?:\.5)?)$/)) && space(m[1])) {
      out.paddingLeft = space(m[1])!
      out.paddingRight = space(m[1])!
    } else if ((m = t.match(/^py-(\d+(?:\.5)?)$/)) && space(m[1])) {
      out.paddingTop = space(m[1])!
      out.paddingBottom = space(m[1])!
    } else {
      const a = arbitrary(t, 'p')
      if (a) out.padding = a
    }
  }
  return out
}

/** Build the live-DOM restyle for an option, scoped to the active target's
 * element. Returns null if the option doesn't touch the target's file or its
 * new className can't be recovered (the card then just won't preview). */
export function previewDeltaForTarget(
  option: ProposedOption,
  originals: Record<string, string>,
  target: SelectedElement,
): PreviewDelta | null {
  if (!target.fileName) return null
  const key = normPath(target.fileName)
  const edit: FileEdit | undefined = option.edits.find((e) => normPath(e.fileName) === key)
  const original = originals[key]
  if (!edit || original === undefined) return null
  const newClassName = newClassNameForTarget(original, edit.newContent, target.classNames)
  if (newClassName === null) return null
  return { newClassName, style: resolveStyles(newClassName) }
}
