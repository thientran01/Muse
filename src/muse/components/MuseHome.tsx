import { CaretRight, Crosshair, FileText } from '@phosphor-icons/react'
import type { ThreadMessage } from '../types'
import { MessageDesign } from './messages/MessageDesign'

// The panel's empty / home state — what you see when Muse is open but no
// element is targeted yet (the FAB now opens straight here instead of dropping
// into select mode). Target selection is the key feature, so it's the hero: a
// big accent CTA that arms select mode. Everything else (the design system,
// and future entries) sits below as quieter secondary rows.
//
// Selection-independent thread bubbles (the DESIGN.md card, any error from
// fetching it) render under the menu — once the brief is shown, its own card
// replaces the "View design system" row.
export function MuseHome({
  onSelect,
  onShowDesign,
  bubbles,
  onGenerateDesign,
}: {
  onSelect: () => void
  onShowDesign: () => void
  bubbles: ThreadMessage[]
  onGenerateDesign: (id: string) => void
}) {
  const hasDesign = bubbles.some((m) => m.kind === 'design')

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {/* Hero — the primary action. */}
      <button
        data-testid="muse-home-select"
        onClick={onSelect}
        className="group flex w-full items-center gap-3 rounded-xl bg-accent/10 p-3.5 text-left ring-1 ring-accent/20 transition hover:bg-accent/15 hover:ring-accent/30 active:scale-[0.99] motion-reduce:active:scale-100"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm">
          <Crosshair size={18} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">Select an element to redesign</span>
          <span className="block text-xs leading-snug text-fg-faint">
            Point Muse at any part of the page
          </span>
        </span>
        <CaretRight size={15} className="shrink-0 text-accent/70 transition group-hover:translate-x-0.5" />
      </button>

      {/* Secondary entries. New Muse features slot in here as they land. */}
      {!hasDesign && (
        <div className="space-y-1.5">
          <SecondaryRow
            icon={<FileText size={15} />}
            label="View design system"
            sub="DESIGN.md"
            onClick={onShowDesign}
          />
        </div>
      )}

      {/* Design brief / errors, once requested. */}
      {bubbles.map((m) => {
        if (m.kind === 'design') {
          return (
            <MessageDesign
              key={m.id}
              status={m.status}
              content={m.content}
              path={m.path}
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

function SecondaryRow({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  sub?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-line/5"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-line/5 text-fg-faint ring-1 ring-line/10">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm text-fg">{label}</span>
      {sub && <span className="shrink-0 font-mono text-[11px] text-fg-faint">{sub}</span>}
      <CaretRight size={13} className="shrink-0 text-fg-faint/60" />
    </button>
  )
}
