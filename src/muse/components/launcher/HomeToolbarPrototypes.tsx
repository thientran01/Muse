import { useState, type ReactNode } from 'react'
import { ClockCounterClockwise, FileText, X } from '@phosphor-icons/react'
import { UfoIcon } from '../UfoIcon'

// ─────────────────────────────────────────────────────────────────────────────
// Home toolbar prototypes — presentation-only, for the gallery.
//
// Goal: replace the idle "stripped home" panel (too big, text-heavy) with a
// compact agentation-style icon toolbar — just the manta + past-proposals +
// design-system + close. The top banner already teaches "Shift-click for the
// agent", so the home doesn't explain anything; it's pure utility.
//
// Two open decisions, four prototypes to try them:
//   1A  history/design EXPAND the bar into the panel (in place)      ← leaning
//   1B  history/design open as a POPOVER above the bar (bar stays)
//   2A  the FAB GROWS into the toolbar (one object)                  ← leaning
//   2B  the FAB SWAPS to a separate toolbar pill
//
// None of these are wired into the live overlay yet — pick a direction here,
// then it gets built for real.
// ─────────────────────────────────────────────────────────────────────────────

const EASE = 'cubic-bezier(0.16,1,0.3,1)' // the project's one motion curve (Decision #21)

function IconBtn({
  label,
  accent = false,
  onClick,
  children,
}: {
  label: string
  accent?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 motion-reduce:active:scale-100 ${
        accent ? 'text-accent hover:bg-accent/10' : 'text-fg-faint hover:bg-line/10 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

// The toolbar pill itself: manta (identity) · past proposals · design system · X.
// `onMark` lets the manta act as a collapse control (used by the FAB-morph proto).
function Pill({
  onHistory,
  onDesign,
  onClose,
  markLabel = 'Muse',
  onMark,
}: {
  onHistory?: () => void
  onDesign?: () => void
  onClose?: () => void
  markLabel?: string
  onMark?: () => void
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-surface-soft p-1.5 shadow-xl shadow-black/30 ring-1 ring-line/10">
      <IconBtn label={markLabel} accent onClick={onMark}>
        <UfoIcon size={18} className="text-accent" />
      </IconBtn>
      <IconBtn label="Past proposals" onClick={onHistory}>
        <ClockCounterClockwise size={17} weight="bold" />
      </IconBtn>
      <IconBtn label="Design system" onClick={onDesign}>
        <FileText size={17} />
      </IconBtn>
      <span className="mx-0.5 h-5 w-px bg-line/15" />
      <IconBtn label="Close Muse" onClick={onClose}>
        <X size={16} weight="bold" />
      </IconBtn>
    </div>
  )
}

// A small panel shell for the expanded / popover states (mirrors the overlay's
// surface tokens; not the full MusePanel — just enough chrome to judge the feel).
function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="w-72 overflow-hidden rounded-2xl bg-surface shadow-2xl shadow-black/40 ring-1 ring-line/10">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
          <UfoIcon size={16} className="text-accent" />
          {title}
        </div>
        <button
          onClick={onClose}
          aria-label="Back"
          className="rounded-md p-1.5 text-fg-faint transition hover:bg-line/5 hover:text-fg"
        >
          <X size={15} />
        </button>
      </header>
      <div className="px-3 pb-3">{children}</div>
    </div>
  )
}

// Mock content — just enough to read as "past proposals" / "the design brief".
function HistoryBody() {
  const items = [
    { label: 'Made the hero heavier', when: '2m ago' },
    { label: 'Recolored the CTA to brand', when: '5m ago' },
    { label: 'Tightened the card padding', when: '12m ago' },
  ]
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <button
          key={it.label}
          className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-line/5"
        >
          <span className="text-xs font-medium text-fg">{it.label}</span>
          <span className="font-mono text-[10px] text-fg-faint">{it.when}</span>
        </button>
      ))}
    </div>
  )
}

function DesignBody() {
  const swatches = ['#7f2f2f', '#d4ff3a', '#0f1f1a', '#f5f1e8']
  return (
    <div className="rounded-xl bg-line/[0.03] p-3 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-fg">Muse</span>
        <span className="font-mono text-[10px] text-fg-faint">DESIGN.md</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {swatches.map((c) => (
          <span key={c} className="h-5 w-5 rounded-md ring-1 ring-line/20" style={{ backgroundColor: c }} />
        ))}
      </div>
      <p className="mt-2 text-xs leading-snug text-fg-faint">Inter · warm-white surface · brick accent</p>
    </div>
  )
}

// A tile: a themed (data-muse-ui) stage so the overlay tokens resolve, with the
// chrome anchored bottom-right the way it sits in the real overlay.
function Stage({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div
        data-muse-ui
        data-muse-canvas-host
        data-theme="dark"
        className="flex min-h-[260px] items-end justify-end rounded-2xl bg-[#0f1f1a] p-5 ring-1 ring-line/10"
      >
        {children}
      </div>
      <div>
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <p className="text-[11px] text-slate-400">{sub}</p>
      </div>
    </div>
  )
}

