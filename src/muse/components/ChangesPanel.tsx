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
        Click an element and start shaping it.
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
              <span className="shrink-0 font-mono text-[10px] font-normal text-fg-faint">
                {c.labels.length} edit{c.labels.length === 1 ? '' : 's'}
              </span>
            </p>
            <p className="mt-1 flex flex-wrap gap-1">
              {c.labels.map((label, i) => (
                <span key={i} className="rounded bg-line/10 px-1.5 py-0.5 text-[10px] leading-none text-fg-muted">
                  {label}
                </span>
              ))}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
