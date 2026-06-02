import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        The smarts are Claude. The interesting engineering is the harness that maps a pixel to its
        source and writes the change back without breaking anything.
      </Lead>

      <H2 id="mapping">From a click to a source file</H2>
      <P>
        In development, <Code>@vitejs/plugin-react</Code> tags every React fiber with where it came
        from (<Code>_debugSource</Code>: file, line, column). Every DOM node points back to its fiber,
        so Muse walks up from whatever you clicked until it finds that location. No build step, no junk
        in your markup. This hosted demo keeps that debug info in its build on purpose, which is why you
        can select things here.
      </P>

      <H2 id="backend">A Vite plugin, not a server</H2>
      <P>
        Reading and writing source needs filesystem access. A standalone server means CORS and a second
        process to babysit, and a cloud function cannot see your local files. So Muse just hangs its
        endpoints off the Vite dev server you are already running. One command, same origin, dev only.
      </P>

      <H2 id="canvas-engine">Why Canvas edits are instant</H2>
      <P>
        A direct edit is a known transform. A drag is "change this number." So Canvas Mode does not call
        a model at all. It parses the file, finds the element by its source position, and rewrites just
        that one class or style with a character-range splice that leaves your formatting alone. No
        latency, no key, fully reversible.
      </P>

      <H2 id="safety">It will not wreck your code</H2>
      <P>
        Writes are sandboxed to <Code>src/</Code>, paths are checked with realpath (not a string match
        you can trick), and Muse can only touch files it read in the same request. Every file is
        validated before any of them is written, so a batch is all-or-nothing. You approve chat diffs
        before they land, and undo, redo, and revert are always there.
      </P>
    </article>
  )
}
