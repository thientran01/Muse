import type { ReactNode } from 'react'
import { CaretRight, Crosshair, FileText } from '@phosphor-icons/react'
import type { ThreadMessage } from '../types'
import { MessageDesign } from './messages/MessageDesign'

// The panel's empty / home state — what you see when Muse is open but no
// element is targeted yet (the FAB now opens straight here instead of dropping
// into select mode). Target selection is the key feature, so it leads; the
// design system (and future entries) follow below.
//
// Every entry is the same HomeCard so their icon column and trailing caret
// align on one grid — hierarchy comes from icon color + an accent vs. neutral
// treatment, NOT from different box geometry.
//
// Selection-independent thread bubbles (the DESIGN.md brief, any error from
// fetching it) render under the cards — once the brief is shown, its own card
// replaces the "View design system" entry.
export function MuseHome({
  onSelect,
  onShowDesign,
  bubbles,
  onGenerateDesign,
}: {
  // Optional: the live overlay selects by clicking the page (no separate mode),
  // so it omits this and the primary entry renders as a static gesture hint. The
  // gallery state-showcase still passes it to drive its fixture flow.
  onSelect?: () => void
  onShowDesign: () => void
  bubbles: ThreadMessage[]
  onGenerateDesign: (id: string) => void
}) {
  const hasDesign = bubbles.some((m) => m.kind === 'design')

  return (
    <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-2">
      <div className="space-y-0.5">
        {/* Primary lead — accent icon. A button when a select handler is given
            (gallery), else a quiet hint teaching the two page gestures. */}
        {onSelect ? (
          <HomeCard
            primary
            testid="muse-home-select"
            onClick={onSelect}
            icon={<Crosshair size={18} weight="bold" />}
            iconClass="bg-accent/10 text-accent ring-1 ring-accent/20"
            title="Select an element to redesign"
            sub="Point Muse at any part of the page"
          />
        ) : (
          // Informational, not actionable (opening Muse already makes the page
          // selectable), so it deliberately skips the HomeCard shell + trailing
          // caret and reads as a quiet hint. It's the LEAD here, so it keeps the
          // accent icon; the design-system row below stays secondary/quiet.
          // role=note so it's announced when it renders.
          <div role="note" className="flex items-center gap-2.5 px-1.5 py-1 text-fg-faint">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
              <Crosshair size={16} weight="bold" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">Shift-click an element to ask Muse</span>
              <span className="block text-xs leading-snug text-fg-faint">Plain-click edits it directly on canvas</span>
            </span>
          </div>
        )}

        {/* Secondary — a quiet utility row, deliberately lighter than the lead
            above (no card shell / icon box / accent), so it reads as secondary.
            New selection-independent entries slot in here as they land. */}
        {!hasDesign && (
          <button
            onClick={onShowDesign}
            className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-line/5"
          >
            <FileText size={15} className="shrink-0 text-fg-faint" />
            <span className="flex-1 text-xs font-medium text-fg-muted">View design system</span>
            <span className="font-mono text-[10px] text-fg-faint">DESIGN.md</span>
          </button>
        )}
      </div>

      {/* Design brief / errors, once requested. */}
      {bubbles.map((m) => {
        if (m.kind === 'design') {
          return (
            <MessageDesign
              key={m.id}
              status={m.status}
              content={m.content}
              path={m.path}
              generator={m.generator}
              onGenerate={() => onGenerateDesign(m.id)}
            />
          )
        }
        if (m.kind === 'error') {
          return (
            <p
              key={m.id}
              className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20"
            >
              {m.text}
            </p>
          )
        }
        return null
      })}
    </div>
  )
}

// One card spec for every home entry. Fixed icon-box size + padding + trailing
// caret keep the columns aligned across cards; `primary` (accent icon, heavier
// title) is the only emphasis lever, and `subMono` renders a filename subtitle.
function HomeCard({
  icon,
  iconClass,
  title,
  sub,
  subMono = false,
  primary = false,
  onClick,
  testid,
}: {
  icon: ReactNode
  iconClass: string
  title: string
  sub?: string
  subMono?: boolean
  primary?: boolean
  onClick: () => void
  testid?: string
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl bg-line/[0.03] p-3 text-left ring-1 ring-line/10 transition hover:bg-line/[0.06] active:scale-[0.99] motion-reduce:active:scale-100"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm text-fg ${primary ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        {sub && (
          <span
            className={`block leading-snug text-fg-faint ${subMono ? 'font-mono text-[11px]' : 'text-xs'}`}
          >
            {sub}
          </span>
        )}
      </span>
      {/* Gate the nudge behind a real hover device: on touch, `group-hover` fires
          on tap and the caret would jump for no reason (Emil's touch-hover rule). */}
      <CaretRight size={15} className="shrink-0 text-fg-faint/50 transition [@media(hover:hover)]:group-hover:translate-x-0.5" />
    </button>
  )
}
