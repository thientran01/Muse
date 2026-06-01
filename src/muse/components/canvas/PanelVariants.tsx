// ============================================================
//  Properties-panel density PROTOTYPES — gallery-only, not yet wired live.
// ------------------------------------------------------------
//  Three ways to make the canvas properties panel less overwhelming while
//  keeping every control. All reuse the SAME section atoms from
//  PropertiesPanel.tsx (Breadcrumb / Size / Type / Color / Spacing / Gap), so
//  they're faithful to the real thing — only the disclosure model differs.
//  Compared side-by-side in MuseGallery (light + dark). Pick one to ship; this
//  file is then deleted and the winner folded into PropertiesPanel.
// ============================================================
import { useState } from 'react'
import type { CanvasElement, StyleMutation } from '../../types'
import {
  Breadcrumb,
  ColorFields,
  GapFields,
  Legend,
  PanelShell,
  SectionLabel,
  SizeFields,
  SpacingFields,
  TypeFields,
  divider,
  type CanvasValues,
} from './PropertiesPanel'

type EditProps = {
  onPreview: (m: StyleMutation[]) => void
  onCommit: (m: StyleMutation[]) => void
}
type VariantProps = {
  values: CanvasValues
  chain: CanvasElement[]
  selectedKey: string
  onPick: (c: CanvasElement) => void
} & EditProps

// ── Variant A — Segmented tabs ──────────────────────────────────────────────
// One category at a time: Layout (size + spacing + gap) · Type · Color. Smallest
// resting height; never tall enough to clip. The Type tab is hidden on elements
// that don't render text. This is the Figma / browser-devtools pattern.
type Tab = 'layout' | 'type' | 'color'

function SegTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active ? 'bg-surface text-fg shadow-sm ring-1 ring-line/10' : 'text-fg-faint hover:text-fg-muted'
      }`}
    >
      {children}
    </button>
  )
}

export function PanelTabs({ values, chain, selectedKey, onPick, onPreview, onCommit }: VariantProps) {
  const tabs: Tab[] = values.rendersText ? ['layout', 'type', 'color'] : ['layout', 'color']
  const [tab, setTab] = useState<Tab>('layout')
  const active = tabs.includes(tab) ? tab : 'layout'
  return (
    <PanelShell>
      <Breadcrumb chain={chain} selectedKey={selectedKey} onPick={onPick} />
      <div className="flex gap-0.5 rounded-lg bg-line/10 p-0.5">
        <SegTab active={active === 'layout'} onClick={() => setTab('layout')}>Layout</SegTab>
        {values.rendersText && <SegTab active={active === 'type'} onClick={() => setTab('type')}>Type</SegTab>}
        <SegTab active={active === 'color'} onClick={() => setTab('color')}>Color</SegTab>
      </div>

      {active === 'layout' && (
        <>
          <Legend hasGap={!!values.gap} />
          <SizeFields values={values} onPreview={onPreview} onCommit={onCommit} />
          {divider}
          <SpacingFields values={values} onPreview={onPreview} onCommit={onCommit} />
          {values.gap && (<>{divider}<GapFields values={values} onPreview={onPreview} onCommit={onCommit} /></>)}
        </>
      )}
      {active === 'type' && values.rendersText && <TypeFields values={values} onPreview={onPreview} onCommit={onCommit} />}
      {active === 'color' && <ColorFields values={values} onPreview={onPreview} onCommit={onCommit} />}
    </PanelShell>
  )
}

// ── Variant B — Collapsible sections ────────────────────────────────────────
// Every section is listed but collapsed to its header; click to expand. Smart
// default-open: a text element opens Type, a container opens Layout. Everything
// is visible at a glance; nothing is a hidden category.
type SectionKey = 'size' | 'type' | 'color' | 'spacing' | 'gap'

function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <SectionLabel>{label}</SectionLabel>
        <span className={`text-[10px] text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && children}
    </div>
  )
}

export function PanelAccordion({ values, chain, selectedKey, onPick, onPreview, onCommit }: VariantProps) {
  // One section open at a time (an accordion). Default: text → Type, else Size.
  const [open, setOpen] = useState<SectionKey>(values.rendersText ? 'type' : 'size')
  const toggle = (k: SectionKey) => setOpen((cur) => (cur === k ? ('' as SectionKey) : k))
  return (
    <PanelShell>
      <Breadcrumb chain={chain} selectedKey={selectedKey} onPick={onPick} />
      <Legend hasGap={!!values.gap} />
      <Disclosure label="Size" open={open === 'size'} onToggle={() => toggle('size')}>
        <SizeFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Disclosure>
      {divider}
      {values.rendersText && (
        <>
          <Disclosure label="Type" open={open === 'type'} onToggle={() => toggle('type')}>
            <TypeFields values={values} onPreview={onPreview} onCommit={onCommit} />
          </Disclosure>
          {divider}
        </>
      )}
      <Disclosure label="Color" open={open === 'color'} onToggle={() => toggle('color')}>
        <ColorFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Disclosure>
      {divider}
      <Disclosure label="Spacing" open={open === 'spacing'} onToggle={() => toggle('spacing')}>
        <SpacingFields values={values} onPreview={onPreview} onCommit={onCommit} />
      </Disclosure>
      {values.gap && (
        <>
          {divider}
          <Disclosure label="Gap" open={open === 'gap'} onToggle={() => toggle('gap')}>
            <GapFields values={values} onPreview={onPreview} onCommit={onCommit} />
          </Disclosure>
        </>
      )}
    </PanelShell>
  )
}

// ── Variant C — Compact-first + More ────────────────────────────────────────
// Leans on the on-canvas handles (size + spacing are draggable on the element
// itself). Resting state shows only what the canvas CAN'T give you quickly: Type
// + Color. A "More" toggle reveals the numeric Size / Spacing / Gap fields for
// precise entry. Most minimal resting panel.
export function PanelCompact({ values, chain, selectedKey, onPick, onPreview, onCommit }: VariantProps) {
  const [more, setMore] = useState(false)
  return (
    <PanelShell>
      <Breadcrumb chain={chain} selectedKey={selectedKey} onPick={onPick} />
      {values.rendersText && <TypeFields values={values} onPreview={onPreview} onCommit={onCommit} />}
      {values.rendersText && divider}
      <ColorFields values={values} onPreview={onPreview} onCommit={onCommit} />
      {divider}
      <button
        onClick={() => setMore((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[11px] font-medium text-fg-muted"
      >
        <span>Size &amp; spacing</span>
        <span className="flex items-center gap-1 text-[10px] text-fg-faint">
          {more ? 'Less' : 'More'}
          <span className={`transition-transform ${more ? 'rotate-90' : ''}`}>›</span>
        </span>
      </button>
      {!more && <p className="-mt-0.5 text-[10px] leading-snug text-fg-faint">Drag the element’s edges &amp; corners on canvas, or open for exact values.</p>}
      {more && (
        <>
          <Legend hasGap={!!values.gap} />
          <SizeFields values={values} onPreview={onPreview} onCommit={onCommit} />
          {divider}
          <SpacingFields values={values} onPreview={onPreview} onCommit={onCommit} />
          {values.gap && (<>{divider}<GapFields values={values} onPreview={onPreview} onCommit={onCommit} /></>)}
        </>
      )}
    </PanelShell>
  )
}
