import { defineConfig } from 'vitest/config'

// Engine-only test harness: the suites under server/__tests__ exercise the pure
// AST/CSS editors (computeStyleEdit + the cssVar/cssRule/styled editors) and the
// museCore handlers against throwaway tmp-dir fixture projects. Node environment,
// no DOM, no plugins — deliberately independent of the app's vite.config.ts so a
// test run never loads musePlugin or the Babel locator.
export default defineConfig({
  test: {
    include: ['server/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
