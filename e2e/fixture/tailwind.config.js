/** @type {import('tailwindcss').Config} */

// Serves two purposes, both load-bearing.
//
// 1. detectStrategy() in server/museCore.ts looks for exactly this file to
//    resolve the fixture as 'tailwind-first' rather than falling back to
//    'inline'. That decides whether an edit is written as `text-[length:20px]`
//    or as `style={{ fontSize: '20px' }}` — i.e. what the suite's source-byte
//    assertions are asserting. Detection is memoized per dev-server process
//    (ctx.detectedStrategy ??=), so it is settled once, on the first edit.
//
// 2. It drives the real JIT build (see postcss.config.js), so written classes
//    actually apply. The properties panel seeds from computed style, so without
//    a compiled stylesheet a second edit to the same element would re-read the
//    browser default instead of the value just written.
//
// Content globs resolve against cwd, which is this directory — the dev server is
// spawned with cwd = the fixture root.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
