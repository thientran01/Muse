import { useState } from 'react'
import type { ProposedOption } from '../../types'
import { DiffView } from '../DiffView'

const fileShort = (p: string) => p.split(/[\\/]/).pop() ?? p

// One or more design directions Muse proposed. On the ACTIVE bubble each card
// is hoverable (live-previews its edit on the page) and clickable (commits it).
// Inactive bubbles (a newer turn took over) render read-only.
export function MessageOptionSet({
  options,
  originals,
  rationale,
  loading,
  active,
  onApprove,
  onPreview,
  onPreviewEnd,
}: {
  options: ProposedOption[]
  originals: Record<string, string>
  rationale: string
  loading: boolean
  active: boolean
  onApprove: (option: ProposedOption) => void
  onPreview: (option: ProposedOption) => void
  onPreviewEnd: () => void
}) {
  const [focused, setFocused] = useState(0)
  const safe = Math.min(focused, Math.max(0, options.length - 1))
  const focusedOption = options[safe]
  const multi = options.length > 1

  return (
    <div className="space-y-3">
      {rationale && <p className="text-sm leading-relaxed text-fg">{rationale}</p>}

      <div className="space-y-1.5" onMouseLeave={active ? onPreviewEnd : undefined}>
        {options.map((opt, i) => {
          const isFocused = i === safe
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!active || loading}
              data-testid={`muse-option-${i}`}
              onMouseEnter={() => {
                setFocused(i)
                if (active && !loading) onPreview(opt)
              }}
              onFocus={() => {
                setFocused(i)
                if (active && !loading) onPreview(opt)
              }}
              onClick={() => {
                if (!active || loading) return
                setFocused(i) // keep the shown diff aligned with what's being applied
                onApprove(opt)
              }}
              className={`block w-full rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-default ${
                isFocused && active
                  ? 'border-accent/40 bg-accent/[0.05]'
                  : 'border-line/15 hover:border-line/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{multi ? opt.label : 'Proposed change'}</span>
                {active && (
                  <span className="shrink-0 text-[11px] text-fg-faint">
                    {loading ? 'applying…' : isFocused ? 'click to apply' : 'hover to preview'}
                  </span>
                )}
              </div>
              {opt.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{opt.description}</p>
              )}
            </button>
          )
        })}
      </div>

      {focusedOption && (
        <div className="space-y-2">
          {focusedOption.edits.map((edit) => (
            <div key={edit.fileName} className="space-y-1">
              <span className="block truncate font-mono text-xs text-fg-muted">{fileShort(edit.fileName)}</span>
              <DiffView original={originals[edit.fileName] ?? ''} newContent={edit.newContent} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
