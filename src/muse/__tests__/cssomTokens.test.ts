// ============================================================
//  CSSOM TOKEN READ — the same answer on both engines
// ------------------------------------------------------------
//  The demo modes have no backend, so the Design-tokens panel reads the host's
//  CSS custom properties straight from the live CSSOM. That read returned ZERO
//  tokens on Firefox and 99 on Chromium, on the deployed case study.
//
//  Cause: since CSS Nesting shipped, `CSSStyleRule` inherits from
//  `CSSGroupingRule` on Firefox but NOT on Chromium —
//  `CSSStyleRule.prototype instanceof CSSGroupingRule` is true / false
//  respectively. The walk tested `CSSGroupingRule` FIRST and `continue`d, so on
//  Firefox every `:root` rule was treated as a container, recursed into (it has
//  no children), and skipped before yielding a token. The panel then honestly
//  reported "no tokens found" — a real failure presented as a successful empty
//  result, which is a recurring shape in this codebase.
//
//  These tests fake the CSSOM and switch ONLY the prototype chain between the two
//  engines. That is deliberate: the tooling available here is Chromium, and a
//  green Chromium check is not evidence about a Firefox-only bug — the house
//  lesson from the incident itself. Simulating the `instanceof` semantics is what
//  makes the difference observable without a second browser.
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Engine = 'chromium' | 'firefox'

class FakeCSSRule {}
class FakeCSSGroupingRule extends FakeCSSRule {
  cssRules: unknown[] = []
}
class FakeCSSImportRule extends FakeCSSRule {
  styleSheet: unknown = null
}

// The only difference between the engines: what CSSStyleRule inherits from.
class ChromiumStyleRule extends FakeCSSRule {
  selectorText = ''
  cssText = ''
  cssRules: unknown[] = []
}
class FirefoxStyleRule extends FakeCSSGroupingRule {
  selectorText = ''
  cssText = ''
}

const styleRuleClass = (engine: Engine) => (engine === 'firefox' ? FirefoxStyleRule : ChromiumStyleRule)

function makeStyleRule(engine: Engine, selectorText: string, cssText: string) {
  const R = styleRuleClass(engine)
  const r = new R() as InstanceType<typeof R> & { cssRules: unknown[] }
  r.selectorText = selectorText
  r.cssText = cssText
  r.cssRules = []
  return r
}

function makeMediaRule(children: unknown[]) {
  const m = new FakeCSSGroupingRule()
  m.cssRules = children
  return m
}

/** Install the fake CSSOM globals + a document exposing `sheets`. */
function installEngine(engine: Engine, sheets: unknown[]) {
  const g = globalThis as Record<string, unknown>
  g.CSSStyleRule = styleRuleClass(engine)
  g.CSSGroupingRule = FakeCSSGroupingRule
  g.CSSImportRule = FakeCSSImportRule
  g.document = {
    styleSheets: sheets,
    documentElement: { style: { getPropertyValue: () => '' } },
  }
}

// api.ts resolves its demo-mode flag when config.ts loads, so the host global has
// to be in place BEFORE the first import — see config.ts's header. (Setting it
// first stays correct regardless of how that resolution later changes.)
async function loadApi() {
  ;(globalThis as Record<string, unknown>).window = { __MUSE__: { ephemeral: true } }
  return import('../api')
}

const CLEANUP = ['CSSStyleRule', 'CSSGroupingRule', 'CSSImportRule', 'document', 'window']

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).window = { __MUSE__: { ephemeral: true } }
})

afterEach(() => {
  for (const k of CLEANUP) delete (globalThis as Record<string, unknown>)[k]
})

const ROOT_CSS = ':root { --c-paper: #f7f4ee; --c-ink: #1c1917; --gap: 8px; }'

