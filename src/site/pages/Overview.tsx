import { Callout, Card, H1, H2, Kbd, Lead, P, PrimaryButton, SecondaryButton } from '../ui'

export function Overview() {
  return (
    <article>
      <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] font-medium text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-[#7f2f2f]" />
        Live demo — edit anything on this page
      </span>

      <div className="mt-5">
        <H1>Point at your app. Say what you want. Get real code.</H1>
      </div>
      <Lead>
        Muse is a visual editing layer for design engineers and product designers. It loads as an
        overlay on your running React app, lets you point at any element, and turns a plain-English
        ask — or a direct drag — into a real, mergeable source-code change.
      </Lead>

      <div className="mt-7 flex flex-wrap gap-3">
        <PrimaryButton>Get started</PrimaryButton>
        <SecondaryButton>How it works</SecondaryButton>
      </div>

      <Callout tone="try">
        <strong>This page is the demo.</strong> Press <Kbd>L</Kbd> (or tap the button bottom-right) to
        enter Canvas Mode, then click any heading, button, or card here and restyle it — drag spacing,
        change colors, edit text. Your edits apply live and reset on refresh. Installed locally, the
        same edits rewrite your actual source files.
      </Callout>

      <H2 id="loop">The loop</H2>
      <P>
        You're looking at the rendered product and you know how you want it to feel — but acting on it
        means hunting down the file, finding the className, and tabbing back to check. Muse collapses
        that: you work from the running output, not the file tree.
      </P>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[13px] font-semibold text-[#7f2f2f]">1 · Point</div>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            Click any element in your running app. Muse maps it back to the exact source file and line.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[#7f2f2f]">2 · Say / drag</div>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            Describe the change, or scrub spacing, type, and color directly in Canvas Mode.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[#7f2f2f]">3 · Real code</div>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            Muse writes the change to your source. Vite hot-reloads. Undo, redo, and revert any time.
          </p>
        </Card>
      </div>

      <H2 id="different">How it's different</H2>
      <P>
        v0 and Lovable generate a <em>new</em> app from a blank prompt. Editor copilots work from the
        file tree and expect you to know what to open. Muse starts from the running product you already
        have — and unlike a closed visual builder, the output is real source in your own codebase.
      </P>

      <Callout>
        <strong>Heads up:</strong> this hosted demo is a playground — edits are in-browser only and
        reset on refresh, and the AI chat uses canned responses. The real product writes code when you
        run it locally against your own app. See <a className="underline" href="#/install">Install</a>.
      </Callout>
    </article>
  )
}
