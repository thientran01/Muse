import { Callout } from '../ui'

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
        A visual editor for your running React app.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-600 dark:text-stone-400">
        Point at an element in your running app, shape it the way you would in a design tool, and Muse
        writes the edit back to your source as real, mergeable code.
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <a
          href="#/install"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition duration-150 ease-out-strong hover:bg-stone-700 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 motion-reduce:active:scale-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 dark:focus-visible:ring-[#e3a384]/50"
        >
          Get started
        </a>
        <a
          href="#/how"
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition duration-150 ease-out-strong hover:bg-stone-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7f2f2f]/50 motion-reduce:active:scale-100 dark:border-stone-700 dark:bg-[#201d16] dark:text-stone-200 dark:hover:bg-stone-800 dark:focus-visible:ring-[#e3a384]/50"
        >
          See how it works
        </a>
      </div>

      <Callout tone="try">
        <strong>This page is the playground.</strong> Open Muse from the button in the corner, then click
        anything on this page to shape it: drag the spacing, recolor a button, rewrite text, then step back through it with Ctrl+Z and Ctrl+Shift+Z. Hold Shift and click instead
        to hand an element to the chat partner. Edits live in your browser and clear when you refresh. Run
        Muse locally and the same moves rewrite your source files.
      </Callout>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Canvas
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Click an element and a small toolbar wraps around it. You drag its padding, scrub the font
        size, pick a new color, double-click to rewrite the text, or drag it past a sibling to reorder.
        Every move maps to that element in your source and writes straight back to it, so you stay in
        the running product the whole time and leave with the real code.
      </p>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        A direct edit is a known transform, so Muse resolves it without a model call. A drag is a number
        changing, so it lands instantly and costs nothing.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Or describe it
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Some changes read better as a sentence than a drag. Shift-click an element to hand it to the chat
        partner, tell Muse to make a card feel warmer and less boxy, and it answers with a few directions,
        each a real edit you can preview in place before committing to one. The agent carries intent and
        ambiguity, while Canvas carries the precise, hands-on work.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Edit loop
      </h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">1. Point</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Click any element in your running app and Muse traces it to the exact file and line it came
            from.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">2. Edit</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Shape it by hand with Canvas, or Shift-click to describe the change and pick from a few
            directions Muse drafts.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <div className="text-[13px] font-semibold text-[#7f2f2f] dark:text-[#e3a384]">3. Real code</div>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Muse writes the change to source and the app hot-reloads. Undo, redo, and revert stay open
            the whole session.
          </p>
        </div>
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        The approach
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Most tools start from a prompt or a file tree. Muse starts from the running product, the screen
        in front of you, and edits the source behind it. What you get out is your own code in your own
        repo, ready to commit.
      </p>
    </article>
  )
}
