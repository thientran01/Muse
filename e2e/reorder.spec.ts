import { expect, test } from '@playwright/test'
import { dragPast, expectFixtureFile, openMuse, readFixtureFile, restoreFixtureFile, selectForReorder } from './support/muse'

const FILE = 'src/ReorderTarget.tsx'
const ALPHA = 'div.p-4:has-text("Alpha")'
const BETA = 'div.p-4:has-text("Beta")'

/**
 * The pointer drag — the flakiest surface in the product and the reason this
 * suite exists. Four documented root causes have been fixed here by hand, with
 * nothing guarding them since.
 *
 * Assertions read the ORDER OF TEXT in the source. After HMR, React reconciles
 * the reused DOM nodes positionally — the content swaps in place and the element
 * handles do not move — so element identity order in the DOM proves nothing.
 */
test.describe('reorder by dragging', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    await page.goto('/')
    await openMuse(page)
  })

  test('moves a sibling past its neighbour in the source file', async ({ page }) => {
    const before = readFixtureFile(FILE)
    expect(before.indexOf('Alpha')).toBeLessThan(before.indexOf('Beta'))

    await selectForReorder(page, ALPHA)
    await dragPast(page, ALPHA, BETA)

    await expect
      .poll(() => {
        const src = readFixtureFile(FILE)
        return src.indexOf('Beta') < src.indexOf('Alpha')
      }, { message: 'Alpha never moved after Beta in the source' })
      .toBe(true)

    // Gamma must not be disturbed: the splice reorders whole child blocks, so a
    // bug here shows up as a third sibling drifting, not as a syntax error.
    const after = readFixtureFile(FILE)
    expect(after.indexOf('Alpha')).toBeLessThan(after.indexOf('Gamma'))
  })

  test('moves the element verbatim — attributes and formatting untouched', async ({ page }) => {
    const before = readFixtureFile(FILE)

    await selectForReorder(page, ALPHA)
    await dragPast(page, ALPHA, BETA)
    await expectFixtureFile(FILE, /Beta[\s\S]*Alpha/)

    const after = readFixtureFile(FILE)

    // A whitespace-preserving block splice: each child travels together with the
    // whitespace that preceded it, so every line survives byte-identical and only
    // their order changes. Sorting both sides proves nothing was rewritten.
    const norm = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).sort()
    expect(norm(after)).toEqual(norm(before))
    expect(after).toContain('<div className="p-4">Alpha</div>')
  })

  test('a drag that lands where it started writes nothing', async ({ page }) => {
    const before = readFixtureFile(FILE)
    let wrote = false
    page.on('request', (r) => {
      if (r.url().includes('/api/muse/write')) wrote = true
    })

    await selectForReorder(page, ALPHA)

    // Press, cross the engage threshold, then return and release. The drop slot
    // is recomputed from the pointerUP coordinates, so this resolves to the
    // original index and must short-circuit before any network call.
    const box = await page.locator(ALPHA).boundingBox()
    if (!box) throw new Error('could not measure Alpha')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 12)
    await page.mouse.move(x, y, { steps: 6 })
    await page.mouse.up()

    await page.waitForTimeout(400)
    expect(wrote).toBe(false)
    expect(readFixtureFile(FILE)).toBe(before)
  })
})
