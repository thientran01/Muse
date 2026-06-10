import type { CSSProperties } from 'react'
import { Callout, Code, H1, H2, Lead, P } from '../ui'
import { ModuleCard } from '../zoo/ModuleCard'
import { StyledCard } from '../zoo/StyledCard'
import '../zoo/zoo.css'

// The strategy zoo — one live demo card per styling system Muse can write. Each
// card's editable elements are authored purely in that system, so selecting and
// scrubbing them exercises that engine path for real: the captions say exactly
// which file the edit lands in. (This page is also our own regression surface —
// if a strategy breaks, its card stops responding.)

// A shared inline-style const (used twice below) — selecting either stamp offers
// the "apply to all" scope toggle, and a const-scope edit rewrites THIS object.
const stamp: CSSProperties = {
  display: 'inline-block',
  padding: '6px',
  borderRadius: '8px',
  backgroundColor: '#b07d2f',
  color: '#fdf8ef',
  fontSize: '12px',
  fontWeight: 600,
}

export function Styling() {
  return (
    <article>
      <H1>Styling</H1>
      <Lead>
        Muse writes the styling system each element already uses — these four cards are each authored a
        different way. Open Muse and scrub them.
      </Lead>

      <Callout tone="try">
        <strong>Each card names where its edits land.</strong> In this hosted demo the changes stay in
        your browser; run Muse locally and the same scrub rewrites the literal style object, the token
        definition, the <Code>.module.css</Code> rule, or the styled-components template.
      </Callout>

      <H2 id="inline">Inline styles</H2>
      <P>
        The plainest case: values written straight into <Code>style={'{{…}}'}</Code>. Muse merges the
        edit into the object literal. The two stamps below share one <Code>const</Code> — select one and
        the panel offers <strong>apply to all</strong>, which rewrites the shared object instead of the
        single element.
      </P>
      <div className="mt-6 rounded-[var(--radius-lg)] border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
        <h3 style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '0.2px' }}>
          Styled with inline objects
        </h3>
        <p style={{ marginTop: '8px', fontSize: '14px', lineHeight: 1.6, color: '#8a8077' }}>
          Every value on this card sits in a style attribute in Styling.tsx. Scrub the padding or color
          and Muse rewrites the object in place.
        </p>
        <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
          <span style={stamp}>shared const</span>
          <span style={stamp}>same const</span>
        </div>
      </div>

      <H2 id="vars">CSS variables</H2>
      <P>
        These chips paint through <Code>var(--zoo-*)</Code> tokens defined in <Code>zoo.css</Code>.
        Recolor one and Muse edits the <em>token's definition</em>, not the element — so everything using
        it repaints together. That's the difference between overriding one element and retuning a theme.
      </P>
      <div className="mt-6 rounded-[var(--radius-lg)] border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#201d16] dark:shadow-none">
        <div style={{ display: 'flex', gap: '12px' }}>
          <span
            style={{
              padding: '14px',
              borderRadius: 'var(--zoo-chip-radius)',
              backgroundColor: 'var(--zoo-accent)',
              color: '#f7f4ee',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            --zoo-accent
          </span>
          <span
            style={{
              padding: '14px',
              borderRadius: 'var(--zoo-chip-radius)',
              backgroundColor: 'var(--zoo-mint)',
              color: '#10241c',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            --zoo-mint
          </span>
          <span
            style={{
              padding: '14px',
              borderRadius: 'var(--zoo-chip-radius)',
              backgroundColor: 'var(--zoo-honey)',
              color: '#2b1f0c',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            --zoo-honey
          </span>
        </div>
        <p className="mt-4 text-[13px] text-stone-600 dark:text-stone-400">
          Also in the toolbar's <strong>Design tokens</strong> popover — same tokens, same write.
        </p>
      </div>

      <H2 id="modules">CSS Modules</H2>
      <P>
        Here the classNames are bindings (<Code>styles.card</Code>) and the values live in{' '}
        <Code>ModuleCard.module.css</Code>. Muse resolves the binding to its rule and sets the
        declaration there — the JSX never changes.
      </P>
      <div className="mt-6">
        <ModuleCard />
      </div>

      <H2 id="styled">styled-components</H2>
      <P>
        The values live in tagged-template literals (<Code>styled.div`…`</Code>). Muse edits the
        declaration inside the template body; nested <Code>&:hover</Code> blocks are left alone, and a
        template with <Code>${'{…}'}</Code> interpolation is refused rather than risked (the edit falls
        back to a safe inline override). Emotion's <Code>css</Code> prop takes the same path.
      </P>
      <div className="mt-6">
        <StyledCard />
      </div>

      <H2 id="tailwind">…and Tailwind, everywhere else</H2>
      <P>
        The rest of this site is utility classes — every heading and button on the other pages is the
        Tailwind path (<Code>p-4 → p-6</Code>, or an arbitrary <Code>p-[17px]</Code> when you scrub off
        the scale). One selection model, five writers, no configuration: Muse detects how each element is
        styled and writes that.
      </P>
    </article>
  )
}
