import { useState, type ReactNode } from 'react'
import { ActiveTargetStrip } from './components/ActiveTargetStrip'
import { Composer } from './components/Composer'
import { MuseFab } from './components/MuseFab'
import { MuseHome } from './components/MuseHome'
import { MusePanel } from './components/MusePanel'
import { HoverHighlight, SelectBanner } from './components/SelectionOverlay'
import { MessageApplied } from './components/messages/MessageApplied'
import { MessageClarify } from './components/messages/MessageClarify'
import { MessageObservation } from './components/messages/MessageObservation'
import { MessageOptionSet } from './components/messages/MessageOptionSet'
import { MessageTargetHandoff } from './components/messages/MessageTargetHandoff'
import { MessageThinking } from './components/messages/MessageThinking'
import { MessageUser } from './components/messages/MessageUser'
import { UfoIcon } from './components/UfoIcon'
import { PropertiesPanel, type CanvasValues } from './components/canvas/PropertiesPanel'
import { ColorPicker } from './components/canvas/ColorPicker'
import type { CanvasElement } from './types'
import { fxEdits, fxElement, fxOriginals, fxQuestions, fxRationale } from './fixtures'
import type { ProposedOption, SelectedElement } from './types'

const noop = () => {}

// A realistic CanvasValues for the panel-density comparison: a text element with
// every section populated (size, type, all 3 colors, asymmetric padding, margin,
// gap) so each variant shows its FULL height — the worst case for overflow.
const fxPanelValues: CanvasValues = {
  padding: { top: 12, right: 20, bottom: 12, left: 20 },
  margin: { top: 32, right: 0, bottom: 0, left: 0 },
  gap: { row: 8, column: 8 },
  size: { width: 1006, height: 28 },
  type: { fontSize: 18, fontWeight: 700, lineHeight: 28, letterSpacing: 0 },
  rendersText: true,
  color: { text: '#0f1f1a', background: '#000000', border: '#e5e7eb' },
  colorThemed: { text: true, background: false, border: false },
}
// A fake ancestor chain so the breadcrumb renders (matches the screenshot path).
const fakeNode = (cls: string) => ({ getAttribute: () => cls }) as unknown as HTMLElement
const fxPanelChain: CanvasElement[] = [
  { key: 'k4', tag: 'h2', line: 1, column: 0, fileName: 'f', node: fakeNode('text-lg') },
  { key: 'k3', tag: 'section', line: 1, column: 0, fileName: 'f', node: fakeNode('mt-8') },
  { key: 'k2', tag: 'div', line: 1, column: 0, fileName: 'f', node: fakeNode('px-10') },
  { key: 'k1', tag: 'main', line: 1, column: 0, fileName: 'f', node: fakeNode('flex-1') },
  { key: 'k0', tag: 'div', line: 1, column: 0, fileName: 'f', node: fakeNode('min-h-screen') },
]

// Two design directions for the option-set demo (hover-to-preview cards).
const fxOptions: ProposedOption[] = [
  {
    id: 'o1',
    label: 'Refined',
    description: 'Lighter weight, larger scale, more breathing room — the Apple / Stripe register.',
    edits: fxEdits,
  },
  {
    id: 'o2',
    label: 'Bolder',
    description: 'Heavier and tighter — more anchor, more presence.',
    edits: [
      {
        fileName: 'src/demo/Hero.tsx',
        newContent: `      <section className="mx-auto max-w-3xl px-6 py-32 text-center">
        <h1 className="text-6xl font-extrabold tracking-tighter">
          Build faster than ever
        </h1>`,
      },
    ],
  },
]
const fxElement2: SelectedElement = {
  fileName: 'src/demo/CTA.tsx',
  line: 12,
  tag: 'button',
  classNames: 'rounded-lg bg-slate-900 px-6 py-3',
  text: 'Get started',
  key: 'src/demo/CTA.tsx:12:6:button',
}

