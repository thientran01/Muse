import { Code, H1, H2, Lead, P } from '../ui'

export function HowItWorks() {
  return (
    <article>
      <H1>How it works</H1>
      <Lead>
        The intelligence is Claude. The engineering is the harness that maps a pixel to its source and
        writes the change back safely.
      </Lead>

      <H2 id="mapping">Element → source mapping</H2>
      <P>
        In development, <Code>@vitejs/plugin-react</Code> tags every React fiber with its source
        location (<Code>_debugSource</Code> — file, line, column). Every DOM node carries a reference
        to its fiber, so Muse walks from the clicked node up the fiber tree until it finds a location.
        No build step, no DOM bloat. (This hosted demo keeps that debug info in its build, which is why
        you can select elements here.)
      </P>

      <H2 id="backend">A Vite plugin, not a server</H2>
      <P>
        Reading and writing source on disk needs filesystem access. A standalone server means CORS and
        a second process; a cloud function can't see your local files. So Muse attaches its endpoints
        to the Vite dev server itself — same origin, one command. The plugin is dev-only and never
        ships to production.
      </P>

      <H2 id="canvas-engine">Deterministic Canvas edits</H2>
      <P>
        Direct manipulation is a known transform — a drag is "change this number." So Canvas Mode skips
        the model entirely: it parses the file, locates the element by its source position, and rewrites
        just the targeted class or style by a character-range splice (preserving your formatting). No
        latency, no API key, fully reversible.
      </P>

      <H2 id="safety">Safety</H2>
      <P>
        The write endpoint is sandboxed to <Code>src/</Code>, resolves paths with realpath checks (not
        a defeatable string match), can only touch files read in the same request, validates every file
        before writing any (all-or-nothing), and caps file size. You approve chat diffs before anything
        is written, and undo/redo/revert are always available.
      </P>
    </article>
  )
}
