// The gesture/shortcut reference, one click away on the toolbar — the same
// content the docs site's Reference page carries, for the moment mid-edit when
// you can't remember the parent-step or keyboard-reorder gesture. Static list,
// no state; rows mirror the active-selection banner's vocabulary.

export function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line/20 bg-line/5 px-1 font-mono text-chip leading-none text-fg-muted">
      {children}
    </kbd>
  )
}

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['R'], what: 'open and close Muse' },
  { keys: ['Click'], what: 'select and shape an element' },
  // Modifiers are WORDS ("Shift", "Alt"), matching the FlagsPanel copy and the
  // banner — mixing ⇧ with a spelled-out Alt read as two systems. ⌘ stays a
  // symbol only inside the paired "⌘/Ctrl" chip (spelling out Cmd doubles it).
  { keys: ['Shift', 'Click'], what: 'flag an element for your agent' },
  { keys: ['Alt', 'Click'], what: 'step out to the parent' },
  { keys: ['Alt', 'Hover'], what: 'measure from the selection to the hovered element' },
  { keys: ['Dbl-click'], what: 'edit text in place' },
  { keys: ['Drag'], what: 'reorder among siblings, scroll mid-drag to reach farther' },
  // The handler accepts both axes so it works in rows AND columns.
  { keys: ['⌘/Ctrl', '↑↓←→'], what: 'reorder by keyboard' },
  { keys: ['⌘/Ctrl', 'Alt', 'C'], what: 'copy the selection’s styles' },
  { keys: ['⌘/Ctrl', 'Alt', 'V'], what: 'paste styles onto the selection' },
  { keys: ['⌘/Ctrl', 'Z'], what: 'undo' },
  { keys: ['⌘/Ctrl', 'Shift', 'Z'], what: 'redo' },
  { keys: ['Esc'], what: 'deselect, then close' },
]

export function ShortcutsPanel() {
  return (
    <ul className="flex flex-col gap-1.5">
      {SHORTCUTS.map((s) => (
        <li key={s.what} className="flex items-center justify-between gap-3 text-body-sm">
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
