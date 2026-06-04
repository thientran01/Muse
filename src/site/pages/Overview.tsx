import { Callout, Code, CodeBlock } from '../ui'

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
        anything on this page to shape it: drag the spacing, recolor a button, rewrite text, then step back
        through it with Ctrl+Z and Ctrl+Shift+Z. Edits live in your browser and clear when you refresh. Run
        Muse locally and the same moves rewrite your source files.
      </Callout>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Canvas
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Click an element and edit it directly. Spacing, size, type, color, copy, and order are all
        draggable or clickable, and each change writes to your source and stays on the undo stack. A
        direct edit is a known transform, so Muse applies it without a model call: instant, key-free,
        and reversible.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Spacing and layout</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Drag padding, margin, and gap bands on the element itself, resize it from the corners, or
            drag it among its siblings to reorder.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Type, color, and text</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Scrub size and weight, pick colors with a built-in picker, and double-click to rewrite the
            copy in place.
          </p>
        </div>
      </div>

      <Callout tone="try">
        <strong>Go wild on this card.</strong> Recolor the button, push the heading bigger, tighten the
        spacing, rename it. It is plain markup, and it stays yours until you refresh.
      </Callout>

      {/* Editable playground card (replaces the old pricing card). */}
      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#7f2f2f] text-base font-semibold text-white">
            T
          </span>
          <div>
            <div className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">Workspace settings</div>
            <div className="text-[13px] text-stone-600 dark:text-stone-400">Make it feel like home</div>
          </div>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
          A small card with a few moving parts, here to give you something real to push around.
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition duration-150 ease-out-strong hover:bg-stone-700 active:scale-[0.97] motion-reduce:active:scale-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
            Restyle me
          </button>
          <button type="button" className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition duration-150 ease-out-strong hover:bg-stone-50 active:scale-[0.97] motion-reduce:active:scale-100 dark:border-stone-700 dark:bg-[#201d16] dark:text-stone-200 dark:hover:bg-stone-800">
            Recolor me
          </button>
        </div>
      </div>

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
            Shape it by hand: drag the spacing, scrub the type, pick a color, rewrite the copy, reorder
            siblings.
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

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Keep edits on brand
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Drop a <Code>DESIGN.md</Code> in your project and Muse reads it for the color picker's brand
        swatches, so the palette you reach for is your real tokens rather than a guessed hex. It follows
        Google's{' '}
        <a className="underline" href="https://github.com/google-labs-code/design.md">DESIGN.md format</a>.
      </p>
      <CodeBlock label="DESIGN.md">{`---
colors:
  brand: "#7f2f2f"
  paper: "#f7f4ee"
typography:
  body: { fontFamily: "Inter" }
---

## Brand & Style
Warm and tool-like. One brick accent, used sparingly.`}</CodeBlock>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Muse can draft one from your code: run <Code>npm run design:gen</Code>, or open the{' '}
        <strong>Design system</strong> popover from the toolbar, which shows the brief in use and can
        generate a fresh one. Either way you refine it by hand afterward.
      </p>
    </article>
  )
}