// A single animation tile. The inner surface is wrapped in `data-muse-ui` +
// `data-theme` so Muse's CSS tokens resolve (muse.css scopes --muse-accent /
// --muse-surface to [data-muse-ui]); without that wrapper those vars are
// undefined and the icon falls back to the browser default (the stray blue).
// `bg-surface` + `text-accent` + `ring-line/10` are the exact tokens the real
// FAB uses, so each tile renders the mark precisely as it ships — and the eyes
// (filled with --muse-surface) read as true cut-outs against the tile.
function AnimCell({
  label,
  sub,
  theme,
  children,
}: {
  label: string
  sub?: string
  theme: 'dark' | 'light'
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div
        data-muse-ui
        data-muse-canvas-host
        data-theme={theme}
        className="flex min-h-[140px] items-center justify-center rounded-2xl bg-surface p-6 text-accent ring-1 ring-line/10"
      >
        {children}
      </div>
      <div>
        <p className="text-xs font-medium text-slate-600">{label}</p>
        {sub ? <p className="text-[11px] text-slate-400">{sub}</p> : null}
      </div>
    </div>
  )
}

// One theme's worth of the mark's motion profiles. `idle` settles to rest by
// design (loop stops after ~2.6s), so labels note it; the parent's Replay
// remounts everything (via the `gen` key) to restart idle and resync swim.
function ThemeRow({ theme, gen }: { theme: 'dark' | 'light'; gen: number }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {theme === 'dark' ? 'Dark mode' : 'Light mode'}
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AnimCell theme={theme} label="Idle — settles to rest" sub="loading=false · decays then stops">
          <UfoIcon key={`idle-lg-${theme}-${gen}`} size={72} loading={false} className="text-accent" />
        </AnimCell>
        <AnimCell theme={theme} label="Swim — thinking" sub="loading · runs continuously">
          <UfoIcon key={`swim-lg-${theme}-${gen}`} size={72} loading className="text-accent" />
        </AnimCell>
        <AnimCell theme={theme} label="Idle @ actual size" sub="18px — as it ships">
          <UfoIcon key={`idle-sm-${theme}-${gen}`} size={18} loading={false} className="text-accent" />
        </AnimCell>
        <AnimCell theme={theme} label="Swim @ actual size" sub="18px — as it ships">
          <UfoIcon key={`swim-sm-${theme}-${gen}`} size={18} loading className="text-accent" />
        </AnimCell>
      </div>
    </div>
  )
}

