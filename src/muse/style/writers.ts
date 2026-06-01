// ============================================================
//  StyleWriter seam — how a CSS property is expressed in CLASS source
// ------------------------------------------------------------
//  Canvas Mode's deterministic engine (server/styleEdit.ts) turns a scrubbed
//  value into a source edit. HOW a value becomes a *class* is the part that
//  varies between styling systems — Tailwind utilities today, CSS-modules or
//  styled-components tomorrow — so it lives behind this seam. The inline
//  `style={{}}` path is NOT pluggable: every JSX host supports it, so it stays
//  the engine's built-in universal fallback (the floor under every writer).
//
//  A StyleWriter is PURE (value ↔ token, no I/O, no DOM) so both the Vite-plugin
//  server and the client can import it. It does three things the engine needs:
//    • build   — author a class token for a property+value, or null when it
//                can't be expressed safely (→ engine falls back to inline)
//    • match   — recognize this property's existing class token, so an edit
//                REPLACES it in place (and an inline write strips the dueling class)
//    • themed  — flag a token whose value comes from a CSS variable, so the
//                engine leaves it alone rather than hardcoding over a theme token
//
//  NOTE: `match`/`themed` are used regardless of the `inline` strategy — even an
//  inline edit must recognize and strip the host's dueling class. Only `build`
//  (authoring a new class) is gated by strategy. So the active writer is a
//  property of the HOST project (its class system); the strategy is a per-edit
//  preference. Today the only registered host writer is Tailwind.
// ============================================================
import type { PropertySpec } from './properties'
import { buildToken, familyMatcher } from './tailwindScales'

export interface StyleWriter {
  readonly id: string
  // Author a class token for this property+value, or null if it can't be safely
  // expressed as a class (the engine then routes the mutation to inline style).
  build(spec: PropertySpec, value: string): string | null
  // A predicate that recognizes this property's existing class token (so the
  // engine replaces the family's utility in place instead of appending a dup).
  // Returns a fresh closure per spec, matching the engine's once-per-mutation use.
  family(spec: PropertySpec): (token: string) => boolean
  // True when a token paints its value through a CSS variable — the engine skips
  // such a token (with a warning) rather than clobber a theme binding with a literal.
  themed(token: string): boolean
}

// The Tailwind host writer — wraps the existing tailwindScales facade verbatim,
// so behavior is identical to the pre-seam engine. `themed` reproduces the engine's
// prior inline `c.includes('var(')` check (a token whose arbitrary value embeds a
// CSS var, e.g. text-[color:var(--c-on-bg)] or leading-[var(--lh)]).
export const tailwindWriter: StyleWriter = {
  id: 'tailwind',
  build: (spec, value) => buildToken(spec, value),
  family: (spec) => familyMatcher(spec),
  themed: (token) => token.includes('var('),
}

// All registered host class writers. A future CssModulesWriter / StyledWriter
// implements StyleWriter and registers here; the engine picks one per host.
export const STYLE_WRITERS: Record<string, StyleWriter> = {
  [tailwindWriter.id]: tailwindWriter,
}

// The active class writer for an edit. Today every host resolves to Tailwind; the
// seam is where host detection (a project's styling system) will choose later.
// Returns the writer used to RECOGNIZE existing classes; the `inline` strategy
// still uses it for match/themed, only suppressing `build` (handled in the engine).
export function resolveStyleWriter(_hint?: string): StyleWriter {
  return tailwindWriter
}
