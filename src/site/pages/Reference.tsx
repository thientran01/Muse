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
      <Lead>Gestures, configuration, and the honest limitations.</Lead>

      <H2 id="shortcuts">Gestures and shortcuts</H2>
      <P>
        Open Muse from the button in the corner, then the gesture decides the surface: a plain click
        shapes the element directly, and a Shift-click hands it to the chat partner.
      </P>
      <div className="mt-4 flex flex-col gap-2 text-[14px] text-stone-600 dark:text-stone-400">
        <div className="flex items-center gap-3"><Kbd>Click</Kbd> select and shape an element</div>
        <div className="flex items-center gap-3"><Kbd>⇧</Kbd> + click hand it to the chat partner</div>
        <div className="flex items-center gap-3"><Kbd>Alt</Kbd> + click step out to the parent</div>
        <div className="flex items-center gap-3"><Kbd>Double-click</Kbd> edit text in place</div>
        <div className="flex items-center gap-3"><Kbd>⌘</Kbd> <Kbd>Z</Kbd> undo, <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>Z</Kbd> redo</div>
        <div className="flex items-center gap-3"><Kbd>Esc</Kbd> deselect, then close Muse</div>
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
        <strong>Source under src/.</strong> Writes are bounded to your project's <Code>src/</Code>
        directory, so the components you want to edit need to live there. Next.js App Router projects can
        use the <Code>src/app</Code> layout.
      </P>
      <P>
        <strong>Styling.</strong> Canvas edits Tailwind utility classes, inline styles, CSS variables,
        CSS Modules, and styled-components or emotion. It picks the writer that matches your project, so
        most styling systems are covered rather than Tailwind alone.
      </P>
    </article>
  )
}
