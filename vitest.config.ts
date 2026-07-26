import { defineConfig } from 'vitest/config'

// Engine-only test harness: the suites under server/__tests__ exercise the pure
// AST/CSS editors (computeStyleEdit + the cssVar/cssRule/styled editors) and the
// museCore handlers against throwaway tmp-dir fixture projects. Node environment,
// no DOM, no plugins — deliberately independent of the app's vite.config.ts so a
// test run never loads musePlugin or the Babel locator. The src/muse suites are
// mostly pure functions, which is why they fit the same node environment.
//
// The exception is cssomTokens.test.ts, which fakes `document` + the CSSOM classes
// on globalThis. That is deliberate rather than a reason to add jsdom: the bug it
// pins is that `CSSStyleRule` inherits from `CSSGroupingRule` on Firefox and not
// Chromium, so the test's whole job is to switch that prototype chain per engine —
// something a single real DOM implementation cannot do. jsdom would give one
// engine's semantics and silently lose the comparison.
export default defineConfig({
  test: {
    include: ['server/__tests__/**/*.test.ts', 'src/muse/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
