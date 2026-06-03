#!/usr/bin/env tsx
// =============================================================================
//  check-design-generator — a tiny deterministic harness for the design-brief
//  generator's availability gate (server/museCore.ts → generatorBlockerFor).
//
//  The "Generate design system" button can only run when BOTH its script is
//  vendored AND the `claude` CLI is on PATH. This asserts every combination maps
//  to the right outcome (button shown vs a "Needs setup: …" reason), so a vendored
//  host never again surfaces a button that errors after the click.
//
//    npx tsx scripts/check-design-generator.ts
// =============================================================================
import { generatorBlockerFor } from '../server/museCore'

let failed = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failed++
}

// Both present → no blocker (button runs).
ok(generatorBlockerFor(true, true) === null, 'script + claude on PATH → generator available')

// Script missing → script reason wins (the primary install gap).
const noScript = generatorBlockerFor(false, true)
ok(noScript !== null && /scripts\/gen-design-md\.mjs/.test(noScript), 'no script → reason names the missing script')

// Script present but no CLI → claude reason.
const noCli = generatorBlockerFor(true, false)
ok(noCli !== null && /claude/i.test(noCli), 'script present, no claude CLI → reason names the CLI')

// Both missing → script reason takes precedence (fix that first).
const neither = generatorBlockerFor(false, false)
ok(neither !== null && /scripts\/gen-design-md\.mjs/.test(neither), 'neither → script reason takes precedence')

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
