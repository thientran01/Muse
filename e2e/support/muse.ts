import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { FIXTURE_RUN, FIXTURE_SRC } from './paths'

/** Restore one fixture file from the pristine copy. Each spec owns its own file. */
export function restoreFixtureFile(rel: string): void {
  fs.copyFileSync(path.join(FIXTURE_SRC, rel), path.join(FIXTURE_RUN, rel))
}

export function readFixtureFile(rel: string): string {
  return fs.readFileSync(path.join(FIXTURE_RUN, rel), 'utf8')
}

/**
 * Assert on the fixture's source bytes. Polls rather than sleeping: a commit is
 * two sequential POSTs plus a write, and the app's own history is full of fixed
 * delays that rotted once the host changed.
 */
export async function expectFixtureFile(rel: string, expected: string | RegExp): Promise<void> {
  const poll = expect.poll(() => readFixtureFile(rel), {
    message: `fixture file ${rel} never reached the expected content`,
  })
  if (typeof expected === 'string') await poll.toContain(expected)
  else await poll.toMatch(expected)
}

/**
 * Open the overlay via the FAB.
 *
 * Not the `R` hotkey: that handler is a capture-phase document listener which
 * checks composedPath()[0] and silently no-ops whenever focus sits in any input,
 * and it TOGGLES — a second press closes Muse. The button is an explicit,
 * assertable target with none of that state dependence.
 */
export async function openMuse(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open Muse' }).click()
}

/**
 * Select a host element and wait for its properties card.
 *
 * Plain click only. Alt-click steps to the parent, Shift-click opens the flag
 * composer instead of selecting. Selection itself is synchronous, but the panel
 * is gated on computed values AND a measured position, and two async probes
 * (style-scope, reorderable) can still change its height afterwards — so this
 * waits on the panel node and callers must not cache bounding boxes across it.
 */
export async function selectElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click()
  await expect(page.locator('[data-muse-panel]')).toBeVisible()
}

/**
 * Expand a collapsed section in the properties panel.
 *
 * Only 'type' or 'size' is open on first mount, so anything else has to be
 * opened. Guarded on aria-expanded rather than clicked blindly, because the
 * open-section set lives in a module-scoped variable that survives every
 * selection change — a blind click on an already-open section CLOSES it.
 *
 * Safe for Color, Spacing, Size, Type and Classes. Appearance and Layout pass a
 * "set values" dot, and a dotted section's accessible name becomes
 * `${label}, has values set` while collapsed — so those need a different matcher.
 */
export async function expandSection(page: Page, name: string): Promise<void> {
  const header = page.getByRole('button', { name, exact: true })
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/**
 * Set a colour through the panel's picker via its hex field.
 *
 * The hex input is the only drag-free path into the picker: the saturation
 * square and hue slider are bare divs with no role, no label and no test hook,
 * so they are unaddressable without adding one.
 *
 * The commit rides on BLUR, not on Enter — Enter's handler merely calls blur(),
 * and that indirection is the picker's own duplicate-commit guard. Clicking away
 * would commit identically.
 */
export async function setColorViaHex(page: Page, rowLabel: string, hex: string): Promise<void> {
  await page.getByRole('button', { name: `Edit ${rowLabel} color` }).click()

  const field = page.getByLabel('Hex color')
  await expect(field).toBeVisible()
  await field.fill(hex)

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/muse/write') && r.status() === 200),
    field.press('Enter'),
  ])
}

/**
 * Replace an element's text in place.
 *
 * A real dblclick, not two timed clicks — the handler listens for the actual DOM
 * event and has no detail===2 heuristic. It targets the leaf under the cursor
 * rather than the current selection, so double-clicking after Alt-clicking to a
 * parent still edits the leaf.
 *
 * The properties panel unmounts the moment editing starts, which is BEFORE the
 * /text-editable probe resolves — so panel-gone is not proof the caret is live.
 * Wait for contentEditable on the node itself.
 */
export async function editTextInPlace(page: Page, selector: string, next: string): Promise<void> {
  const node = page.locator(selector)
  await node.dblclick()
  await expect(node).toHaveAttribute('contenteditable', 'plaintext-only')

  await node.selectText()
  await page.keyboard.insertText(next)

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/muse/write') && r.status() === 200),
    page.keyboard.press('Enter'),
  ])
}

/**
 * Nudge a numeric field with the keyboard and commit.
 *
 * The keyboard path is chosen over dragging the label because it needs no
 * pointer capture, no synthetic pointerId, and no coordinate maths. Two traps it
 * sidesteps, both real:
 *   - A pointerdown+pointerup on the label with zero movement still COMMITS
 *     (endDrag has no did-it-move guard), so a stray click there fires a genuine
 *     write.
 *   - Ctrl/Cmd chords are unsafe while a panel field has focus: CanvasMode's
 *     document-level handlers try to bail on INPUT targets, but a document
 *     listener sees the event retargeted to the shadow HOST (a div), so the bail
 *     never fires. Ctrl+Z there triggers Muse's file undo, Ctrl+Arrow a reorder.
 *     Plain arrows and Enter are unaffected.
 *
 * Each arrow press previews inline only; the single POST fires on blur, which is
 * what Enter triggers.
 */
export async function nudgeScrubField(page: Page, testId: string, presses: number): Promise<void> {
  const field = page.locator(`[data-testid="${testId}"]`)
  await field.click()
  for (let i = 0; i < presses; i++) await field.press('ArrowUp')

  // Enter calls blur(), and the commit rides on blur — so the request is what to
  // wait on, not the keypress. The write only follows when the engine actually
  // produced edits, so a refused edit surfaces here as a timeout rather than as
  // a silently-unchanged file.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/muse/write') && r.status() === 200),
    field.press('Enter'),
  ])
}
