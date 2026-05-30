import type { ArchivedThread } from '../store'

// Short element descriptor for an entry, e.g. "<div> · HomePage.tsx" — the
// context for what each proposal was about.
function elementsLabel(e: ArchivedThread): string {
  const els = e.elements
  if (els.length === 0) return ''
  if (els.length > 1) return `${els.length} elements`
  const el = els[0]
  const file = el.fileName ? el.fileName.split(/[\\/]/).pop() : ''
  return `<${el.tag}>${file ? ` · ${file}` : ''}`
}

// Relative "time ago" for the list. Recomputed on each render (cheap).
function rel(t: number): string {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Past proposals — threads that produced an edit and were closed (maybe before
// applying). Click one to bring it back, viewable and still applyable.
export function MuseHistory({
  entries,
  onPick,
}: {
  entries: ArchivedThread[]
  onPick: (id: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="flex-1 px-4 py-8 text-center text-sm text-fg-faint">
        No past proposals yet. Ones you close before applying show up here.
      </div>
    )
  }
  return (
    <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
      {entries.map((e) => (
        <button
          key={e.id}
          onClick={() => onPick(e.id)}
          className="block w-full rounded-lg border border-line/15 px-3 py-2 text-left transition hover:border-line/30 hover:bg-line/5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-fg">{e.label}</span>
            <span className="shrink-0 text-[11px] text-fg-faint">{rel(e.time)}</span>
          </div>
          {elementsLabel(e) && (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-faint">{elementsLabel(e)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
