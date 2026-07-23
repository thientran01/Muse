// Shared presentational primitives for the overlay chrome — the sibling of the
// docs site's src/site/ui.tsx, but on the [data-muse-ui] token scale. These exist
// to kill the verbatim class-string duplication the design-system migration
// surfaced (an icon button in two files, a list row in three, an empty state in
// two). Each preserves the exact behavior of the local component it replaces —
// the aria semantics, the disabled/danger tones, the count-badge clamp — rather
// than adopting a looser shape. See docs/specs/2026-07-22-overlay-design-system.md.
import type { ReactNode } from 'react'

// ── IconButton ──────────────────────────────────────────────────────────────
// The round 32px icon button used across the dock (MuseToolbar) and the
// undo/redo bar. One component, three tones:
//   • neutral (default)  — quiet, ring-focus on keyboard focus
//   • accent (active OR expanded) — the sticky "on" / open-disclosure tint
//   • danger              — the destructive Revert action
// Aria mirrors the original: a toggle announces aria-pressed, a disclosure
// announces aria-expanded (never both), and a plain action button announces
// neither — so color is never the lone signal.
export function IconButton({
  label,
  onClick,
  children,
  disabled,
  active,
  expanded,
  danger,
  badge,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  active?: boolean // sticky on-state (e.g. animations paused) → accent tint + aria-pressed
  expanded?: boolean // disclosure trigger (a popover) → accent tint + aria-expanded
  danger?: boolean // destructive (Revert) → rose tone
  badge?: number // count badge, top-right; clamps to 9+ (a COUNT, not an ordinal)
}) {
  // Tone precedence: accent (active/expanded) wins over danger. No current call
  // site passes both; if one ever does, the accent state is the one that shows.
  const tone =
    active || expanded
      ? 'bg-tint text-accent-fg focus-visible:ring-focus'
      : danger
        ? 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:ring-rose-500/40'
        : 'text-fg-faint hover:bg-wash hover:text-fg focus-visible:ring-focus'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      // A disclosure announces expanded/collapsed, not pressed; a toggle announces
      // pressed; a plain action button announces neither.
      aria-pressed={expanded === undefined ? active : undefined}
      aria-expanded={expanded}
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30 ${tone}`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute right-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-badge font-semibold leading-none text-white ring-1 ring-surface-soft">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────
// The recessed list-row surface — a file's edit list, a flag, the share-success
// card. `as` keeps the element honest: an <li> inside a <ul>, a <div> for the
// standalone status card.
export function Row({
  as = 'div',
  role,
  children,
}: {
  as?: 'li' | 'div'
  role?: string
  children: ReactNode
}) {
  const Tag = as as React.ElementType
  return (
    <Tag role={role} className="rounded-card border border-hairline bg-scrim px-2.5 py-2">
      {children}
    </Tag>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
// The centered, quiet "nothing here yet" copy shown by the Changes and Flags
// panels before there's anything to list.
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-1 py-6 text-center text-body-sm leading-relaxed text-fg-faint">{children}</p>
}
