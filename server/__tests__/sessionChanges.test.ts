// ============================================================
//  computeSessionChanges — the undo-reconciled session fold
// ------------------------------------------------------------
//  Pins the contract the Changes panel and the share request both stand on:
//  per file, earliest `before` vs latest `after` across the history, labels
//  in commit order, net-zero files reported changed:false, and undone entries
//  excluded simply because they live in `future`, not `past`.
// ============================================================
import { describe, expect, it } from 'vitest'
import { computeSessionChanges } from '../../src/muse/sessionChanges'
import type { HistoryEntry } from '../../src/muse/types'

const entry = (label: string, files: Array<[string, string, string]>): HistoryEntry => ({
  label,
  files: files.map(([fileName, before, after]) => ({ fileName, before, after })),
  elements: [],
})

describe('computeSessionChanges', () => {
  it('folds multiple edits to one file into earliest-before vs latest-after', () => {
    const past = [
      entry('padding 8px', [['src/App.tsx', 'a', 'b']]),
      entry('padding 12px', [['src/App.tsx', 'b', 'c']]),
    ]
    expect(computeSessionChanges(past)).toEqual([
      { fileName: 'src/App.tsx', labels: ['padding 8px', 'padding 12px'], changed: true },
    ])
  })

  it('reports a net-zero file as changed:false (an edit and its manual inverse)', () => {
    const past = [
      entry('padding 8px', [['src/App.tsx', 'a', 'b']]),
      entry('padding 4px', [['src/App.tsx', 'b', 'a']]),
    ]
    expect(computeSessionChanges(past)[0].changed).toBe(false)
  })

  it('keeps files independent and groups a multi-file entry under one label', () => {
    const past = [
      entry('color #fff', [
        ['src/App.tsx', 'a', 'b'],
        ['src/index.css', 'x', 'y'],
      ]),
      entry('reorder', [['src/Other.tsx', 'p', 'q']]),
    ]
    expect(computeSessionChanges(past)).toEqual([
      { fileName: 'src/App.tsx', labels: ['color #fff'], changed: true },
      { fileName: 'src/index.css', labels: ['color #fff'], changed: true },
      { fileName: 'src/Other.tsx', labels: ['reorder'], changed: true },
    ])
  })

  it('returns empty for an empty history (and for a fully undone session, since past is empty)', () => {
    expect(computeSessionChanges([])).toEqual([])
  })
})
