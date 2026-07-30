import { expect, test } from '@playwright/test'

/**
 * Runs first (alphabetically, and the suite is serial) so that a
 * misconfigured harness fails with a diagnosis instead of leaving every other
 * spec to fail against an unchanged file.
 *
 * Each check here maps to a failure mode that is silent at the assertion layer.
 */
test.describe('preflight', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('the write path is live — MOCK and EPHEMERAL are both off', async ({ page }) => {
    const flags = await page.evaluate(() => window.__museE2E)

    expect(
      flags,
      'the fixture never published its mode flags — the overlay bundle failed to load',
    ).toBeDefined()

    expect(
      flags,
      'Muse resolved to MOCK/EPHEMERAL, where every gesture short-circuits before its fetch and ' +
        'nothing is ever written to disk. Byte assertions would fail against an unchanged file. ' +
        'Cause is almost always VITE_MUSE_EPHEMERAL / VITE_MUSE_MOCK exported in the shell — ' +
        'process.env beats .env files in Vite. (The flags are read once at import, so a change ' +
        'needs a server restart.)',
    ).toEqual({ mock: false, ephemeral: false })
  })

  test('the source locator is stamping — data-muse-loc is present on the page', async ({ page }) => {
    const stamps = await page.locator('[data-muse-loc]').count()

    // Zero stamps is THE canonical Muse install failure: the overlay mounts and
    // selection appears to work, but nothing resolves to a source location, so
    // every edit is refused. It means the Babel plugin never saw the JSX.
    expect(
      stamps,
      'no data-muse-loc stamps in the served DOM — the museLoc Babel plugin did not run, so no ' +
        'element can resolve to a source location and every edit will be refused',
    ).toBeGreaterThan(0)
  })

  test('stamped paths resolve against the server root, not the launch directory', async ({ page }) => {
    const loc = await page.locator('[data-muse-loc]').first().getAttribute('data-muse-loc')
    expect(loc).toBeTruthy()

    // museLoc relativizes against Babel's cwd while the server resolves against
    // Vite's root; they agree only because the server is spawned with cwd = the
    // fixture. If that ever regresses the stamp grows a path prefix and every
    // edit fails as "not an editable file under src/" — with the file itself
    // looking perfectly fine.
    expect(
      loc,
      `stamped location "${loc}" is not rooted at src/ — the dev server was launched from a ` +
        'different directory than the one it serves, so stamped paths will not resolve',
    ).toMatch(/^src[\\/]/)
  })

  test('the overlay chrome is reachable inside the open shadow root', async ({ page }) => {
    // The overlay renders in an open shadow root, which is what makes it
    // automatable at all. Assert the dock resolves before any spec depends on
    // Playwright piercing the boundary.
    await expect(page.locator('[data-muse-dock]')).toBeVisible()
  })
})
