// ============================================================
//  Deterministic style editor — visual edit → surgical source edit
// ------------------------------------------------------------
//  The heart of Canvas Mode. Given a source file, a JSX element pinpointed by
//  its React `_debugSource` (line/column), and a list of CSS-property mutations,
//  produce the file's new contents — changing ONLY that element's className /
//  style attribute and leaving every other byte identical (same "smallest
//  possible change" contract as the chat backend's applyReplacements).
//
//  No model call: we parse the real AST (@babel/parser), find the exact
//  JSXOpeningElement, rewrite the attribute string in plain JS, and splice it
//  back by character range. Two writers decide HOW a property is expressed:
//    • Tailwind  — edit the className utility (p-4 → p-6, or arbitrary p-[17px])
//    • inline    — write into style={{ … }} (the universal fallback, and the
//                  path for non-Tailwind hosts); strips the dueling Tailwind
//                  class so inline and class don't fight.
//  The result is one or more { fileName, newContent } edits, which the client
//  runs through the EXISTING approve → /write → history flow, so Canvas edits
//  are undoable for free.
// ============================================================
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type {
  File,
  JSXAttribute,
  JSXElement,
  JSXOpeningElement,
  JSXText,
  Node,
  ObjectExpression,
} from '@babel/types'
import { PROPERTIES, isStyleProperty, type StyleProperty } from '../src/muse/style/properties'
import { resolveStyleWriter, type StyleWriter } from '../src/muse/style/writers'

// @babel/traverse ships CJS; the default export is on `.default` under ESM.
const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
  _traverse) as typeof _traverse

export type Mutation = { property: StyleProperty; value: string }
export type StyleStrategy = 'tailwind-first' | 'inline'

export type StyleEditResult = {
  newContent: string
  changed: boolean
  warnings: string[]
}

// A character-range splice on the original source. start === end is an insertion.
type Patch = { start: number; end: number; text: string }

// What we learned about the target's className attribute.
type ClassInfo =
  | { editable: true; value: string; start: number; end: number; delimiter: 'string' | 'template' }
  | { editable: false; reason: string }
  | null // no className attribute at all

// …and its style attribute.
type StyleInfo =
  | { editable: true; attr: JSXAttribute; object: ObjectExpression; props: Array<[string, string]> }
  | { editable: false; reason: string }
  | null // no style attribute at all

function parseFile(source: string): File {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  })
}

// A mutable, session-lived hint for the dev transform's line offset (see
// locateOpening). One per dev server; shared across requests so the first
// unambiguous locate calibrates every later one.
export type OffsetHint = { value: number | null }

// The tag name of an opening element ("div", "MatchRow"), or null for member /
// namespaced names. NOTE: this returns COMPONENT names too — use isHostOpening to
// tell a real DOM element ("div") from a component ("MatchRow").
function openingTag(node: JSXOpeningElement): string | null {
  return node.name.type === 'JSXIdentifier' ? node.name.name : null
}

// A host (intrinsic DOM) element opens with a lowercase identifier — React's rule:
// lowercase = DOM tag, Capitalized = component (renders its DOM elsewhere). Reorder
// needs host-only because the client maps drop slots from live DOM geometry, which
// only lines up 1:1 when each child IS the DOM node it authors.
function isHostOpening(node: JSXOpeningElement): boolean {
  const t = openingTag(node)
  return t !== null && t[0] === t[0].toLowerCase() && t[0] !== t[0].toUpperCase()
}

// A STATIC className string off an opening element (literal, or a `…` template
// with no interpolations), or null. For static Tailwind classes the source
// string equals the element's resolved DOM class attribute, so it's a reliable
// disambiguator. Dynamic classNames (clsx/conditionals/interpolation) → null.
function openingClassName(node: JSXOpeningElement): string | null {
  for (const a of node.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier' || a.name.name !== 'className') continue
    const v = a.value
    if (v?.type === 'StringLiteral') return v.value
    if (v?.type === 'JSXExpressionContainer') {
      const e = v.expression
      if (e.type === 'TemplateLiteral' && e.expressions.length === 0 && e.quasis.length === 1) {
        return e.quasis[0].value.cooked ?? e.quasis[0].value.raw
      }
    }
    return null
  }
  return null
}

