import { Callout, Code, CodeBlock, Kbd } from '../ui'

export function Features() {
  return (
    <article>
      <h1 className="text-4xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        What you can do
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-600 dark:text-stone-400">
        Canvas is the main way to work: click an element and shape it by hand. A chat partner
        handles the changes you would rather describe than drag. Everything below is live, so open Muse
        and start editing, or hold <Kbd>⇧</Kbd> and click to ask the chat partner.
      </p>

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
        Or describe it
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Some changes read better as a sentence than a drag. Shift-click an element to hand it to the chat
        partner, tell Muse to make a card feel warmer and less boxy, and it answers with a few directions,
        each a real edit you can preview in place before you commit to one. When a request is genuinely
        open-ended, it asks a single question first. The agent carries intent; Canvas carries the
        hands-on work.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Keep edits on brand
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Drop a <Code>DESIGN.md</Code> in your project and Muse reads it before every chat edit, so the
        model reaches for your real tokens rather than a guessed hex. It follows Google's{' '}
        <a className="underline" href="https://github.com/google-labs-code/design.md">DESIGN.md format</a>:
        a little YAML up top for colors, type, and spacing, then prose for the feel.
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
        Muse can draft one from your code: run <Code>npm run design:gen</Code>, or open the Muse panel,
        where <strong>View design system</strong> shows the brief in use and can generate a fresh one.
        Either way you refine it by hand afterward.
      </p>
    </article>
  )
}
