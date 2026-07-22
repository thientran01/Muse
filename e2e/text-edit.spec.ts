import { expect, test } from '@playwright/test'
import { editTextInPlace, expectFixtureFile, openMuse, readFixtureFile, restoreFixtureFile } from './support/muse'

const FILE = 'src/TextTarget.tsx'
const TARGET = 'p:has-text("Edit this copy")'

test.describe('edit text in place', () => {
  test.beforeEach(async ({ page }) => {
    restoreFixtureFile(FILE)
    await page.goto('/')
    await openMuse(page)
  })

  test('rewrites the JSX text child in the source file', async ({ page }) => {
    expect(readFixtureFile(FILE)).toContain('<p>Edit this copy</p>')

    await editTextInPlace(page, TARGET, 'Rewritten copy')

    await expectFixtureFile(FILE, '<p>Rewritten copy</p>')
  })

  test('Escape cancels without writing', async ({ page }) => {
    const before = readFixtureFile(FILE)
    const node = page.locator(TARGET)

    await node.dblclick()
    await expect(node).toHaveAttribute('contenteditable', 'plaintext-only')
    await node.selectText()
    await page.keyboard.insertText('Discard me')
    await page.keyboard.press('Escape')

    // Escape restores the original text and must never reach the server. There
    // is no event to await for a request that should not happen, so settle
    // briefly and assert the file is byte-identical.
    await page.waitForTimeout(300)
    expect(readFixtureFile(FILE)).toBe(before)
    expect(readFixtureFile(FILE)).toContain('Edit this copy')
  })

  test('touches only the target element, not its siblings', async ({ page }) => {
    const before = readFixtureFile(FILE)

    await editTextInPlace(page, TARGET, 'Only me')
    await expectFixtureFile(FILE, '<p>Only me</p>')

    const after = readFixtureFile(FILE)

    // The sibling <strong> shares the parent and is the kind of node a
    // mis-targeted text edit would clobber.
    expect(after).toContain('<strong>Not the target</strong>')

    const changed = before.split('\n').filter((line, i) => line !== after.split('\n')[i])
    expect(changed).toHaveLength(1)
    expect(after.split('\n')).toHaveLength(before.split('\n').length)
  })
})
