import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Paths only — deliberately free of side effects. playwright.config.ts performs
// the fixture copy at load time, so a spec that imported the config to get these
// constants would re-run that copy mid-suite and wipe the file it was asserting
// on. Both the config and the specs import from here instead.
const here = path.dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = path.resolve(here, '../..')
export const FIXTURE_SRC = path.join(REPO_ROOT, 'e2e', 'fixture')
export const FIXTURE_RUN = path.join(REPO_ROOT, 'e2e', '.tmp-fixture')
