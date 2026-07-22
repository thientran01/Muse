import { expect, test } from '@playwright/test'
import { expectFixtureFile, nudgeScrubField, openMuse, readFixtureFile, restoreFixtureFile, selectElement } from './support/muse'

const FILE = 'src/UndoTarget.tsx'
const TARGET = 'p:has-text("Undo me")'

// Two elements carry data-muse-ui — the light-DOM shadow host and the portaled
// root inside it — so the dock has to be scoped in one selector to stay
// unambiguous under strict mode.
const UNDO = '[data-muse-ui] [data-muse-dock] button[aria-label="Undo"]'

/**
 * Undo, on the file-history path.
 *
 * Driven by the toolbar button rather than Ctrl+Z, for a specific reason: the
 * keyboard handler's typing guard reads e.target, which a document-level
 * listener sees retargeted to the shadow host, so it does not behave the way its
 * own code reads. The button has no such ambiguity. (That guard is a real bug,
 * filed separately; this suite does not depend on either behaviour.)
 *
 * The EPHEMERAL path is a different implementation entirely — DOM snapshots, no
 * server — and the Undo button mounts for those edits too, so the button's mere
 * presence proves nothing. These assertions are on disk.
 */
test.describe('undo', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    await page.goto('/')
    await openMuse(page)
  })

  test('restores the file byte-for-byte after a style edit', async ({ page }) => {
    const original = readFixtureFile(FILE)

    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 4)
    await expectFixtureFile(FILE, 'text-[length:20px]')

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/muse/write') && r.status() === 200),
      page.locator(UNDO).click(),
    ])

    // Byte-identical, not merely semantically equal: undo replays the server's
    // stored pre-edit bytes, so anything short of an exact match means the
    // original was reconstructed rather than restored — and reconstruction is
    // what silently loses line endings on a CRLF checkout.
    await expect.poll(() => readFixtureFile(FILE)).toBe(original)
  })

  test('has nothing to undo before the first edit', async ({ page }) => {
    await selectElement(page, TARGET)

    // The bar only mounts once history exists, so the control is absent rather
    // than present-and-disabled.
    await expect(page.locator(UNDO)).toHaveCount(0)
  })

  test('undoes only the most recent edit', async ({ page }) => {
    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 4)
    await expectFixtureFile(FILE, 'text-[length:20px]')
    const afterFirst = readFixtureFile(FILE)

    // Wait for the first edit to reach the BROWSER, not just the disk.
    //
    // The write response only proves bytes landed; the Tailwind JIT rebuild and
    // the CSS hot update are downstream of it. ScrubField latches its starting
    // value from computed style at focus and stops syncing once typing begins,
    // so a re-select against a stale stylesheet commits 17px instead of 21px —
    // and that is a real edit, so the write still succeeds and nothing fails
    // until the assertion below times out on a perfectly working product.
    await expect(page.locator(TARGET)).toHaveCSS('font-size', '20px')

    await selectElement(page, TARGET)
    await nudgeScrubField(page, 'scrub-Size', 1)
    await expectFixtureFile(FILE, 'text-[length:21px]')

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/muse/write') && r.status() === 200),
      page.locator(UNDO).click(),
    ])

    // Back to the first edit's state, not all the way to pristine.
    await expect.poll(() => readFixtureFile(FILE)).toBe(afterFirst)
  })
})