const normCls = (s: string) => s.replace(/\s+/g, ' ').trim()

// React's __source columnNumber is 1-based; Babel's loc.start.column is 0-based.
// Treat both spellings as a match.
function columnMatches(nodeCol: number, reported: number): boolean {
  return nodeCol === reported || nodeCol === reported - 1
}

function nearestByColumn(candidates: JSXOpeningElement[], column: number): JSXOpeningElement | null {
  if (candidates.length <= 1) return candidates[0] ?? null
  let best = candidates[0]
  let bestDist = Infinity
  for (const node of candidates) {
    const c = node.loc!.start.column
    const dist = Math.min(Math.abs(c - column), Math.abs(c - (column - 1)))
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  return best
}

// Find the JSXOpeningElement that React's _debugSource points at.
//
// Dev transforms shift the line number. @vitejs/plugin-react's Fast Refresh wraps
// each module in a fixed-size HMR preamble (~19 lines), and that shift is baked
// into every element's _debugSource.lineNumber — by a CONSTANT amount, identical
// for every Fast-Refresh-wrapped module in the session, while the COLUMN stays
// exact. So the reliable signature is the host tag + column, NOT the line: a
// shifted line can even collide with an unrelated element that really lives there.
//
// We locate by (tag, column) and reconcile the uniform line offset, learning it
// once (`offsetHint`) so later edits resolve exactly. When tag+column is unique
// it's unambiguous; once calibrated, the offset pins it; when still ambiguous a
// static className match disambiguates (and calibrates); otherwise we trust the
// reported line as an offset-0 reading (correct when Fast Refresh is off) and
// fail closed rather than guess. `tag` absent → legacy line-based behaviour.
function locateOpening(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): JSXOpeningElement | null {
  const all: JSXOpeningElement[] = []
  traverse(ast, {
    JSXOpeningElement(path) {
      if (path.node.loc) all.push(path.node)
    },
  })

  // Learn the session offset from an unambiguous match, if it's non-negative.
  const learn = (node: JSXOpeningElement) => {
    const delta = line - node.loc!.start.line
    if (offsetHint && delta >= 0) offsetHint.value = delta
    return node
  }

  if (tag) {
    // The (tag, column) signature — reliable across the line shift.
    const sig = all.filter((n) => openingTag(n) === tag && columnMatches(n.loc!.start.column, column))

    // Unique signature → unambiguously the element; learn the session offset.
    if (sig.length === 1) return learn(sig[0])

    if (sig.length > 1) {
      // Calibrated → the element sits exactly `offset` below the reported line.
      // Require a single exact hit; anything else falls through (never guess).
      const known = offsetHint?.value
      if (known != null) {
        const at = sig.filter((n) => line - n.loc!.start.line === known)
        if (at.length === 1) return at[0]
      }
      // Static className uniquely identifies it (and calibrates the offset) — the
      // common bootstrap case, since Canvas targets carry static Tailwind classes.
      if (classNames) {
        const want = normCls(classNames)
        const byClass = sig.filter((n) => {
          const c = openingClassName(n)
          return c != null && normCls(c) === want
        })
        if (byClass.length === 1) return learn(byClass[0])
      }
      // Uncalibrated → trust the reported line as an offset-0 reading (the case
      // when Fast Refresh is off, or this module wasn't wrapped). Only when a
      // single signature element actually opens there; else fail closed.
      const onLine = sig.filter((n) => n.loc!.start.line === line)
      if (onLine.length === 1) return onLine[0]
      return null
    }
    // sig.length === 0: tag+column matched nothing (e.g. an SVG camelCase tag the
    // DOM lower-cased). Fall through to the legacy line-based locate.
  }

  // Legacy locate (no tag, or tag+column matched nothing — e.g. an SVG camelCase
  // tag the DOM lower-cased). Correct the reported line by any learned offset so
  // this can't grab an unrelated element that merely lives at the shifted line
  // under Fast Refresh. Uncalibrated → offset 0, i.e. the original behaviour.
  const target = line - (offsetHint?.value ?? 0)
  const onLine = all.filter((n) => n.loc!.start.line === target)
  if (onLine.length) return nearestByColumn(onLine, column)
  const spanning = all.filter((n) => n.loc!.start.line <= target && n.loc!.end.line >= target)
  if (spanning.length) return nearestByColumn(spanning, column)
  return null
}

function findAttr(opening: JSXOpeningElement, name: string): JSXAttribute | null {
  for (const a of opening.attributes) {
    if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name) return a
  }
  return null
}

