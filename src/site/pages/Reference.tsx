import { Code, H1, H2, Kbd, Lead, P } from '../ui'

export function Reference() {
  return (
    <article>
      <H1>Reference</H1>
      <Lead>Gestures, configuration, and the honest limitations.</Lead>

      <H2 id="shortcuts">Gestures and shortcuts</H2>
      <P>
        Open Muse from the button in the corner — or press <Kbd>R</Kbd> to toggle it on and off — then
        click any element to select and shape it directly.
      </P>
      <div className="mt-4 flex flex-col gap-2 text-[14px] text-stone-600 dark:text-stone-400">
        <div className="flex items-center gap-3"><Kbd>R</Kbd> toggle Muse on and off</div>
        <div className="flex items-center gap-3"><Kbd>Click</Kbd> select and shape an element</div>
        <div className="flex items-center gap-3"><Kbd>Alt</Kbd> + click step out to the parent</div>
        <div className="flex items-center gap-3"><Kbd>Double-click</Kbd> edit text in place</div>
        <div className="flex items-center gap-3"><Kbd>Drag</Kbd> an element among its siblings to reorder it — scroll while dragging to reach a spot off-screen</div>
        <div className="flex items-center gap-3"><Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd> + <Kbd>↑</Kbd><Kbd>↓</Kbd> reorder the selected element by keyboard</div>
        <div className="flex items-center gap-3"><Kbd>⌘</Kbd> <Kbd>Z</Kbd> undo, <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>Z</Kbd> redo</div>
        <div className="flex items-center gap-3"><Kbd>Esc</Kbd> deselect, then close Muse</div>
      </div>

      <H2 id="config">Configuration</H2>
      <P>
        There is none. Canvas needs no API key and no environment variables — every edit is a
        deterministic source rewrite. The toolbar's <strong>Design tokens</strong> popover lists your
        host's CSS custom properties (<Code>--c-*</Code>) so you can retune any of them in place.
      </P>

      <H2 id="share">Share changes</H2>
      <P>
        The paper-plane button on the toolbar lists what the session changed, file by file, with the
        edit labels that landed there. Undoing an edit removes it from the list.{' '}
        <strong>Share changes</strong> turns that list into a pull request: a commit of exactly those
        files on a fresh <Code>muse/*</Code> branch, pushed and opened for an engineer to review. No
        git knowledge needed.
      </P>
      <P>
        It never switches your branch and never touches other edits in your working tree. Sharing
        again after more edits adds to the same branch and the pull request updates in place. Needs{' '}
        <Code>git</Code> on the machine; uses the <Code>gh</Code> CLI for the pull request when
        present, and falls back to a GitHub compare link without it. When something is missing the
        panel says so plainly instead of offering a button that would fail.
      </P>

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
        CSS Modules, and styled-components or emotion. It picks the writer that matches each element, so
        most styling systems are covered rather than Tailwind alone; the{' '}
        <a
          href="#/styling"
          className="rounded font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:focus-visible:ring-[#e3a384]/50"
        >
          Styling page
        </a>{' '}
        demos every one of them live.
      </P>
    </article>
  )
}
