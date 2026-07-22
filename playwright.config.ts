import fs from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { FIXTURE_RUN, FIXTURE_SRC } from './e2e/support/paths'

// A fresh copy of the fixture, made at config-load time — before the web server
// starts and before any spec is collected, with no ordering assumption about
// globalSetup. Specs rewrite this copy; e2e/fixture/ is read-only at runtime.
//
// The copy sits at the same depth as the original (both directly under e2e/) so
// the relative imports inside it resolve identically in either location.
//
// Guarded to the main process. Playwright re-imports this config in every worker,
// and by then Vite is watching the fixture directory — on Windows the recursive
// remove then fails with EPERM, and re-copying mid-run would wipe the very file
// a spec is asserting on.
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(FIXTURE_RUN, { recursive: true, force: true })
  fs.cpSync(FIXTURE_SRC, FIXTURE_RUN, { recursive: true })
}

// 127.0.0.1, not 0.0.0.0 and not a LAN address: museCore's request guard accepts
// an Origin only when it matches /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
// and answers 403 otherwise. Keeping the whole harness on loopback makes that
// entire class of failure impossible.
const HOST = '127.0.0.1'
const PORT = 5199

export default defineConfig({
  testDir: './e2e',
  // Serial. One dev server backs the whole run, and specs mutate real files
  // under its root; parallel workers would contend over it and over HMR.
  workers: 1,
  fullyParallel: false,

  // Zero retries, deliberately. The reorder drag affordance is documented as
  // unreliably mounted at press time, so a retry would launder a real product
  // flake into a green check. If a spec is intermittent, that is a finding.
  retries: 0,

  // Generous per-test, because a commit is two sequential POSTs plus an HMR
  // round trip. Individual waits are still assertion-based, never sleeps.
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
    // No screenshot assertions anywhere in this suite: compositing has produced
    // false readings in this project (translucent surfaces render opaque, and
    // the preview renderer wedges its animation clock). Source bytes and
    // computed style are the only trusted signals. This is for debugging only.
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Spawned with cwd = the fixture copy. This is load-bearing: museLoc
    // relativizes the data-muse-loc stamp against Babel's cwd (which
    // @vitejs/plugin-react leaves as process.cwd()), while the server resolves
    // that path against Vite's root. They agree only when cwd IS the root.
    command: `npx vite --host ${HOST} --port ${PORT} --strictPort`,
    cwd: FIXTURE_RUN,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Pin the write path on. Vite's loadEnv lets process.env override .env
      // files, so an exported VITE_MUSE_EPHEMERAL=1 in the developer's shell
      // would otherwise win — and with EPHEMERAL on, every gesture short-circuits
      // before its fetch and no file is ever touched, so byte assertions fail
      // against an unchanged file with no clue as to why. preflight.spec.ts
      // checks the resolved values rather than trusting this.
      VITE_MUSE_MOCK: '0',
      VITE_MUSE_EPHEMERAL: '0',
      MUSE_MOCK: '0',
      MUSE_EPHEMERAL: '0',
    },
  },
})
