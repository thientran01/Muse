import { Code, H1, H2, Kbd, Lead, P } from '../ui'

function Row({ k, d }: { k: string; d: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-zinc-200 py-3 last:border-0">
      <div className="font-mono text-[13px] text-zinc-800">{k}</div>
      <div className="text-[14px] leading-relaxed text-zinc-600">{d}</div>
    </div>
  )
}

export function Reference() {
  return (
    <article>
      <H1>Reference</H1>
      <Lead>Configuration, shortcuts, and the honest limitations.</Lead>

      <H2 id="shortcuts">Shortcuts</H2>
      <div className="mt-4 flex flex-col gap-2 text-[14px] text-zinc-600">
        <div className="flex items-center gap-3"><Kbd>L</Kbd> Toggle Canvas Mode</div>
        <div className="flex items-center gap-3"><Kbd>Alt</Kbd> + click — select the container</div>
        <div className="flex items-center gap-3"><Kbd>⌘</Kbd> <Kbd>Z</Kbd> Undo · <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>Z</Kbd> Redo</div>
        <div className="flex items-center gap-3"><Kbd>Esc</Kbd> Deselect, then exit</div>
      </div>

      <H2 id="env">Environment</H2>
      <div className="mt-4">
        <Row k="MUSE_BACKEND" d={<><Code>claude-cli</Code> (subscription, default) or <Code>anthropic</Code> (API key) for chat.</>} />
        <Row k="ANTHROPIC_API_KEY" d="Required for the API backend and for the cheap element-observation reads." />
        <Row k="MUSE_MODEL" d={<>Chat model for the API backend (default <Code>claude-sonnet-4-6</Code>).</>} />
        <Row k="MUSE_DESIGN_MD" d="Optional path to a DESIGN.md brief injected into chat so edits stay on-brand." />
      </div>

      <H2 id="limits">Limitations</H2>
      <P>
        <strong>Dev-mode only.</strong> Muse runs against <Code>npm run dev</Code>, not a deployed site
        — by design, since it edits source, not the live DOM, so you get real code instead of throwaway
        hacks.
      </P>
      <P>
        <strong>React 18.</strong> The fiber debug-source trick uses a semi-private API that React 19
        removes, so React 18 is pinned on purpose.
      </P>
      <P>
        <strong>Best with utility classes.</strong> Canvas Mode edits Tailwind classes in the markup
        today. Apps that route everything through CSS variables or styled-components give it less to act
        on directly — broader styling support is on the roadmap.
      </P>
    </article>
  )
}