// Showcase of the mark's motion profiles in both themes, styled with the real
// Muse tokens (see UfoIcon's PROFILE).
function IconAnimations() {
  const [gen, setGen] = useState(0)
  return (
    <section className="mx-auto mb-10 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          The mark — animation states
        </h2>
        <button
          onClick={() => setGen((g) => g + 1)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
        >
          ↻ Replay
        </button>
      </div>
      <ThemeRow theme="dark" gen={gen} />
      <ThemeRow theme="light" gen={gen} />
    </section>
  )
}

// One panel variant on a themed canvas-like backdrop, so it renders with the real
// Muse tokens (--muse-surface / --muse-accent are scoped to [data-muse-ui]) in the
// requested theme. The backdrop mimics the host page behind the floating panel.
function PanelCell({ label, sub, theme, children }: { label: string; sub: string; theme: 'dark' | 'light'; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div
        data-muse-ui
        data-muse-canvas-host
        data-theme={theme}
        className={`flex min-h-[360px] items-start justify-center rounded-2xl p-5 ring-1 ring-line/10 ${theme === 'dark' ? 'bg-[#0f1f1a]' : 'bg-[#f5f1e8]'}`}
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

// The live properties panel (collapsible sections) in both themes, fed a
// worst-case element (text, every section populated) so its full extent shows.
function PanelDensity() {
  return (
    <section className="mx-auto mb-10 max-w-6xl space-y-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Properties panel</h2>
        <p className="mt-1 text-sm text-slate-500">Collapsible sections (independent toggles) with a smart default-open + persistence across selections. The shell caps at 70vh and scrolls, so it never clips when the element sits low on screen.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(['dark', 'light'] as const).map((theme) => (
          <PanelCell key={theme} label={theme === 'dark' ? 'Dark mode' : 'Light mode'} sub="click a section header to expand/collapse" theme={theme}>
            <PropertiesPanel values={fxPanelValues} chain={fxPanelChain} selectedKey="k4" onPick={noop} onPreview={noop} onCommit={noop} />
          </PanelCell>
        ))}
      </div>
    </section>
  )
}

// The custom color picker, both themes, in a Muse-styled popover-ish card with a
// live preview swatch so you can see preview/commit firing. Brand swatches are the
// demo's DESIGN.md palette.
const fxBrandSwatches = ['#d4ff3a', '#ff6b35', '#0f1f1a', '#f5f1e8', '#1a2e26']
function ColorPickerCell({ theme }: { theme: 'dark' | 'light' }) {
  const [color, setColor] = useState('#ff6b35')
  return (
    <PanelCell label={theme === 'dark' ? 'Dark mode' : 'Light mode'} sub="SV square · hue · eyedropper · hex/RGB · contrast check · brand swatches" theme={theme}>
      <div className="w-[224px] rounded-xl bg-surface/95 p-3 shadow-xl ring-1 ring-line/10 backdrop-blur">
        {/* contrastAgainst demos the WCAG badge — here, the text color vs a card bg. */}
        <ColorPicker value={color} swatches={fxBrandSwatches} contrastAgainst={theme === 'dark' ? '#0f1f1a' : '#f5f1e8'} onPreview={setColor} onCommit={setColor} />
      </div>
    </PanelCell>
  )
}

function ColorPickerSection() {
  return (
    <section className="mx-auto mb-10 max-w-6xl space-y-6">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Color picker (custom)</h2>
        <p className="mt-1 text-sm text-slate-500">Replaces the native OS color input — SV square + hue slider + hex/RGB fields + DESIGN.md brand swatches, all in Muse styling.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ColorPickerCell theme="dark" />
        <ColorPickerCell theme="light" />
      </div>
    </section>
  )
}

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      <div className="relative flex min-h-[140px] items-start justify-center rounded-2xl border border-slate-200 bg-slate-100 p-6">
        {children}
      </div>
    </section>
  )
}

// Wraps a bubble preview in a slim panel-like container so it reads the way
// it would in the real overlay. Not the full MusePanel — just chrome.
function ThreadFrame({ target, children }: { target: SelectedElement; children: ReactNode }) {
  return (
    <MusePanel onClose={noop}>
      <ActiveTargetStrip elements={[target]} mock />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">{children}</div>
      <Composer value="" onChange={noop} onSubmit={noop} loading={false} />
    </MusePanel>
  )
}

/**
 * Dev-only showcase of every Muse UI state, rendered with fixtures.
 * Open at /?gallery. Edit the components in src/muse/components/ — changes
 * show up here AND in the live overlay.
 */
