import { useState, type ReactNode } from 'react'
import { BoundingBox, CaretRight, FileText, X } from '@phosphor-icons/react'
import { UfoIcon } from '../UfoIcon'

// ─────────────────────────────────────────────────────────────────────────────
// Launcher consolidation — three exploratory variants
//
// Goal: the agent (chat) and Canvas (direct manipulation) should read as EQUAL
// co-primary features, not a lead + a satellite. DESIGN.md is a quieter utility
// in every variant — a reference you peek at, not a mode you work in.
//
// These are presentation-only: each takes onAgent / onCanvas / onDesign and is
// dropped into the gallery so the three can be compared side by side before one
// is wired into MuseOverlay. None of them touch the live overlay yet.
// ─────────────────────────────────────────────────────────────────────────────

export type LauncherActions = {
  onAgent: () => void
  onCanvas: () => void
  onDesign: () => void
}

// The two co-primary features share one icon vocabulary across all variants so
// the comparison is about LAYOUT, not iconography: the manta mark = the agent,
// a bounding box = Canvas. DESIGN.md is always a plain document glyph, muted.
const AgentMark = ({ size = 18 }: { size?: number }) => <UfoIcon size={size} className="text-accent" />
const CanvasMark = ({ size = 18 }: { size?: number }) => (
  <BoundingBox size={size} weight="bold" className="text-accent" />
)

// ── Variant A — Unified panel menu ───────────────────────────────────────────
// One "Muse" FAB opens a panel; agent + Canvas are two equal cards (identical
// geometry, both accent-iconed → peers), DESIGN.md a quiet footer row. Cleanest
// consolidation; both core actions cost two clicks (open → pick).
export function LauncherUnified({ onAgent, onCanvas, onDesign }: LauncherActions) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 overflow-hidden rounded-2xl bg-surface/95 shadow-2xl shadow-black/40 ring-1 ring-line/10 backdrop-blur-xl animate-muse-step motion-reduce:animate-none">
          <header className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-fg">
              <UfoIcon size={18} className="text-accent" />
              Muse
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md p-1.5 text-fg-faint transition hover:bg-line/5 hover:text-fg"
            >
              <X size={15} />
            </button>
          </header>
          <div className="space-y-2 px-3 pb-3">
            <MenuCard
              icon={<AgentMark />}
              title="Ask Muse"
              sub="Describe a change in words"
              onClick={() => {
                setOpen(false)
                onAgent()
              }}
            />
            <MenuCard
              icon={<CanvasMark />}
              title="Canvas"
              sub="Edit layout & spacing directly"
              onClick={() => {
                setOpen(false)
                onCanvas()
              }}
            />
            {/* Quiet utility — no card shell, muted, filename trailing. */}
            <button
              onClick={() => {
                setOpen(false)
                onDesign()
              }}
              className="group mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-line/5"
            >
              <FileText size={15} className="text-fg-faint" />
              <span className="flex-1 text-xs font-medium text-fg-muted">Design system</span>
              <span className="font-mono text-[10px] text-fg-faint">DESIGN.md</span>
            </button>
          </div>
        </div>
      )}
      <Fab onClick={() => setOpen((v) => !v)}>
        <UfoIcon size={18} className="text-accent" />
        Muse
      </Fab>
    </div>
  )
}

// Equal-weight card shared by the agent + Canvas entries: identical box, both
// accent-iconed, only the label differentiates. (DESIGN.md does NOT use this.)
function MenuCard({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: ReactNode
  title: string
  sub: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl bg-line/[0.03] p-3 text-left ring-1 ring-line/10 transition hover:bg-line/[0.06] active:scale-[0.99] motion-reduce:active:scale-100"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="block text-xs leading-snug text-fg-faint">{sub}</span>
      </span>
      <CaretRight size={15} className="shrink-0 text-fg-faint/50 transition group-hover:translate-x-0.5" />
    </button>
  )
}

// ── Variant B — Split / segmented FAB ────────────────────────────────────────
// Two equal halves in one pill (Ask Muse | Canvas), each one click — no panel.
// DESIGN.md trails as a small, quieter icon button so it's reachable without
// competing with the two heroes.
export function LauncherSplit({ onAgent, onCanvas, onDesign }: LauncherActions) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-stretch overflow-hidden rounded-full bg-surface-soft shadow-xl shadow-black/30 ring-1 ring-line/10">
        <button
          onClick={onAgent}
          className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-fg transition hover:bg-surface-raised active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <AgentMark />
          Ask Muse
        </button>
        <div className="my-2 w-px bg-line/15" />
        <button
          onClick={onCanvas}
          className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-fg transition hover:bg-surface-raised active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <CanvasMark />
          Canvas
        </button>
      </div>
      <button
        onClick={onDesign}
        title="Design system — DESIGN.md"
        aria-label="Design system"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-soft text-fg-faint shadow-xl shadow-black/30 ring-1 ring-line/10 transition hover:bg-surface-raised hover:text-fg active:scale-[0.97] motion-reduce:active:scale-100"
      >
        <FileText size={17} />
      </button>
    </div>
  )
}

// ── Variant C — Launcher rail (hybrid) ───────────────────────────────────────
// A compact horizontal icon rail that expands sideways on hover, each icon
// growing a label inline. One pill, equal items, one click once expanded.
// DESIGN.md is the muted item at the trailing end.
export function LauncherRail({ onAgent, onCanvas, onDesign }: LauncherActions) {
  return (
    <div className="group flex items-center gap-0.5 rounded-full bg-surface-soft p-1.5 shadow-xl shadow-black/30 ring-1 ring-line/10">
      <RailItem icon={<AgentMark />} label="Ask Muse" onClick={onAgent} />
      <RailItem icon={<CanvasMark />} label="Canvas" onClick={onCanvas} />
      <RailItem icon={<FileText size={16} className="text-fg-faint" />} label="DESIGN.md" muted onClick={onDesign} />
    </div>
  )
}

function RailItem({
  icon,
  label,
  onClick,
  muted = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center rounded-full px-1.5 py-1.5 transition hover:bg-line/5 active:scale-[0.97] motion-reduce:active:scale-100 ${
        muted ? 'text-fg-muted' : 'text-fg'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
      {/* Label is width-collapsed at rest; the rail's group-hover springs it open
          sideways so the whole pill widens into a labeled toolbar. */}
      <span
        className={`max-w-0 overflow-hidden whitespace-nowrap font-medium opacity-0 transition-all duration-200 ease-out group-hover:max-w-[140px] group-hover:pr-1.5 group-hover:opacity-100 ${
          muted ? 'text-xs' : 'text-sm'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

// Shared FAB shell (matches the shipping MuseFab geometry/tokens).
function Fab({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface-soft px-5 py-3 text-sm font-medium text-fg shadow-xl shadow-black/30 ring-1 ring-line/10 transition hover:bg-surface-raised active:scale-[0.97] motion-reduce:active:scale-100"
    >
      {children}
    </button>
  )
}