function analyzeClassName(opening: JSXOpeningElement): ClassInfo {
  const attr = findAttr(opening, 'className')
  if (!attr) return null
  const v = attr.value
  if (!v) return { editable: false, reason: 'className has no value' }
  if (v.type === 'StringLiteral') {
    return { editable: true, value: v.value, start: v.start!, end: v.end!, delimiter: 'string' }
  }
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression
    // A static template (`...` with no ${}) is editable; anything else
    // (clsx(...), a conditional, an interpolated template) is not — we won't
    // risk rewriting a dynamic expression, so those props fall to inline style.
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0 && e.quasis.length === 1) {
      const cooked = e.quasis[0].value.cooked ?? e.quasis[0].value.raw
      return { editable: true, value: cooked, start: v.start!, end: v.end!, delimiter: 'template' }
    }
    return { editable: false, reason: 'className is a dynamic expression' }
  }
  return { editable: false, reason: 'unsupported className value' }
}

function analyzeStyle(opening: JSXOpeningElement): StyleInfo {
  const attr = findAttr(opening, 'style')
  if (!attr) return null
  const v = attr.value
  if (!v || v.type !== 'JSXExpressionContainer' || v.expression.type !== 'ObjectExpression') {
    return { editable: false, reason: 'style is not an object literal' }
  }
  const object = v.expression
  const props: Array<[string, string]> = []
  for (const p of object.properties) {
    // Only a flat object of static string/number props is safe to regenerate;
    // a spread or a computed/dynamic value means we'd drop information, so bail.
    if (p.type !== 'ObjectProperty' || p.computed) return { editable: false, reason: 'style has dynamic properties' }
    const key =
      p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null
    if (key === null) return { editable: false, reason: 'style has a non-literal key' }
    const val = p.value
    if (val.type === 'StringLiteral') props.push([key, val.value])
    else if (val.type === 'NumericLiteral') props.push([key, String(val.value)])
    else return { editable: false, reason: 'style has a non-literal value' }
  }
  return { editable: true, attr, object, props }
}

// Render a flat style object back to source: { key: "value", … }. Keys are
// camelCase CSS props (valid identifiers); values go through JSON.stringify so
// any quote/backslash in the value (e.g. a font-family fallback) is escaped and
// the emitted JS can't be broken.
function renderStyleObject(props: Array<[string, string]>): string {
  if (props.length === 0) return '{}'
  return `{ ${props.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`
}

