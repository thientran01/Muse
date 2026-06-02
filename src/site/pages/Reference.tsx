import { Code, H1, H2, Kbd, Lead, P } from '../ui'

function Row({ k, d }: { k: string; d: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-stone-200 py-3 last:border-0 dark:border-stone-800">
      <div className="font-mono text-[13px] text-stone-800 dark:text-stone-200">{k}</div>
      <div className="text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">{d}</div>
    </div>
  )
}

export function Reference() {
  return (
    <article>
      <H1>Reference</H1>
      <Lead>Shortcuts, configuration, and the honest limitations.</Lead>

      <H2 id="shortcuts">Shortcuts</H2>
      <div className="mt-4 flex flex-col gap-2 text-[14px] text-stone-600 dark:text-stone-400">
        <div className="flex items-center gap-3"><Kbd>L</Kbd> Toggle Canvas Mode</div>
        <div className="flex items-center gap-3"><Kbd>Alt</Kbd> + click to select the container</div>
        <div className="flex items-center gap-3"><Kbd>⌘</Kbd> <Kbd>Z</Kbd> undo, <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>Z</Kbd> redo</div>
        <div className="flex items-center gap-3"><Kbd>Esc</Kbd> Deselect, then exit</div>
      </div>

      <H2 id="env">Environment</H2>
      <div className="mt-4">
        <Row k="MUSE_BACKEND" d={<><Code>claude-cli</Code> (subscription, default) or <Code>anthropic</Code> (API key) for chat.</>} />
        <Row k="ANTHROPIC_API_KEY" d="Needed for the API backend and the cheap element-observation reads." />
        <Row k="MUSE_MODEL" d={<>Chat model for the API backend. Defaults to <Code>claude-sonnet-4-6</Code>.</>} />
        <Row k="MUSE_DESIGN_MD" d={<>Path to a <a className="underline" href="#/features">DESIGN.md</a> brief so edits stay on-brand.</>} />
      </div>

      <H2 id="limits">Limitations</H2>
      <P>
        <strong>Development only.</strong> Muse runs against <Code>npm run dev</Code> rather than a
        deployed site, by design: it edits source instead of patching the live DOM, so the output is
        real, mergeable code.
      </P>
      <P>
        <strong>React 18.</strong> The fiber debug-source trick relies on a semi-private API that React
        19 removed, so React 18 is pinned on purpose.
      </P>
      <P>
        <strong>Built for utility classes.</strong> Canvas Mode edits Tailwind classes in your markup,
        so apps that route everything through CSS variables or styled-components give it less to grab.
        Broader styling support is on the way.
      </P>
    </article>
  )
}
