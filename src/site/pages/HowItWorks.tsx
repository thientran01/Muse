import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        How Muse turns a click into a source edit, why direct edits land
        instantly, and how the agent works as a partner when you would rather describe a change than
        make it by hand.
      </Lead>

      <H2 id="mapping">From a click to a source file</H2>
      <P>
        In development, a small build-time plugin stamps every element with where it came from: file,
        line, and column, in a <Code>data-muse-loc</Code> attribute. Muse reads that straight off the node
        you clicked, so a click resolves to an exact source position without leaning on React internals.
        That is what keeps it working across React 18 and 19 and any bundler that can run the plugin.
        Where the attribute is missing, it falls back to React's fiber debug source.
      </P>

      <H2 id="backend">The backend</H2>
      <P>
        Reading and writing source needs filesystem access, so Muse runs a small development-only backend
        with the same handlers behind every host. On Vite it rides the dev server you already have; on
        Next.js it is a development API route; for anything else a tiny local server fills in. Same origin
        where it can be, one extra process where it cannot, development only either way.
      </P>

      <H2 id="canvas-engine">Why Canvas edits are instant</H2>
      <P>
        A direct edit is a known transform, and a drag is a number changing. Canvas parses the
        file, finds the element by its source position, and rewrites that one class or style with a
        character-range splice that leaves your formatting intact. The result lands instantly, asks for
        no key, and stays reversible.
      </P>

      <H2 id="agent">The agent, as a partner</H2>
      <P>
        Some of the work is conversation, and Muse is built to feel like a partner through it. The moment
        you hand an element to the agent, by Shift-clicking it, before you have typed anything, it runs a
        quick read of what you picked: a short, plain observation of what the element is doing, plus a few
        starter directions tailored to it. The conversation opens with something concrete to react to.
      </P>
      <P>
        From there you say what you want, and Muse answers with one to three distinct directions, each a
        complete edit you can hover to preview in place and click to apply. When a request is genuinely
        open-ended, it pauses and asks a single, well-formed question with visual options, then acts once
        it knows what you meant. It holds a point of view, picks up on what you left unsaid, and works
        with you toward the result.
      </P>

      <H2 id="safety">How writes stay safe</H2>
      <P>
        Writes are sandboxed to <Code>src/</Code>, with paths resolved through realpath rather than a
        string check, and Muse can only touch files it read in the same request. Every file is validated
        before any of them is written, so a batch lands whole or gets rejected together. Chat diffs wait
        for your approval, and undo, redo, and revert stay open throughout.
      </P>
    </article>
  )
}
