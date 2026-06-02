import { Callout, Kbd } from '../ui'

// Content is written inline (literal classes + literal text) on purpose: it makes
// every heading, paragraph, button, and card here selectable AND editable by Canvas
// Mode, since each maps to a real source node. The demo is the case study.
export function Overview() {
  return (
    <article>
      <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-[12px] font-medium text-stone-500 dark:border-stone-800 dark:bg-[#201d16] dark:text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-[#7f2f2f] dark:bg-[#e3a384]" />
        Live demo, edit anything on this page
      </span>

      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Design on the real thing.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-600 dark:text-stone-400">
        You already know how you want it to look. Muse lets you just go do it, right on your running
        app, then turns it into real code you can ship. Tailwind, JSX, all of it.
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <a
          href="#/install"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 dark:focus-visible:ring-[#e3a384]/50"
        >
          Get started
        </a>
        <a
          href="#/how"
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 dark:border-stone-700 dark:bg-[#201d16] dark:text-stone-200 dark:hover:bg-stone-800 dark:focus-visible:ring-[#e3a384]/50"
        >
          See how it works
        </a>
      </div>

      <Callout tone="try">
        <strong>This page is the playground.</strong> Press <Kbd>L</Kbd> to drop into Canvas Mode, then
        grab anything on this page and make it yours. Drag the spacing,
        recolor it, retype it. Changed your mind? Ctrl+Z undoes, Ctrl+Shift+Z redoes. Refresh to reset
        it all. Run Muse locally and these same moves rewrite your real source files.
      </Callout>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Canvas Mode is the whole idea
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Click an element, and a little toolbar shows up around it. Drag its padding. Scrub the font
        size. Swap the color. Double-click to fix the copy. Drag it above its sibling. No file hunting,
        no waiting on an engineer, no throwaway mockup. You are editing the actual thing, and Muse
        writes the actual code.
      </p>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        The best part: it is instant and free. Direct edits do not call a model. A drag is just a
        number changing, so Muse handles it itself.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        How it goes
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">1. Point</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Click anything in your running app. Muse finds the exact file and line it came from.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">2. Tweak</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Drag, scrub, recolor, retype. Or describe it in a sentence and let Muse propose a few takes.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">3. Real code</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Muse writes it to source and the app hot-reloads. Undo, redo, or revert whenever.
          </p>
        </div>
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Why not just use v0 or Cursor?
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Those start from a blank prompt or a file tree. Muse starts from the app you already have, the
        one running in front of you. And unlike a closed visual builder, what comes out is real source
        in your own repo, not a thing you are locked into.
      </p>

      <Callout>
        <strong>One honest note:</strong> this hosted demo is a playground. Edits live in your browser
        and reset on refresh, and the chat uses canned replies so it stays free. The real product
        writes code when you run it on your own app. See <a className="underline" href="#/install">Install</a>.
      </Callout>
    </article>
  )
}
