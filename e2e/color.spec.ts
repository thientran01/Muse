import { expect, test } from '@playwright/test'
import { expandSection, expectFixtureFile, openMuse, readFixtureFile, restoreFixtureFile, selectElement, setColorViaHex } from './support/muse'

const FILE = 'src/ColorTarget.tsx'
const TARGET = 'div.bg-white'

/**
 * Picking a colour. Guards the two things that have actually regressed here:
 * duplicate commits (#146) and alpha survival through `#rrggbbaa` (#146).
 */
test.describe('pick a color', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    await page.goto('/')
    await openMuse(page)
    await selectElement(page, TARGET)
    // Color is never the initially-open section — that is 'type' for an element
    // rendering direct text, 'size' otherwise.
    await expandSection(page, 'Color')
  })

  test('rewrites the background class in the source file', async ({ page }) => {
    expect(readFixtureFile(FILE)).toContain('className="bg-white"')

    await setColorViaHex(page, 'Fill', '#ff0000')

    // Off the named scale, so the engine emits the arbitrary form and replaces
    // bg-white in place rather than appending alongside it.
    await expectFixtureFile(FILE, 'className="bg-[#ff0000]"')
    expect(readFixtureFile(FILE)).not.toContain('bg-white')
  })

  test('preserves alpha through the eight-digit hex form', async ({ page }) => {
    await setColorViaHex(page, 'Fill', '#ff000080')

    // The alpha byte must survive normalization into the written token. This is
    // the #146 regression: alpha was previously dropped on the way through.
    await expectFixtureFile(FILE, 'className="bg-[#ff000080]"')
  })

  test('commits exactly once per pick', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/muse/write')) writes.push(r.url())
    })

    await setColorViaHex(page, 'Fill', '#123456')
    await expectFixtureFile(FILE, 'bg-[#123456]')

    // The picker's Enter handler deliberately does not commit — it calls blur(),
    // and blur is the single commit trigger. If that indirection is ever
    // removed, Enter fires a commit AND the subsequent blur fires a second one,
    // which is exactly the duplicate-commit bug from #146.
    //
    // The one deliberate fixed delay in the suite. Asserting that a second
    // request never arrives requires a quiet window — there is no event to wait
    // for when the thing you want is an absence. Kept short and confined to this
    // assertion; everywhere else waits on a real signal.
    await page.waitForTimeout(250)
    expect(writes).toHaveLength(1)
  })

  test('leaves the rest of the file untouched', async ({ page }) => {
    const before = readFixtureFile(FILE)

    await setColorViaHex(page, 'Fill', '#ff0000')
    await expectFixtureFile(FILE, 'bg-[#ff0000]')

    const after = readFixtureFile(FILE)
    const changed = before.split('\n').filter((line, i) => line !== after.split('\n')[i])
    expect(changed).toHaveLength(1)
    expect(after.split('\n')).toHaveLength(before.split('\n').length)
  })
})