export function computeStyleEdit(
  source: string,
  line: number,
  column: number,
  mutations: Mutation[],
  strategy: StyleStrategy = 'tailwind-first',
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): StyleEditResult {
  const warnings: string[] = []
  const valid = mutations.filter((m) => isStyleProperty(m.property) && typeof m.value === 'string')
  if (valid.length === 0) return { newContent: source, changed: false, warnings: ['no valid mutations'] }

  // The host's class writer (Tailwind today) — owns how a value becomes a class
  // token, how to recognize an existing one, and which tokens are theme-bound.
  // Inline style is the engine's universal fallback below, not a writer.
  const writer: StyleWriter = resolveStyleWriter()

  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    // A file we can't parse (exotic syntax, a transient half-saved state) becomes
    // a skipped element with a warning — never a failed batch for its siblings.
    return { newContent: source, changed: false, warnings: [`parse failed: ${(e as Error).message}`] }
  }
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) {
    return { newContent: source, changed: false, warnings: [`no JSX element found at line ${line}`] }
  }

  const classInfo = analyzeClassName(opening)
  const styleInfo = analyzeStyle(opening)
  const classEditable = classInfo?.editable === true

  // Working copies we mutate as we route each property, then emit as patches.
  let classTokens = classEditable ? (classInfo as { value: string }).value.split(/\s+/).filter(Boolean) : []
  const styleProps: Array<[string, string]> = styleInfo?.editable ? [...styleInfo.props] : []
  let classTouched = false
  let styleTouched = false

  const setStyleProp = (key: string, value: string) => {
    const i = styleProps.findIndex(([k]) => k === key)
    if (i === -1) styleProps.push([key, value])
    else styleProps[i] = [key, value]
    styleTouched = true
  }

  // Write a mutation as inline style, stripping the dueling Tailwind class when
  // className is editable so the two can't fight. Returns false if there's no
  // writable style object (present-but-dynamic) — the caller warns and skips.
  const routeInline = (m: Mutation, spec: (typeof PROPERTIES)[StyleProperty]): boolean => {
    if (styleInfo?.editable === false) {
      warnings.push(`skipped ${m.property}: ${styleInfo.reason}`)
      return false
    }
    for (const key of spec.css) setStyleProp(key, m.value)
    if (classEditable) {
      const matches = writer.family(spec)
      const before = classTokens.length
      classTokens = classTokens.filter((c) => !matches(c))
      if (classTokens.length !== before) classTouched = true
    } else if (classInfo?.editable === false) {
      warnings.push(`note: left dynamic className in place for ${m.property} (inline style overrides it)`)
    }
    return true
  }

  for (const m of valid) {
    const spec = PROPERTIES[m.property]
    // A value themed through a CSS variable stays put — never hardcode a literal
    // over a `…-[…var(--x)…]` token (it would break theming). Applies to any kind
    // (color, tracking, leading, …); skip with a warning the client can surface.
    if (classEditable) {
      const matchesFamily = writer.family(spec)
      if (classTokens.some((c) => matchesFamily(c) && writer.themed(c))) {
        warnings.push(`${m.property}: value is themed via a CSS variable — left unchanged`)
        continue
      }
    }
    const useTailwind = strategy === 'tailwind-first' && classEditable
    // A value that can't be expressed as a safe class token (writer.build → null)
    // falls back to inline even under tailwind-first, so we never emit a broken
    // className.
    const token = useTailwind ? writer.build(spec, m.value) : null
    if (useTailwind && token !== null) {
      const matches = writer.family(spec)
      // Replace the family's existing utility IN PLACE (minimal diff); append
      // only if the element didn't have one. Drop any extra duplicates.
      const idx = classTokens.findIndex((c) => matches(c))
      if (idx === -1) classTokens.push(token)
      else {
        classTokens[idx] = token
        classTokens = classTokens.filter((c, i) => i === idx || !matches(c))
      }
      classTouched = true
    } else {
      routeInline(m, spec)
    }
  }

  const patches: Patch[] = []

  if (classTouched && classInfo?.editable) {
    const ci = classInfo as { start: number; end: number; delimiter: 'string' | 'template' }
    const next = classTokens.join(' ')
    const text = ci.delimiter === 'template' ? `{\`${next}\`}` : `"${next}"`
    patches.push({ start: ci.start, end: ci.end, text })
  }

  if (styleTouched) {
    if (styleInfo?.editable) {
      patches.push({ start: styleInfo.object.start!, end: styleInfo.object.end!, text: renderStyleObject(styleProps) })
    } else {
      // No style attribute yet — insert one right after the className attribute
      // (or the tag name if there's no className), anchored on the attribute
      // node's end so we land in the whitespace between attributes.
      const classAttr = findAttr(opening, 'className')
      const insertAt = classAttr ? classAttr.end! : opening.name.end!
      patches.push({ start: insertAt, end: insertAt, text: ` style={${renderStyleObject(styleProps)}}` })
    }
  }

  if (patches.length === 0) {
    return { newContent: source, changed: false, warnings: [...warnings, 'nothing to change'] }
  }

  // Apply patches right-to-left so earlier offsets stay valid.
  patches.sort((a, b) => b.start - a.start)
  let out = source
  for (const p of patches) out = out.slice(0, p.start) + p.text + out.slice(p.end)
  return { newContent: out, changed: true, warnings }
}

