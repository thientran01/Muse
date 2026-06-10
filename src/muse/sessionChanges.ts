import type { HistoryEntry } from './types'

// What this session actually changed, derived from the undo history. The fold is
// undo-reconciled for free: an undone entry lives in `future`, not `past`, so it
// simply isn't here. A file whose net content equals its earliest pre-Muse state
// (e.g. an edit and its manual inverse) reports changed:false and the panel/share
// exclude it.
export type SessionChange = {
  fileName: string
  labels: string[] // every history label that touched this file, in commit order
  changed: boolean // earliest `before` !== latest `after`
}

// Same earliest-before fold as MuseOverlay's revertToOriginal, extended with the
// latest-after side: per file, the first entry to touch it supplies the pre-Muse
// content and the last entry supplies the current content.
export function computeSessionChanges(past: HistoryEntry[]): SessionChange[] {
  const byFile = new Map<string, { earliest: string; latest: string; labels: string[] }>()
  for (const entry of past) {
    for (const f of entry.files) {
      const existing = byFile.get(f.fileName)
      if (existing) {
        existing.latest = f.after
        existing.labels.push(entry.label)
      } else {
        byFile.set(f.fileName, { earliest: f.before, latest: f.after, labels: [entry.label] })
      }
    }
  }
  return [...byFile].map(([fileName, v]) => ({
    fileName,
    labels: v.labels,
    changed: v.earliest !== v.latest,
  }))
}
