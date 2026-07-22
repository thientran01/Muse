import { expect, test } from '@playwright/test'
import { expectFixtureFile, nudgeScrubField, openMuse, readFixtureFile, restoreFixtureFile, selectElement } from './support/muse'

const FILE = 'src/ScrubTarget.tsx'
// Selected by its text, not its class: the class is the very thing under edit,
// and other fixture targets legitimately reuse `text-base`.
const TARGET = 'p:has-text("Scrub my font size")'

/**
 * Scrubbing a numeric property — the client half of gesture → request → write.
 *
 * Font size rather than padding, for two reasons that are properties of the
 * current source, not preferences:
 *   - `scrub-Size` is a unique test id. `scrub-All` is emitted by linked padding,
 *     linked margin AND radius, with identical accessible names, so it is a
 *     strict-mode violation waiting to happen.
 *   - The Type section is the initially-open one for an element that renders
 *     direct text, so no section header has to be clicked. Blind-clicking it
 *     would CLOSE it — and section state is module-scoped, surviving every
 *     selection change until a full reload.
 */
test.describe('scrub a numeric property', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    // Fresh load per test: the panel's open-section state lives in a module-level
    // variable that outlives selection changes, so state leaks between tests
    // sharing a page.
    await page.goto('/')
    await openMuse(page)
  })

  test('rewrites the font-size class in the source file', async ({ page }) => {
    expect(readFixtureFile(FILE)).toContain('className="text-base"')

    await selectElement(page, TARGET)
    // text-base compiles to 16px, and the panel seeds from computed style, so
    // four +1 nudges land on 20.
    await nudgeScrubField(page, 'scrub-Size', 4)

    // fontSizeToken always emits the arbitrary form, never a named step — so
    // this is `text-[length:20px]` and not `text-xl`. The token replaces
    // text-base in place rather than appending, because isFontSizeToken matches
    // both the named and the arbitrary form.
    await expectFixtureFile(FILE, 'className="text-[length:20px]"')
  })

  test('a second scrub replaces the arbitrary token rather than appending', async ({ page }) => {
    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 4)
    await expectFixtureFile(FILE, 'className="text-[length:20px]"')

    // Wait for the written class to actually take effect before selecting again.
    // The panel seeds from computed style, so re-selecting while the JIT
    // stylesheet is still catching up would read the OLD size and silently make
    // this a test of 16→17 instead of 20→21. This is the real settle signal, not
    // a sleep — and computed style is the signal this project trusts.
    await expect(page.locator(TARGET)).toHaveCSS('font-size', '20px')

    // HMR re-renders after a write and can replace the selected node, leaving
    // `selected.node` detached — so re-select rather than reusing the selection.
    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 1)

    await expectFixtureFile(FILE, 'className="text-[length:21px]"')
    // The real regression risk is accumulation: isLengthArbitrary strips the
    // leading `length:` so a re-edit matches its own previous output. If that
    // ever breaks, the class list grows instead of being replaced.
    expect(readFixtureFile(FILE)).not.toContain('text-[length:20px]')
  })

  test('leaves the rest of the file untouched', async ({ page }) => {
    const before = readFixtureFile(FILE)

    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 4)
    await expectFixtureFile(FILE, 'text-[length:20px]')

    // A one-token diff on one line — the engine's whole promise. Comparing every
    // other line catches collateral rewrites (re-quoting, reformatting, line
    // ending changes) that a single toContain would sail past.
    const after = readFixtureFile(FILE)
    const changed = before.split('\n').filter((line, i) => line !== after.split('\n')[i])
    expect(changed).toHaveLength(1)
    expect(after.split('\n')).toHaveLength(before.split('\n').length)
  })
})