// ============================================================
//  TEXT EDIT — rewrite an element's literal text content
// ------------------------------------------------------------
//  Companion to computeStyleEdit: instead of an attribute, it rewrites the single
//  static JSXText child of the located element. Same locator (so it survives the
//  Fast-Refresh line shift), same character-range splice, same result shape — so
//  it flows through the existing write + undo/redo path.
// ============================================================

export type TextEditResult = { newContent: string; changed: boolean; warnings: string[] }

const MAX_TEXT_LEN = 10_000

// The new text is literal JSXText; entity-encode the characters that would
// otherwise break the parse (`<` `>` open a tag, `{` `}` an expression). Encode
// `&` first so we never double-encode. React renders these back to the literal
// glyphs, so the visible text is unchanged.
function encodeJsxText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

// Locate the JSXElement (not just its opening tag) by matching the opening the
// shared locator returns — identity match, so it's exact and self-validating.
function locateElement(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): JSXElement | null {
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) return null
  let found: JSXElement | null = null
  traverse(ast, {
    JSXElement(path) {
      if (path.node.openingElement === opening) {
        found = path.node
        path.stop()
      }
    },
  })
  return found
}

// Locate the single static JSXText that an element's visible text comes from, or
// the reason it isn't editable. Shared by the editability probe and the edit, so
// "is this editable?" and "edit it" can never disagree. The text must be exactly
// ONE static JSXText (other children may be elements like an <Icon/>; whitespace-
// only JSXText is insignificant). Zero → the text is dynamic ({expr}); more than
// one → mixed static + dynamic.
function findTextNode(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { node: JSXText } | { reason: string } {
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { reason: `parse failed: ${(e as Error).message}` }
  }
  const element = locateElement(ast, line, column, tag, classNames, offsetHint)
  if (!element) return { reason: `no JSX element found at line ${line}` }
  if (element.openingElement.selfClosing) return { reason: 'this element has no text to edit' }
  const texts = element.children.filter((c): c is JSXText => c.type === 'JSXText' && /\S/.test(c.value))
  if (texts.length === 0) return { reason: 'this text comes from data, not static text' }
  if (texts.length > 1) return { reason: 'this text mixes static + data — not editable here' }
  const node = texts[0]
  if (node.start == null || node.end == null) return { reason: 'text node has no source position' }
  return { node }
}

