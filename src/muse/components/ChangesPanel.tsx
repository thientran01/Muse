import { useEffect, useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { museShare, museShareProbe } from '../api'
import { computeSessionChanges, type SessionChange } from '../sessionChanges'
import { museStore, useMuseStore } from '../store'
import type { ShareProbe } from '../types'

// Fingerprint of the current net changes — compared against the at-share snapshot
// so the footer can tell "new edits since the share" (offer Share again) apart from
// "nothing new" (rest at the success card). Label count moves on every commit AND
// every undo, so both directions register.
const fingerprint = (changes: SessionChange[]) =>
  JSON.stringify(changes.map((c) => [c.fileName, c.labels.length]))

// The session-changes surface — what Muse touched since the page loaded, grouped per
// file with the human edit labels ("padding 8px") that landed there, plus the Share
// footer: one button that turns the session into a muse/* branch + PR an engineer
// can review. Derived from the same undo history the toolbar bar uses, so undoing
// an edit removes it from here too.
export function ChangesPanel() {
  const { past, share } = useMuseStore()
  const changes = computeSessionChanges(past).filter((c) => c.changed)

  // Capability probe, re-run per panel open (the popover unmounts on close). The
  // Share button renders only after available:true comes back — a missing piece
  // (no git, no repo, no commits) shows its reason instead of a doomed action.
  const [probe, setProbe] = useState<ShareProbe | null>(null)
  useEffect(() => {
    let stale = false
    void museShareProbe(changes.map((c) => c.fileName)).then((p) => {
      if (!stale) setProbe(p)
    })
    return () => {
      stale = true
    }
    // Probe once per mount: availability is about the environment, not the edit list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doShare = async () => {
    if (museStore.getState().share.status === 'sharing') return
    const current = computeSessionChanges(museStore.getState().past).filter((c) => c.changed)
    if (current.length === 0) return
    const prior = museStore.getState().share
    museStore.setState({ share: { ...prior, status: 'sharing' } })
    const result = await museShare({
      files: current.map((c) => c.fileName),
      changes: current.map(({ fileName, labels }) => ({ fileName, labels })),
      slugHint: current[0]?.labels[0],
      branch: prior.branch,
    })
    if (result.ok) {
      museStore.setState({
        share: {
          status: 'done',
          branch: result.branch,
          // alreadyShared replies may omit the PR link — keep the one we have.
          prUrl: result.prUrl ?? prior.prUrl,
          compareUrl: result.compareUrl ?? prior.compareUrl,
          message: result.warnings.join(' ') || undefined,
          snapshot: fingerprint(current),
        },
      })
    } else {
      museStore.setState({ share: { ...prior, status: 'error', message: result.error } })
    }
  }

  if (changes.length === 0 && share.status !== 'done') {
    return (
      <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-fg-faint">
        No changes yet.
        <br />
        Edits appear here as you work.
      </p>
    )
  }

  const hasNewEdits = share.status === 'done' && fingerprint(changes) !== share.snapshot && changes.length > 0
  const url = share.prUrl ?? share.compareUrl

  return (
    <div className="flex flex-col gap-2">
      {changes.length > 0 && (
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
      )}

      {/* The Share footer. Order of precedence: still probing → quiet; environment
          can't share → its reason; otherwise the action + the latest outcome. */}
      <div className="border-t border-line/10 pt-2">
        {probe === null ? (
          <p className="px-0.5 text-[11px] leading-relaxed text-fg-faint">Checking this project can be shared…</p>
        ) : !probe.available ? (
          <p className="px-0.5 text-[11px] leading-relaxed text-fg-muted">{probe.reason}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {share.status === 'done' && (
              <div role="status" className="rounded-lg border border-line/10 bg-line/5 px-2.5 py-2">
                <p className="text-[12px] font-medium text-fg">Your changes are on their way.</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-fg-muted" title={share.branch}>
                  {share.branch}
                </p>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-fg px-2 py-1 text-[11px] font-semibold text-surface transition hover:opacity-90 active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    View pull request
                    <ArrowSquareOut size={11} weight="bold" />
                  </a>
                ) : (
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    Ask an engineer to open a pull request for this branch.
                  </p>
                )}
                {share.message && (
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{share.message}</p>
                )}
              </div>
            )}

            {share.status === 'error' && (
              <p role="status" className="px-0.5 text-[11px] leading-relaxed text-rose-400">{share.message}</p>
            )}

            {(share.status === 'idle' || share.status === 'error' || share.status === 'sharing' || hasNewEdits) && (
              <button
                type="button"
                onClick={() => void doShare()}
                disabled={share.status === 'sharing'}
                aria-busy={share.status === 'sharing'}
                className="w-full rounded-lg bg-fg py-1.5 text-[12px] font-semibold text-surface transition hover:opacity-90 active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                {share.status === 'sharing'
                  ? 'Sharing…'
                  : share.status === 'error'
                    ? 'Try again'
                    : hasNewEdits
                      ? 'Share new edits'
                      : 'Share changes'}
              </button>
            )}

            {share.status === 'idle' && probe.dirtyOtherCount > 0 && (
              <p className="px-0.5 text-[11px] leading-relaxed text-fg-faint">
                {probe.dirtyOtherCount} other edited file{probe.dirtyOtherCount === 1 ? '' : 's'} on this machine stay
                {probe.dirtyOtherCount === 1 ? 's' : ''} out of the share.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
