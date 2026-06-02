import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        A look under the hood: how Muse turns a click into a source edit, why direct edits land
        instantly, and how the agent works as a partner when you would rather describe a change than
        make it by hand.
      </Lead>

      <H2 id="mapping">From a click to a source file</H2>
      <P>
        In development, <Code>@vitejs/plugin-react</Code> stamps every React fiber with where it came
        from: file, line, and column, under <Code>_debugSource</Code>. Every DOM node points back to its
        fiber, so Muse walks up from whatever you clicked until it reaches that location. This demo keeps
        the debug info in its build on purpose, which is why selection works here.
      </P>

      <H2 id="backend">Why a Vite plugin</H2>
      <P>
        Reading and writing source needs filesystem access. A standalone server would mean CORS and a
        second process to run, and a cloud function would sit too far from your local files. So Muse
        hangs its endpoints off the Vite dev server you already have: one command, same origin,
        development only.
      </P>

      <H2 id="canvas-engine">Why Canvas edits are instant</H2>
      <P>
        A direct edit is a known transform, and a drag is a number changing. Canvas Mode parses the
        file, finds the element by its source position, and rewrites that one class or style with a
        character-range splice that leaves your formatting intact. The result lands instantly, asks for
        no key, and stays reversible.
      </P>

      <H2 id="agent">The agent, as a partner</H2>
      <P>
        Some of the work is conversation, and Muse is built to feel like a partner through it. The moment
        you select an element, before you have typed anything, it runs a quick read of what you picked: a
        short, plain observation of what the element is doing, plus a few starter directions tailored to
        it. The conversation opens with something concrete to react to.
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