// Cheap "can this text be edited?" check (no write) — the client probes it on
// double-click so it can show a calm hint instead of letting you type then bounce.
export function computeTextEditable(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { editable: boolean; reason?: string } {
  const t = findTextNode(source, line, column, tag, classNames, offsetHint)
  return 'node' in t ? { editable: true } : { editable: false, reason: t.reason }
}

export function computeTextEdit(
  source: string,
  line: number,
  column: number,
  newText: string,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): TextEditResult {
  if (typeof newText !== 'string') return { newContent: source, changed: false, warnings: ['no text provided'] }
  if (newText.length > MAX_TEXT_LEN) return { newContent: source, changed: false, warnings: ['text too long'] }

  const t = findTextNode(source, line, column, tag, classNames, offsetHint)
  if ('reason' in t) return { newContent: source, changed: false, warnings: [t.reason] }
  const node = t.node

  // Keep the node's own surrounding whitespace (indentation / the space after an
  // inline icon); swap only the visible middle.
  const lead = node.value.match(/^\s*/)![0]
  const trail = node.value.match(/\s*$/)![0]
  const replacement = lead + encodeJsxText(newText.trim()) + trail
  if (replacement === node.value) return { newContent: source, changed: false, warnings: ['nothing to change'] }

  const out = source.slice(0, node.start!) + replacement + source.slice(node.end!)
  return { newContent: out, changed: true, warnings: [] }
}

// ============================================================
//  REORDER — move a JSX element among its siblings
// ------------------------------------------------------------
//  Phase 3: the first STRUCTURAL canvas edit (every prior edit rewrote an
//  attribute string or one JSXText child — none moved a subtree). Given an
//  element and a target slot among its siblings, reorder the parent's children
//  by a character-range splice that preserves each child's surrounding
//  whitespace/indentation — same "smallest possible change" contract, same
//  { newContent } result shape, so it flows through the existing write + undo
//  path. No model call.
//
//  v1 is deliberately host-only and fails closed everywhere else, because the
//  client maps drop slots from live DOM geometry and that mapping is only sound
//  when source order === DOM order 1:1:
//    • Parent must be a host JSXElement (lowercase tag) — a fragment/component
//      parent renders its children into a DIFFERENT DOM node, breaking the map.
//    • Every significant child must be a host JSXElement — a component child
//      (<MatchRow/>) renders DOM whose _debugSource points INSIDE the component,
//      not at the usage site, so it can't be matched back; an expression child
//      ({list.map(...)}, {cond && <x/>}) is dynamic/list content; mixed static
//      text means it isn't a clean element list.
//  Anything else → not reorderable, with a calm reason the client can surface.
// ============================================================

// A movable child the probe reports back, so the client can cross-check that the
// live DOM children line up 1:1 with the source children before it trusts an index.
export type ReorderChild = { index: number; tag: string; classNames: string | null }

export type Reorderable =
  | { reorderable: true; count: number; children: ReorderChild[] }
  | { reorderable: false; reason: string }

export type ReorderResult = { newContent: string; changed: boolean; warnings: string[] }

// Like locateElement, but also returns the located element's AST parent so we can
// reorder among its siblings. Single traversal, identity match on the opening the
// shared locator picked — exact and self-validating.
function locateElementWithParent(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { el: JSXElement; parent: Node } | null {
  const opening = locateOpening(ast, line, column, tag, classNames, offsetHint)
  if (!opening) return null
  let found: { el: JSXElement; parent: Node } | null = null
  traverse(ast, {
    JSXElement(path) {
      if (path.node.openingElement === opening) {
        found = { el: path.node, parent: path.parent }
        path.stop()
      }
    },
  })
  return found
}

// Classify a parent's children into the movable host-element run, or the reason
// it can't be reordered. Shared by the probe and the edit so "can I reorder?" and
// "reorder it" can never disagree. Whitespace-only JSXText is insignificant and
// preserved; ANY non-host-element significant child fails the whole container.
type ChildScan = { ok: true; elements: JSXElement[] } | { ok: false; reason: string }

function scanReorderChildren(parent: JSXElement): ChildScan {
  const elements: JSXElement[] = []
  for (const c of parent.children) {
    if (c.type === 'JSXText') {
      if (/\S/.test(c.value)) return { ok: false, reason: 'this mixes text and elements — reorder is not supported here' }
      continue // insignificant whitespace
    }
    if (c.type === 'JSXElement') {
      if (!isHostOpening(c.openingElement)) {
        return { ok: false, reason: 'these are components, not plain elements — reorder is not supported here yet' }
      }
      elements.push(c)
      continue
    }
    if (c.type === 'JSXExpressionContainer') {
      // {items.map(...)}, {cond && <x/>}, {/* comment */} — dynamic/list content.
      return { ok: false, reason: 'these are generated from data — reorder the list instead' }
    }
    // JSXFragment child, JSXSpreadChild, anything else.
    return { ok: false, reason: 'can not reorder around dynamic content here' }
  }
  if (elements.length < 2) return { ok: false, reason: 'needs at least two sibling elements to reorder' }
  return { ok: true, elements }
}

// Resolve the selected element to its reorderable sibling run (or the reason it
// isn't one). The one place the host-parent + host-children rules live.
function resolveSiblings(
  ast: File,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): { el: JSXElement; parent: JSXElement; elements: JSXElement[] } | { reason: string } {
  const found = locateElementWithParent(ast, line, column, tag, classNames, offsetHint)
  if (!found) return { reason: `no JSX element found at line ${line}` }
  if (found.parent.type !== 'JSXElement') {
    // Fragment / expression / component-root parent → its children render into a
    // different DOM node, so DOM geometry can't map slots safely.
    return { reason: 'these elements are not in a reorderable container' }
  }
  const parent = found.parent
  if (!isHostOpening(parent.openingElement)) {
    // A component parent (<Card>…</Card>) renders its children into a different
    // DOM node, so DOM geometry can't map slots safely.
    return { reason: 'these elements are not in a reorderable container' }
  }
  const scan = scanReorderChildren(parent)
  if (!scan.ok) return { reason: scan.reason }
  return { el: found.el, parent, elements: scan.elements }
}

// Cheap "can these siblings be reordered?" probe (no write) — the client calls it
// on select so it can show the drag handle only when a drop will actually commit.
export function computeReorderable(
  source: string,
  line: number,
  column: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): Reorderable {
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { reorderable: false, reason: `parse failed: ${(e as Error).message}` }
  }
  const r = resolveSiblings(ast, line, column, tag, classNames, offsetHint)
  if ('reason' in r) return { reorderable: false, reason: r.reason }
  const children: ReorderChild[] = r.elements.map((el, index) => ({
    index,
    tag: openingTag(el.openingElement)!,
    classNames: openingClassName(el.openingElement),
  }))
  return { reorderable: true, count: children.length, children }
}

// Move the located element to insertion slot `toIndex` among its siblings, where
// toIndex is a position in the ORIGINAL significant-child list: the element ends
// up immediately before the original child at toIndex (toIndex === count → end).
// fromIndex is derived here from the element itself (the one location the client
// can pin most reliably), so the client only has to compute the drop slot.
export function computeReorder(
  source: string,
  line: number,
  column: number,
  toIndex: number,
  tag?: string,
  classNames?: string,
  offsetHint?: OffsetHint,
): ReorderResult {
  if (!Number.isInteger(toIndex) || toIndex < 0) {
    return { newContent: source, changed: false, warnings: ['invalid target slot'] }
  }
  let ast: File
  try {
    ast = parseFile(source)
  } catch (e) {
    return { newContent: source, changed: false, warnings: [`parse failed: ${(e as Error).message}`] }
  }
  const r = resolveSiblings(ast, line, column, tag, classNames, offsetHint)
  if ('reason' in r) return { newContent: source, changed: false, warnings: [r.reason] }
  const { el, parent, elements } = r

  const fromIndex = elements.indexOf(el)
  if (fromIndex === -1) return { newContent: source, changed: false, warnings: ['element is not among its siblings'] }
  const to = Math.min(toIndex, elements.length) // clamp an over-far drop to "end"
  // Inserting before yourself, or before your immediate successor, is a no-op.
  if (to === fromIndex || to === fromIndex + 1) {
    return { newContent: source, changed: false, warnings: ['nothing to change'] }
  }

  // Each child's "block" = its source PLUS the whitespace that precedes it (the
  // newline + indentation, or — for the first — the gap after the parent's
  // opening tag). The blocks tile [regionStart, regionEnd) exactly, because we
  // proved no non-whitespace lives between the elements. The trailing whitespace
  // before the closing tag sits past regionEnd and never moves.
  const regionStart = parent.openingElement.end!
  const regionEnd = elements[elements.length - 1].end!
  const blocks: string[] = elements.map((node, i) => {
    const start = i === 0 ? regionStart : elements[i - 1].end!
    return source.slice(start, node.end!)
  })

  // Standard array-move on the index order, then re-emit the blocks in that order.
  const order = [...elements.keys()]
  order.splice(fromIndex, 1)
  order.splice(to > fromIndex ? to - 1 : to, 0, fromIndex)
  const newRegion = order.map((i) => blocks[i]).join('')

  const out = source.slice(0, regionStart) + newRegion + source.slice(regionEnd)
  return { newContent: out, changed: true, warnings: [] }
}
