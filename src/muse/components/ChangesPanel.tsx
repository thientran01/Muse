import { useMuseStore } from '../store'
import { computeSessionChanges } from '../sessionChanges'

// The session-changes list — what Muse touched since the page loaded, grouped per
// file with the human edit labels ("padding 8px") that landed there. Derived from
// the same undo history the toolbar bar uses, so undoing an edit removes it from
// here too. Read-only in this slice; the Share action docks into the footer next.
export function ChangesPanel() {
  const { past } = useMuseStore()
  const changes = computeSessionChanges(past).filter((c) => c.changed)

  if (changes.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
        No changes yet.
        <br />
        Edits appear here as you work.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {changes.map((c) => {
        const basename = c.fileName.split('/').pop() ?? c.fileName
        return (
          <li key={c.fileName} className="rounded-lg border border-line/10 bg-line/5 px-2.5 py-2">
            <p className="flex items-baseline gap-1.5 text-[13px] font-medium leading-snug text-fg">
              <span className="truncate" title={c.fileName}>{basename}</span>
              {/* fg-muted, not fg-faint: this count is the panel's load-bearing number
                  and faint at 10px fails AA on the tinted row. */}
              <span className="shrink-0 font-mono text-[10px] font-normal text-fg-muted">
                {c.labels.length} edit{c.labels.length === 1 ? '' : 's'}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.labels.map((label, i) => (
                <span key={i} title={label} className="max-w-full truncate rounded-md bg-line/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-fg-muted">
                  {label}
                </span>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
