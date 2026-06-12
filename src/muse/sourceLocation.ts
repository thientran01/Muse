// ============================================================
//  MUSE ENGINE  —  element introspection
// ------------------------------------------------------------
//  Two source-mapping strategies, tried in preference order:
//
//  1. data-muse-loc attribute (Phase 6, preferred)
//     The museLoc Babel plugin (server/babelPluginMuseLoc.ts) stamps every JSX
//     opening element in dev/demo mode with data-muse-loc="file:line:col".
//     • Works on React 18 AND React 19 (no fiber dependency)
//     • Carries the exact disk line — no Fast Refresh +19 offset to compensate
//     • Stripped from production builds
//
//  2. React 18 fiber walk (fallback)
//     @vitejs/plugin-react injects _debugSource in dev mode. Works on React 18
//     only; React 19 removed the field. Still useful when the attribute is absent
//     (e.g. a host component that pre-dates the plugin, or a unit-test render).
// ============================================================

export type SourceLocation = {
  fileName: string
  lineNumber: number
  columnNumber: number
}

// Tag + text snippet + a short component breadcrumb (agentation-style label).
export type ElementInfo = {
  tag: string
  text: string
  crumbs: string[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function getFiber(el: Element): any {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  return key ? (el as any)[key] : null
}

// Resolve a fiber `type` to a readable component name (handles host tags,
// function/class components, and wrappers like forwardRef / memo).
function componentName(type: any): string | null {
  if (!type) return null
  if (typeof type === 'string') return type
  if (typeof type === 'function') return type.displayName || type.name || null
  if (typeof type === 'object') {
    return type.displayName || componentName(type.type) || componentName(type.render) || null
  }
  return null
}

export function getSourceLocation(el: Element | null): SourceLocation | null {
  if (!el) return null

  // --- Strategy 1: data-muse-loc attribute (Phase 6, preferred) ---------------
  // Format: "absPath:line:col" — parse from the right so Windows drive colons
  // (e.g. "C:/…") don't break the split. line is 1-based, col is 0-based.
  const attr = el.getAttribute('data-muse-loc')
  if (attr) {
    const parts = attr.split(':')
    const col = parseInt(parts.pop() ?? '', 10)
    const line = parseInt(parts.pop() ?? '', 10)
    const fileName = parts.join(':')
    if (fileName && Number.isFinite(line) && Number.isFinite(col)) {
      return { fileName, lineNumber: line, columnNumber: col }
    }
  }

  // --- Strategy 2: React 18 fiber walk (fallback) ------------------------------
  let fiber = getFiber(el)
  while (fiber) {
    if (fiber._debugSource) {
      const { fileName, lineNumber, columnNumber } = fiber._debugSource
      return { fileName, lineNumber, columnNumber: columnNumber ?? 0 }
    }
    fiber = fiber._debugOwner ?? fiber.return
  }
  return null
}

// The nearest COMPONENT (capitalized owner) that rendered this element, or null.
// Fuels the breadcrumb's component names. try/catch + optional chaining: only
// _debugSource died in React 19 — __reactFiber$/_debugOwner survive in dev — but
// fiber internals are semi-private, so a future shift degrades to tag.class
// instead of throwing mid-render.
export function componentNameFor(el: Element): string | null {
  try {
    let owner = getFiber(el)?._debugOwner
    let guard = 0
    while (owner && guard++ < 40) {
      const name = componentName(owner.type ?? owner.elementType)
      if (name && /^[A-Z]/.test(name)) return name
      owner = owner._debugOwner
    }
  } catch {
    /* fiber shape shifted — fall back */
  }
  return null
}

export function getElementInfo(el: Element | null): ElementInfo | null {
  if (!el) return null
  const tag = el.tagName.toLowerCase()
  // DIRECT text children only (the same predicate the panel's rendersText uses):
  // a container's tooltip must not concatenate its whole subtree ("MuseOverview
  // Install How it works…") — that's DOM noise, not identity. One fallback for
  // the wrapped-label idiom (<button><span>Save</span></button>, ubiquitous in
  // design systems): an element with exactly ONE child element reads that
  // child's direct text — still never a multi-child container's subtree.
  const directText = (node: Element) =>
    [...node.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  let text = directText(el)
  if (!text && el.childNodes.length === 1 && el.firstElementChild) text = directText(el.firstElementChild)
  text = text.slice(0, 36)

  // Walk the owner chain for the components that rendered this element.
  const crumbs: string[] = []
  let owner = getFiber(el)?._debugOwner
  let guard = 0
  while (owner && crumbs.length < 2 && guard++ < 40) {
    const name = componentName(owner.type ?? owner.elementType)
    if (name && /^[A-Z]/.test(name)) crumbs.unshift(name) // keep component (capitalized) names
    owner = owner._debugOwner
  }

  return { tag, text, crumbs }
}
