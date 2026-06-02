import { Callout, Kbd } from '../ui'

export function Features() {
  return (
    <article>
      <h1 className="text-4xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        What you can do
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-500 dark:text-stone-400">
        Canvas Mode is the main event: grab any element and shape it by hand. There is also a chat
        partner for the times you would rather describe a change than make it. Everything below is
        live, so press <Kbd>L</Kbd> and go.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Canvas Mode
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Select something and edit it directly. No model, no API key, no latency. It just happens, and
        every change is written to your source and is undoable.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Spacing and layout</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Drag padding, margin, and gap bands right on the element. Resize it. Reorder its siblings.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Type, color, and text</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
            Scrub size and weight, pick colors with a built-in picker, double-click to rewrite the copy.
          </p>
        </div>
      </div>

      <Callout tone="try">
        <strong>Go wild on this card.</strong> Recolor the button, bump the heading, tighten the
        spacing, rename it. It is just markup, and it is all yours until you refresh.
      </Callout>

      {/* Editable playground card (replaces the old pricing card). */}
      <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#7f2f2f] text-base font-semibold text-white">
            T
          </span>
          <div>
            <div className="text-[15px] font-semibold text-stone-900 dark:text-stone-100">Workspace settings</div>
            <div className="text-[13px] text-stone-500 dark:text-stone-400">Make it feel like home</div>
          </div>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-stone-600 dark:text-stone-400">
          A plain little card with a few moving parts, here so you have something real to push around.
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
            Save changes
          </button>
          <button type="button" className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-[#201d16] dark:text-stone-200 dark:hover:bg-stone-800">
            Cancel
          </button>
        </div>
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        Or just describe it
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Some changes are easier to say than to drag. "Make this card feel warmer and less boxy." Muse
        comes back with a few distinct directions, each a real edit you can preview in place, then you
        pick one. If the ask is genuinely vague, it asks one quick question instead of guessing. The
        chat is the supporting act here. Canvas is where you will spend your time.
      </p>
    </article>
  )
}
