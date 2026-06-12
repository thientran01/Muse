// ============================================================
//  Token suggestion — which design tokens belong in the color picker
// ------------------------------------------------------------
//  The picker shows a small row of the host's color tokens so a brand color is
//  one click away instead of an eyedropper hunt. Space is tight (five swatches),
//  so this module RANKS the candidates by how likely the user is to want each:
//    1. how much the page actually uses the token (var() references in the
//       host's stylesheets, counted by the caller, who has DOM access)
//    2. when a paired color is known (Text vs Fill), how visible the token
//       would be against it, so near-invisible picks sink
//    3. definition order as the tiebreak (earlier = more foundational)
//  Identical values dedupe to one swatch (the strongest-ranked name wins).
//  PURE (no I/O, no DOM) like the rest of style/ — the caller supplies the
//  token list and usage counts.
// ============================================================
import { contrastRatio, normalizeHexInput } from './colorMath'

export type TokenSwatch = { name: string; value: string } // value normalized to #rrggbb (or #rrggbbaa)

export const TOKEN_SWATCH_LIMIT = 5

export function rankTokenSwatches(
  tokens: Array<{ name: string; value: string; isColor: boolean }>,
  usage: Record<string, number>,
  opts: { contrastAgainst?: string; limit?: number } = {},
): TokenSwatch[] {
  const limit = opts.limit ?? TOKEN_SWATCH_LIMIT
  // Hex-valued color tokens only: the picker's HSV model and live preview both
  // speak #rrggbb. A token authored as rgb()/oklch() stays editable from the
  // token panel's value field; it just doesn't get a one-click swatch here.
  const candidates = tokens.flatMap((t) => {
    if (!t.isColor) return []
    const hex = normalizeHexInput(t.value)
    return hex ? [{ name: t.name, value: hex }] : []
  })

  const score = (c: TokenSwatch, index: number): [number, number, number] => {
    const used = usage[c.name] ?? 0
    // Visibility against the paired color, when one is known. This only
    // DOWN-RANKS a token that would paint invisibly (e.g. white text token
    // while editing a white fill) — it never excludes, since a low-contrast
    // pick can still be exactly what a background edit wants.
    const visible = opts.contrastAgainst
      ? (contrastRatio(c.value, opts.contrastAgainst)?.ratio ?? 1)
      : 1
    return [used, Math.min(visible, 4.5), -index]
  }

  const ranked = candidates
    .map((c, i) => ({ c, s: score(c, i) }))
    .sort((a, b) => b.s[0] - a.s[0] || b.s[1] - a.s[1] || b.s[2] - a.s[2])
    .map((x) => x.c)

  // Dedupe identical values after ranking, so of two names sharing a hex the
  // stronger-ranked one keeps the slot.
  const seen = new Set<string>()
  const out: TokenSwatch[] = []
  for (const c of ranked) {
    if (seen.has(c.value)) continue
    seen.add(c.value)
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}