export function MuseGallery() {
  const [answers, setAnswers] = useState<Record<number, string>>({ 0: 'Minimal & sophisticated' })

  return (
    <div className="min-h-screen bg-slate-50 px-8 py-10 font-sans text-slate-900">
      <header className="mx-auto mb-10 max-w-6xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <UfoIcon size={22} className="text-accent" /> Muse — UI states
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Every component and step of the flow, with mock data. Edit the components in{' '}
          <code className="rounded bg-slate-200 px-1">src/muse/components/</code> and they update
          here and in the live overlay.
        </p>
      </header>

      <PanelDensity />

      <ColorPickerSection />

      <IconAnimations />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Cell title="FAB — idle">
          <MuseFab active={false} onToggle={noop} />
        </Cell>
        <Cell title="FAB — select mode">
          <MuseFab active onToggle={noop} />
        </Cell>
        <Cell title="Select banner">
          <SelectBanner />
        </Cell>

        <Cell title="Hover highlight">
          <div className="relative h-24 w-48 rounded bg-white ring-1 ring-slate-200">
            <HoverHighlight rect={{ top: 8, left: 8, width: 176, height: 80 }} />
          </div>
        </Cell>
        <Cell title="Panel — home (no target yet)">
          <MusePanel mock onClose={noop}>
            <MuseHome onSelect={noop} onShowDesign={noop} bubbles={[]} onGenerateDesign={noop} />
          </MusePanel>
        </Cell>

        <Cell title="Composer — empty">
          <div className="w-[380px] rounded-2xl bg-surface ring-1 ring-line/10">
            <Composer value="" onChange={noop} onSubmit={noop} loading={false} />
          </div>
        </Cell>
        <Cell title="Composer — typing">
          <div className="w-[380px] rounded-2xl bg-surface ring-1 ring-line/10">
            <Composer value="make this feel more premium" onChange={noop} onSubmit={noop} loading={false} />
          </div>
        </Cell>

        <Cell title="Thread — observation opener (LLM read landed)">
          <ThreadFrame target={fxElement2}>
            <MessageObservation
              observation="That bg-slate-900 fill is doing the heavy lifting — the padding could match its confidence."
              chips={['Make it pop', 'Try a different color', 'Adjust the padding']}
              pending={false}
              onPick={noop}
            />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — observation opener (heuristic, pending)">
          <ThreadFrame target={fxElement2}>
            <MessageObservation
              observation="It's got a filled treatment — color and padding decide how hard it pulls."
              chips={['Make it pop', 'Try a different color', 'Adjust the padding']}
              pending
              onPick={noop}
            />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — empty + user message">
          <ThreadFrame target={fxElement}>
            <MessageUser text="make this feel more premium" />
            <MessageThinking />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — clarify (active)">
          <ThreadFrame target={fxElement}>
            <MessageUser text="make this feel more premium" />
            <MessageClarify
              questions={fxQuestions}
              answers={{}}
              onSelect={noop}
              onContinue={noop}
              loading={false}
              allAnswered={false}
              active
            />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — clarify (answered, inactive)">
          <ThreadFrame target={fxElement}>
            <MessageUser text="make this feel more premium" />
            <MessageClarify
              questions={fxQuestions}
              answers={answers}
              onSelect={(qi, label) => setAnswers((a) => ({ ...a, [qi]: label }))}
              onContinue={noop}
              loading={false}
              allAnswered
              active={false}
            />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — option set (active, hover to preview)">
          <ThreadFrame target={fxElement}>
            <MessageUser text="make this feel more premium" />
            <MessageOptionSet
              options={fxOptions}
              originals={fxOriginals}
              rationale={fxRationale}
              loading={false}
              onApprove={noop}
              onPreview={noop}
              onPreviewEnd={noop}
              active
            />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — applied">
          <ThreadFrame target={fxElement}>
            <MessageUser text="make this feel more premium" />
            <MessageOptionSet
              options={fxOptions}
              originals={fxOriginals}
              rationale={fxRationale}
              loading={false}
              onApprove={noop}
              onPreview={noop}
              onPreviewEnd={noop}
              active={false}
            />
            <MessageApplied fileCount={fxEdits.length} rationale="" />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — target handoff mid-conversation">
          <ThreadFrame target={fxElement2}>
            <MessageUser text="punch up the heading" />
            <MessageTargetHandoff target={fxElement2} />
            <MessageUser text="now this button — make it pop" />
            <MessageThinking />
          </ThreadFrame>
        </Cell>

        <Cell title="Thread — error">
          <ThreadFrame target={fxElement}>
            <MessageUser text="..." />
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20">
              Muse did not return an action. Try rephrasing.
            </p>
          </ThreadFrame>
        </Cell>
      </div>
    </div>
  )
}
