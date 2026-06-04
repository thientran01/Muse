import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        How Muse turns a click into a source edit, why direct edits land instantly, and how the writes
        stay safe.
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

      <H2 id="safety">How writes stay safe</H2>
      <P>
        Writes are sandboxed to <Code>src/</Code>, with paths resolved through realpath rather than a
        string check, and Muse can only touch files it read in the same request. Every file is validated
        before any of them is written, so a batch lands whole or gets rejected together. Undo, redo, and
        revert stay open throughout.
      </P>
    </article>
  )
}
