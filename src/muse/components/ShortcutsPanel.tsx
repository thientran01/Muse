// The gesture/shortcut reference, one click away on the toolbar — the same
// content the docs site's Reference page carries, for the moment mid-edit when
// you can't remember the parent-step or keyboard-reorder gesture. Static list,
// no state; rows mirror the active-selection banner's vocabulary.

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line/20 bg-line/5 px-1 font-mono text-[10px] leading-none text-fg-muted">
      {children}
    </kbd>
  )
}

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['R'], what: 'open and close Muse' },
  { keys: ['Click'], what: 'select and shape an element' },
  { keys: ['⇧', 'Click'], what: 'flag an element for your agent' },
  { keys: ['Alt', 'Click'], what: 'step out to the parent' },
  { keys: ['Dbl-click'], what: 'edit text in place' },
  { keys: ['Drag'], what: 'reorder among siblings, scroll mid-drag to reach farther' },
  // The handler accepts both axes so it works in rows AND columns.
  { keys: ['⌘/Ctrl', '↑↓←→'], what: 'reorder by keyboard' },
  { keys: ['⌘/Ctrl', 'Z'], what: 'undo' },
  { keys: ['⌘/Ctrl', '⇧', 'Z'], what: 'redo' },
  { keys: ['Esc'], what: 'deselect, then close' },
]

export function ShortcutsPanel() {
  return (
    <ul className="flex flex-col gap-1.5">
      {SHORTCUTS.map((s) => (
        <li key={s.what} className="flex items-center justify-between gap-3 text-[12px]">
          <span className="flex shrink-0 items-center gap-1">
            {s.keys.map((k) => (
              <Key key={k}>{k}</Key>
            ))}
          </span>
          <span className="min-w-0 flex-1 text-right leading-snug text-fg-muted">{s.what}</span>
        </li>
      ))}
    </ul>
  )
}
