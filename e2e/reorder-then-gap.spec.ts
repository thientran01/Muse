import { expect, test } from '@playwright/test'
import { dragPast, expandSection, openMuse, readFixtureFile, restoreFixtureFile, selectForReorder, selectParent, setScrubField } from './support/muse'

const FILE = 'src/GapTarget.tsx'
const ONE = 'div.p-4:has-text("One")'
const TWO = 'div.p-4:has-text("Two")'

/**
 * The tripwire.
 *
 * Reported 2026-06-27: a reorder followed by a gap edit silently reverts the gap
 * commit. The reorder calls selectElement(), the selection-change effect leaves
 * the edit-preview ref holding stale/detached nodes, and the following commit's
 * before/after cssText comparison then sees no change and no-ops. The drag
 * previews the spread and snaps back. The known workaround is to press Escape
 * between the two, or to do the style edit first.
 *
 * Written as a normal passing test rather than test.fail(): the run decides
 * whether the bug is still live at HEAD, not the report. If it starts failing,
 * the regression is real and the report was right.
 *
 * IT PASSES — so the panel-field gap path is sound after a reorder. Do NOT read
 * that as "the reported bug is fixed". The report describes the gap DRAG
 * ("previews the spread, then snaps back"), i.e. the GapOverlay bands, which are
 * a different commit path from the panel's scrub field — and one that emits the
 * `gap` shorthand rather than `gap-y` when the row and column gaps match. That
 * path is still uncovered; it needs a test hook on the bands, which have none.
 *
 * So this file pins the half that can be driven today and narrows the search
 * area for the half that cannot. The control test matters for exactly that
 * reason: it separates "gap is broken" from "gap is broken after a reorder".
 */
test.describe('reorder then gap', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    await page.goto('/')
    await openMuse(page)
  })

  test('a gap edit still commits after a reorder', async ({ page }) => {
    expect(readFixtureFile(FILE)).toContain('className="flex flex-col"')

    await selectForReorder(page, ONE)
    await dragPast(page, ONE, TWO)

    // The reorder re-selects the moved child, so step out to the flex container
    // — gap fields only exist for an element whose computed display is flex/grid.
    await selectParent(page, ONE)
    await expandSection(page, 'Layout')
    await setScrubField(page, 'scrub-Row', 24)

    await expect
      .poll(() => readFixtureFile(FILE), {
        message:
          'the gap edit did not reach the source after a reorder — this is the ' +
          '2026-06-27 stale edit-preview bug (reorder leaves previewRef holding ' +
          'detached nodes, so the commit compares equal and no-ops)',
      })
      .toContain('gap-y-6')

    // And the reorder itself must have survived the second edit.
    const after = readFixtureFile(FILE)
    expect(after.indexOf('Two')).toBeLessThan(after.indexOf('One'))
  })

  test('the documented Escape workaround also commits', async ({ page }) => {
    await selectForReorder(page, ONE)
    await dragPast(page, ONE, TWO)

    // Deselect between the two edits — the workaround from the bug report. This
    // pins the workaround itself, so if the primary case regresses there is
    // evidence about which half broke.
    await page.keyboard.press('Escape')

    await selectParent(page, ONE)
    await expandSection(page, 'Layout')
    await setScrubField(page, 'scrub-Row', 24)

    await expect.poll(() => readFixtureFile(FILE)).toContain('gap-y-6')
  })

  test('a gap edit with no preceding reorder commits (control)', async ({ page }) => {
    // The control. If this fails too, the fault is in the gap path itself and
    // has nothing to do with reorder — which changes where to look entirely.
    //
    // Reached by Alt-click rather than by clicking the container directly: a
    // plain click always selects the LEAF under the cursor, so clicking the
    // container's own area still selects whichever child is there.
    await page.locator(ONE).click()
    await selectParent(page, ONE)
    await expandSection(page, 'Layout')
    await setScrubField(page, 'scrub-Row', 24)

    await expect.poll(() => readFixtureFile(FILE)).toContain('gap-y-6')
  })
})
