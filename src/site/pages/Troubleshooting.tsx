import { Code, H1, H2, Lead, P } from '../ui'

// Symptom-led walkthrough of every case where Canvas refuses or reroutes an
// edit. The refusals are deliberate (the engine fails closed rather than
// guessing at source), so each section says what the hint means and what to do
// about it. Mirrors the refusal taxonomy in the engine and useCanvasMode.
export function Troubleshooting() {
  return (
    <article>
      <H1>Troubleshooting</H1>
      <Lead>
        Every Canvas refusal is deliberate: when an edit cannot be made safely, Muse says so
        instead of guessing at your source. This page covers each hint you might see and what to do
        about it.
      </Lead>

      <H2 id="no-mapping">"No source mapping" on click</H2>
      <P>
        The clicked element carries no <Code>data-muse-loc</Code> stamp and no React debug source,
        so Muse cannot tell which file it came from. Usual causes: the element belongs to a library
        component (Babel transforms never run on <Code>node_modules</Code>, so library code is
        never stamped), or the Babel locator is not wired for the file's bundler path. Click a
        parent that is part of your own source, or check the locator step in the install guide.
      </P>

      <H2 id="themed">A color reads "themed"</H2>
      <P>
        The element paints that channel through a CSS variable, like{' '}
        <Code>text-[color:var(--c-on-bg)]</Code>. Hardcoding a hex over it would break the theme
        binding, so the picker stands down. Edit the token itself instead: the toolbar's{' '}
        <strong>Design tokens</strong> popover lists every custom property in your stylesheets and
        writes the change at the definition, so every use of the token updates together.
      </P>

      <H2 id="text">"This text can't be edited here"</H2>
      <P>
        Double-click editing rewrites a single static piece of text in your JSX. Two cases refuse:
        text that mixes with child elements (rewriting it would destroy the children), and text
        that comes from data. For prop-driven text like <Code>{'{title}'}</Code>, Muse traces the
        literal to the component's usage site and edits it there when it can identify the caller
        unambiguously. When the text comes from state, a loop, or a CMS, flag the element instead
        and let your agent make the change.
      </P>

      <H2 id="reorder">An element refuses to reorder</H2>
      <P>
        Drag-to-reorder moves an element among its source siblings, which only changes what you
        see when the layout follows document flow. Elements placed by explicit CSS, grid line or
        area placement, <Code>position: absolute</Code> or <Code>fixed</Code>, or an active{' '}
        <Code>order</Code> value, would not move no matter how the source is shuffled, so Muse
        refuses rather than make an edit with no visible effect. Moving those means editing their
        placement styles instead.
      </P>

      <H2 id="parent-spacing">"Spacing here is set by the parent"</H2>
      <P>
        Tailwind's <Code>space-y</Code> and <Code>space-x</Code> utilities set the margins of every
        child from the parent. Scrubbing one child's margin would fight that rule, so Muse points
        you at the owner: select the parent and adjust its spacing there, which keeps the rhythm
        consistent for all the children at once.
      </P>

      <H2 id="inline-fallback">A style edit landed as an inline style, not a class</H2>
      <P>
        When a className is built dynamically, with <Code>clsx</Code>, a template literal, or a
        ternary, splicing a class into it safely is not possible. Muse applies the change as an
        inline <Code>style</Code> instead, which wins the cascade and renders exactly what you
        chose. A note records this in the browser console. The edit is real and mergeable; if you
        would rather have it as a class, flag the element and let your agent refactor it.
      </P>

      <H2 id="svg">SVG shapes select as their icon</H2>
      <P>
        Clicking an icon selects its <Code>svg</Code> root — resize it and recolor it (the color
        flows through <Code>currentColor</Code>, which covers virtually every icon set). The
        shapes <em>inside</em> an svg (<Code>path</Code>, <Code>circle</Code>) don't take their
        own selection; the icon edits as a unit, and reordering still happens on the wrapping
        element.
      </P>

      <H2 id="flag">When Canvas can't reach it, flag it</H2>
      <P>
        Every refusal with a sticky hint offers <strong>Flag it for your agent</strong>, and
        shift-click drops a flag on anything. A flag carries the exact source location, the
        element's tag, classes, and text, and your note about the change you wanted. Your own
        coding agent picks flags up through <Code>muse-mcp</Code> and makes the edit with full
        context, so the cases direct manipulation cannot express still end in real code.
      </P>
    </article>
  )
}