// ── 1A — expand into the panel (in place) ────────────────────────────────────
function ProtoExpand() {
  const [view, setView] = useState<'pill' | 'history' | 'design'>('pill')
  return (
    <Stage label="1A · Expand into the panel" sub="history / design replace the bar in place, then collapse back">
      {view === 'pill' ? (
        <div className="animate-muse-step motion-reduce:animate-none">
          <Pill onHistory={() => setView('history')} onDesign={() => setView('design')} onClose={() => {}} />
        </div>
      ) : (
        <div className="animate-muse-step origin-bottom-right motion-reduce:animate-none">
          <PanelShell title={view === 'history' ? 'Past proposals' : 'Design system'} onClose={() => setView('pill')}>
            {view === 'history' ? <HistoryBody /> : <DesignBody />}
          </PanelShell>
        </div>
      )}
    </Stage>
  )
}

// ── 1B — popover above the bar (bar stays) ───────────────────────────────────
function ProtoPopover() {
  const [pop, setPop] = useState<'none' | 'history' | 'design'>('none')
  const toggle = (p: 'history' | 'design') => setPop((cur) => (cur === p ? 'none' : p))
  return (
    <Stage label="1B · Popover off the bar" sub="bar stays put; history / design pop a card above it">
      <div className="flex flex-col items-end gap-2">
        {pop !== 'none' && (
          <div className="animate-muse-step origin-bottom-right motion-reduce:animate-none">
            <PanelShell title={pop === 'history' ? 'Past proposals' : 'Design system'} onClose={() => setPop('none')}>
              {pop === 'history' ? <HistoryBody /> : <DesignBody />}
            </PanelShell>
          </div>
        )}
        <Pill onHistory={() => toggle('history')} onDesign={() => toggle('design')} onClose={() => setPop('none')} />
      </div>
    </Stage>
  )
}

// ── 2A — the FAB grows into the toolbar (one object) ─────────────────────────
// Collapsed = the manta + "Muse" label (today's FAB). Click → the same pill
// widens, the label cross-fades to the icons. X collapses it back.
function ProtoFabMorph() {
  const [open, setOpen] = useState(false)
  return (
    <Stage label="2A · FAB grows into the toolbar" sub="one object: the FAB widens into the icons, X collapses it back">
      {open ? (
        <div
          className="origin-bottom-right"
          style={{ animation: `proto-grow 200ms ${EASE} both` }}
        >
          <Pill
            markLabel="Collapse"
            onMark={() => setOpen(false)}
            onHistory={() => {}}
            onDesign={() => {}}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface-soft px-5 py-3 text-sm font-medium text-fg shadow-xl shadow-black/30 ring-1 ring-line/10 transition hover:bg-surface-raised active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <UfoIcon size={18} className="text-accent" />
          Muse
        </button>
      )}
      {/* one-off keyframe for the grow; uses the project curve, <300ms */}
      <style>{`@keyframes proto-grow{from{opacity:.4;transform:scale(.9)}to{opacity:1;transform:scale(1)}}`}</style>
    </Stage>
  )
}

// ── 2B — the FAB swaps to a separate pill ────────────────────────────────────
// FAB ("Muse") turns Muse on; it's REPLACED by the toolbar (distinct object).
// X on the toolbar turns Muse off → the FAB returns.
function ProtoFabSwap() {
  const [on, setOn] = useState(false)
  return (
    <Stage label="2B · FAB swaps to a separate pill" sub="FAB toggles Muse on/off; the toolbar is its own object">
      {on ? (
        <div className="animate-muse-step motion-reduce:animate-none">
          <Pill onHistory={() => {}} onDesign={() => {}} onClose={() => setOn(false)} />
        </div>
      ) : (
        <button
          onClick={() => setOn(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface-soft px-5 py-3 text-sm font-medium text-fg shadow-xl shadow-black/30 ring-1 ring-line/10 transition hover:bg-surface-raised active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <UfoIcon size={18} className="text-accent" />
          Muse
        </button>
      )}
    </Stage>
  )
}

export function HomeToolbarPrototypes() {
  return (
    <section className="mx-auto mb-10 max-w-6xl space-y-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Home toolbar — prototypes</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Idle "home" reimagined as a compact icon toolbar (manta · past proposals · design system · close) — no
          text, agentation-style. Click around each tile. Two decisions: how history/design open (1A expand vs 1B
          popover) and how it relates to the FAB (2A grow vs 2B swap).
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ProtoExpand />
        <ProtoPopover />
        <ProtoFabMorph />
        <ProtoFabSwap />
      </div>
    </section>
  )
}
