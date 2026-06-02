import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        The intelligence is Claude. The engineering worth talking about is the harness that maps a pixel
        to its source and writes the change back safely.
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
