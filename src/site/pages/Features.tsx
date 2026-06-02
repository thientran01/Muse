import { Callout, Card, H1, H2, Kbd, Lead, P, PrimaryButton, SecondaryButton } from '../ui'

export function Features() {
  return (
    <article>
      <H1>Features</H1>
      <Lead>
        Two ways to edit: <strong>Canvas Mode</strong> for direct manipulation, and a{' '}
        <strong>chat</strong> partner for intent you'd rather describe. Everything below is live —
        press <Kbd>L</Kbd> and edit it.
      </Lead>

      <H2 id="canvas">Canvas Mode</H2>
      <P>
        Select an element and adjust it directly — no model call, no API key. Drag spacing and gaps,
        scrub font size and weight, change colors, edit text in place, and drag to reorder siblings.
        Each change is written deterministically to source and is undoable.
      </P>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-zinc-900">Spacing & layout</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            Drag padding, margin, and gap bands right on the element.
          </p>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-zinc-900">Type & color</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            Scrub size, weight, tracking; pick colors with a built-in picker.
          </p>
        </Card>
      </div>

      <H2 id="chat">Chat partner</H2>
      <P>
        For changes you'd rather describe — "make this card feel warmer and less boxy" — Muse proposes
        a few distinct directions, each a complete edit you can preview in place, then approve. On a
        genuinely ambiguous ask it asks one short question instead of guessing.
      </P>

      <Callout tone="try">
        <strong>Try the playground below.</strong> Enter Canvas Mode and restyle this pricing card —
        change the button color, bump the heading size, tighten the spacing. It's all live.
      </Callout>

      {/* Editable playground element */}
      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="text-[13px] font-medium uppercase tracking-wider text-[#7f2f2f]">Pro</div>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight text-zinc-900">$12</span>
          <span className="text-sm text-zinc-500">/ month</span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-zinc-600">
          Everything you need to ship a polished interface, fast.
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-[14px] text-zinc-700">
          <li className="flex gap-2"><span className="text-[#7f2f2f]">✓</span> Unlimited edits</li>
          <li className="flex gap-2"><span className="text-[#7f2f2f]">✓</span> Canvas Mode + chat</li>
          <li className="flex gap-2"><span className="text-[#7f2f2f]">✓</span> Full undo history</li>
        </ul>
        <div className="mt-6 flex gap-3">
          <PrimaryButton>Choose Pro</PrimaryButton>
          <SecondaryButton>Compare</SecondaryButton>
        </div>
      </div>
    </article>
  )
}
