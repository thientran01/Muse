// Tailwind's DEFAULT responsive screens — the breakpoint-target switcher's
// model. v1 assumes the defaults; a host's custom `theme.screens` isn't read
// yet (that needs server-side config evaluation — the tokens endpoint is the
// natural future carrier). The consequence is bounded: edits always write
// exactly the prefix you chose; only the CURRENT-breakpoint indicator (which
// compares window.innerWidth to these widths) can be off on a custom host.
// Pure module: no DOM — the client passes the width in.
export const SCREENS = [
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280],
  ['2xl', 1536],
] as const

export type Breakpoint = (typeof SCREENS)[number][0]
export type BpTarget = '' | Breakpoint

export const SCREEN_MIN: Record<Breakpoint, number> = Object.fromEntries(SCREENS) as Record<Breakpoint, number>

// The widest breakpoint the given viewport width has reached, '' below sm —
// mobile-first, like Tailwind's own min-width media queries.
export function currentBreakpoint(width: number): BpTarget {
  let cur: BpTarget = ''
  for (const [name, min] of SCREENS) {
    if (width >= min) cur = name
  }
  return cur
}

// Mobile-first: a `md:` edit is PAINTING at the current width iff the window
// is at least that breakpoint's min — the gate for live preview feedback.
export function targetApplies(target: BpTarget, width: number): boolean {
  if (target === '') return true
  return width >= SCREEN_MIN[target]
}

// Compose the commit's variant chain from the breakpoint target and the
// forced-hover chain (PR-4): Tailwind orders responsive before state variants
// (md:hover:bg-x), so the target goes first.
export function composeVariant(target: BpTarget, stateChain: string | null): string {
  return [target || null, stateChain].filter(Boolean).join(':')
}