describe('readCssomTokens (via museTokens in demo mode)', () => {
  it('reads :root tokens identically on both engines', async () => {
    const { museTokens } = await loadApi()
    const results: Record<Engine, string[]> = { chromium: [], firefox: [] }

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [{ href: null, cssRules: [makeStyleRule(engine, ':root', ROOT_CSS)] }])
      results[engine] = (await museTokens()).map((t) => t.name)
    }

    // The regression pin. Restore the grouping-first branch and `firefox` goes to
    // [] while `chromium` stays green — exactly how this shipped.
    expect(results.firefox).toEqual(['--c-paper', '--c-ink', '--gap'])
    expect(results.firefox).toEqual(results.chromium)
  })

  it('still descends into @media/@supports groups on both engines', async () => {
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [
        {
          href: null,
          cssRules: [makeMediaRule([makeStyleRule(engine, ':root', ':root { --nested: 4px; }')])],
        },
      ])
      const names = (await museTokens()).map((t) => t.name)
      expect(names, `engine=${engine}`).toEqual(['--nested'])
    }
  })

  it('keeps the value and colour classification intact on both engines', async () => {
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [{ href: null, cssRules: [makeStyleRule(engine, ':root', ROOT_CSS)] }])
      const tokens = await museTokens()
      expect(tokens.find((t) => t.name === '--c-paper'), `engine=${engine}`).toMatchObject({
        value: '#f7f4ee',
        isColor: true,
      })
      expect(tokens.find((t) => t.name === '--gap'), `engine=${engine}`).toMatchObject({
        value: '8px',
        isColor: false,
      })
    }
  })

  it('excludes Muse’s own --muse-* tokens on both engines', async () => {
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [
        { href: null, cssRules: [makeStyleRule(engine, ':root', ':root { --muse-accent: red; --host: blue; }')] },
      ])
      const names = (await museTokens()).map((t) => t.name)
      expect(names, `engine=${engine}`).toEqual(['--host'])
    }
  })

  // ---- gaps found in review; each pins something the five above did not ----

  it('follows @import into the imported sheet on both engines', async () => {
    // The CSSImportRule branch was previously unexercised — the fake class existed
    // and was installed as a global but never instantiated by any test.
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      const imported = { href: 'https://cdn.example/theme.css', cssRules: [makeStyleRule(engine, ':root', ':root { --imported: 3px; }')] }
      const imp = new FakeCSSImportRule()
      imp.styleSheet = imported
      installEngine(engine, [{ href: null, cssRules: [imp, makeStyleRule(engine, ':root', ':root { --local: 1px; }')] }])

      const tokens = await museTokens()
      expect(tokens.map((t) => t.name), `engine=${engine}`).toEqual(['--imported', '--local'])
      // The imported sheet's tokens are labelled with ITS filename, not the parent's.
      expect(tokens.find((t) => t.name === '--imported')?.file, `engine=${engine}`).toBe('theme.css')
    }
  })

  it('keeps first-definition-wins when the same var appears twice', async () => {
    // The invariant most at risk from harvest-then-descend, and the one no earlier
    // test covered: every fixture used distinct var names, so a duplicate could have
    // been double-listed or won by the wrong rule without anything going red.
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [
        {
          href: null,
          cssRules: [
            makeStyleRule(engine, ':root', ':root { --dup: FIRST; }'),
            makeMediaRule([makeStyleRule(engine, ':root', ':root { --dup: SECOND; }')]),
            makeStyleRule(engine, 'html.dark', 'html.dark { --dup: THIRD; }'),
          ],
        },
      ])
      const tokens = await museTokens()
      expect(tokens.length, `engine=${engine}`).toBe(1) // listed once, not thrice
      expect(tokens[0].value, `engine=${engine}`).toBe('FIRST') // document order wins
    }
  })

  it('lets a live inline override on <html> beat the stylesheet value', async () => {
    // `override || v.value` was moved by this change and never ran with a non-empty
    // override — in demo mode that override IS the persistence for a prior edit.
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [{ href: null, cssRules: [makeStyleRule(engine, ':root', ':root { --c-paper: #f7f4ee; }')] }])
      ;(globalThis as Record<string, unknown>).document = {
        styleSheets: [{ href: null, cssRules: [makeStyleRule(engine, ':root', ':root { --c-paper: #f7f4ee; }')] }],
        documentElement: { style: { getPropertyValue: (n: string) => (n === '--c-paper' ? ' #ff0000 ' : '') } },
      }
      const tokens = await museTokens()
      expect(tokens[0], `engine=${engine}`).toMatchObject({ value: '#ff0000', isColor: true })
    }
  })

  it('survives a sheet whose rules throw, without losing the other sheets', async () => {
    // Cross-origin sheets throw on .cssRules. The catch is per-SHEET, so a throwing
    // sheet must not take the readable ones down with it.
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      const hostile = {
        href: 'https://cdn.example/blocked.css',
        get cssRules(): never {
          throw new DOMException('cross-origin', 'SecurityError')
        },
      }
      installEngine(engine, [hostile, { href: null, cssRules: [makeStyleRule(engine, ':root', ':root { --after: 2px; }')] }])
      expect((await museTokens()).map((t) => t.name), `engine=${engine}`).toEqual(['--after'])
    }
  })

  it('walks into @keyframes children without harvesting junk', async () => {
    // Descending through the duck type reaches @keyframes children, which the old
    // instanceof gate never entered. Verified on real Chromium that a CSSKeyframeRule
    // has no `.cssRules` and no `selectorText`, so the walk must terminate there and
    // yield nothing — pinned here so a future traversal change can't start emitting
    // keyframe percentages as design tokens.
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      const keyframeChild = { keyText: '0%', cssText: '0% { opacity: 0; --not-a-token: 1; }' }
      const keyframes = new FakeCSSGroupingRule()
      keyframes.cssRules = [keyframeChild]
      installEngine(engine, [
        { href: null, cssRules: [keyframes, makeStyleRule(engine, ':root', ':root { --real: 1px; }')] },
      ])
      expect((await museTokens()).map((t) => t.name), `engine=${engine}`).toEqual(['--real'])
    }
  })

  // NOT a regression pin, unlike the four above: it expects [] and the bug also
  // produced [], so it passes either way. Kept as the guard on ROOT_RULE_RE — it
  // goes red if the scan ever widens to non-root rules and floods the panel with
  // every component's local vars.
  it('ignores non-root rules on both engines', async () => {
    const { museTokens } = await loadApi()

    for (const engine of ['chromium', 'firefox'] as Engine[]) {
      installEngine(engine, [
        { href: null, cssRules: [makeStyleRule(engine, '.card', '.card { --local: 2px; }')] },
      ])
      expect(await museTokens(), `engine=${engine}`).toEqual([])
    }
  })
})
