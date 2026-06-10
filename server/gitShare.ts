// ============================================================
//  SHARE CHANGES — deterministic git plumbing (no checkout, no AI)
// ------------------------------------------------------------
//  Turns a Canvas session's touched files into a reviewable branch/commit/PR
//  for a designer who doesn't know git. The core invariant: the user's working
//  tree, index, and checked-out branch are NEVER touched. The commit is built
//  against a TEMPORARY index (GIT_INDEX_FILE) and lands on a fresh `muse/*`
//  ref via update-ref — so the screen never flickers, unrelated dirty files
//  stay untouched by construction, and committing to main is impossible.
//
//  Plumbing also means hooks and commit signing never run (commit-tree skips
//  both), so a host repo's husky/gpg setup can't wedge a non-technical user.
//
//  Everything here is deterministic: branch names, commit messages, and PR
//  bodies are built from the client's edit labels — no model call anywhere.
// ============================================================
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ShareChange, ShareProbe, ShareRemote, ShareResult } from '../src/muse/types'

// ---- process runner -------------------------------------------------------------

export type RunResult = { code: number; stdout: string; stderr: string }
export type RunOpts = { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
export type Runner = (bin: string, args: string[], opts?: RunOpts) => Promise<RunResult>

// Sentinel exit codes (never collide with real git codes in practice).
const CODE_NOT_FOUND = 127
const CODE_TIMEOUT = 124

// The ONLY way git/gh is invoked: execFile (no shell), explicit args, hard timeout,
// and a prompt-proof env so a push can never hang waiting for credentials.
export const defaultRun: Runner = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 15_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      },
      (err, stdout, stderr) => {
        const so = String(stdout ?? '')
        const se = String(stderr ?? '')
        if (!err) return resolve({ code: 0, stdout: so, stderr: se })
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
        if (e.code === 'ENOENT') return resolve({ code: CODE_NOT_FOUND, stdout: so, stderr: 'not found' })
        if (e.killed) return resolve({ code: CODE_TIMEOUT, stdout: so, stderr: se || 'timed out' })
        resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout: so, stderr: se })
      },
    )
  })

// Env for every git call: never prompt for credentials (terminal or ssh). The ssh
// override is only applied when the user hasn't set their own GIT_SSH_COMMAND.
function gitEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', ...extra }
  if (!process.env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -oBatchMode=yes'
  return env
}

type Git = (args: string[], o?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<RunResult>

function makeGit(root: string, run: Runner): Git {
  return (args, o) => run('git', args, { cwd: root, timeoutMs: o?.timeoutMs, env: gitEnv(o?.env) })
}

// ---- gh detection (memoized, like the old findClaudeBin) -------------------------

let ghCache: boolean | undefined

export function resetGhCacheForTests(): void {
  ghCache = undefined
}

async function detectGh(run: Runner): Promise<boolean> {
  // Only memoize for the real runner — injected test runners must not poison the cache.
  if (run === defaultRun && ghCache !== undefined) return ghCache
  const r = await run('gh', ['--version'], { timeoutMs: 5_000 })
  const ok = r.code === 0
  if (run === defaultRun) ghCache = ok
  return ok
}

// ---- pure builders ---------------------------------------------------------------

// "padding 8px" → "padding-8px". Falls back to a generic slug so the branch name
// is always valid (git refuses empty segments, leading dots, "..", etc.).
export function slugify(label: string | undefined): string {
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return slug || 'design-edits'
}

export function buildBranchName(slugHint: string | undefined, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `muse/${slugify(slugHint)}-${stamp}`
}

// Deterministic commit message from the session's edit labels. Title = the first
// label + a count; body = per-file bullets. No inference, no summarization.
export function buildCommitMessage(changes: ShareChange[]): { title: string; body: string } {
  const labels = changes.flatMap((c) => c.labels)
  const first = labels[0] ?? 'design edits'
  const rest = labels.length - 1
  const title =
    rest > 0 ? `Muse: ${first} and ${rest} more design edit${rest === 1 ? '' : 's'}` : `Muse: ${first}`
  const bullets = changes.map((c) => `- ${c.fileName}: ${c.labels.join(', ') || 'edited'}`)
  const body = `${bullets.join('\n')}\n\nDesign edits made with Muse.`
  return { title, body }
}

export function parseRemote(url: string): ShareRemote {
  const m =
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url) ??
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ??
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  if (m) return { url, host: 'github', owner: m[1], repo: m[2] }
  return { url, host: 'other' }
}

// GitHub-only in v1; other hosts fall back to branch-name messaging.
export function compareUrlFor(remote: ShareRemote, defaultBranch: string | null, branch: string): string | null {
  if (remote.host !== 'github' || !remote.owner || !remote.repo) return null
  const base = defaultBranch ?? 'main'
  return `https://github.com/${remote.owner}/${remote.repo}/compare/${base}...${branch}?expand=1`
}

// ---- probe ------------------------------------------------------------------------

// Fail-closed capability probe, each missing piece mapped to a designer-readable
// reason (the "never show an action that errors after the click" discipline).
export async function probeShare(
  root: string,
  sessionFiles: string[],
  opts?: { run?: Runner },
): Promise<ShareProbe> {
  const run = opts?.run ?? defaultRun
  const git = makeGit(root, run)
  try {
    const version = await git(['--version'])
    if (version.code === CODE_NOT_FOUND) {
      return { available: false, reason: 'Git isn’t installed on this machine, so changes can’t be shared from here.' }
    }
    if (version.code !== 0) {
      return { available: false, reason: 'Git didn’t respond — try again, or ask an engineer to take a look.' }
    }

    const inTree = await git(['rev-parse', '--is-inside-work-tree'])
    if (inTree.code !== 0 || inTree.stdout.trim() !== 'true') {
      return { available: false, reason: 'This project isn’t a git repository, so there’s nothing to share to.' }
    }

    const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'])
    if (head.code !== 0) {
      return { available: false, reason: 'The repository has no commits yet — ask an engineer to make the first commit.' }
    }

    const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const branchName = branchRes.stdout.trim()
    const detached = branchName === 'HEAD'

    const remoteRes = await git(['remote', 'get-url', 'origin'])
    const remote = remoteRes.code === 0 && remoteRes.stdout.trim() ? parseRemote(remoteRes.stdout.trim()) : null

    const emailRes = await git(['config', 'user.email'])
    const hasIdentity = emailRes.code === 0 && emailRes.stdout.trim().length > 0

    const ghAvailable = await detectGh(run)

    let defaultBranch: string | null = null
    if (remote) {
      const sym = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      if (sym.code === 0 && sym.stdout.trim()) {
        defaultBranch = sym.stdout.trim().replace(/^origin\//, '')
      } else {
        for (const guess of ['main', 'master']) {
          const r = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${guess}`])
          if (r.code === 0) { defaultBranch = guess; break }
        }
      }
    }

    const dirtyOtherCount = await countDirtyOthers(git, sessionFiles)

    return {
      available: true,
      branch: detached ? null : branchName,
      detached,
      remote,
      ghAvailable,
      defaultBranch,
      hasIdentity,
      dirtyOtherCount,
    }
  } catch (err) {
    console.error('[muse] share probe error:', err)
    return { available: false, reason: 'Couldn’t check the repository — try again, or ask an engineer to take a look.' }
  }
}

// Count dirty files that are NOT part of the session — informational only (the share
// never touches them; the panel can mention them so a designer isn't surprised that
// other in-flight work doesn't ride along). `.muse/` state is Muse's own — excluded.
async function countDirtyOthers(git: Git, sessionFiles: string[]): Promise<number> {
  const status = await git(['status', '--porcelain'])
  if (status.code !== 0) return 0
  // Porcelain paths are relative to the repo TOPLEVEL; session files are relative to
  // MUSE_ROOT, which may be a subdirectory (monorepo). --show-prefix bridges the two.
  const prefixRes = await git(['rev-parse', '--show-prefix'])
  const prefix = prefixRes.code === 0 ? prefixRes.stdout.trim() : ''
  const session = new Set(sessionFiles.map((f) => prefix + f.replace(/\\/g, '/')))
  let count = 0
  for (const line of status.stdout.split('\n')) {
    if (!line.trim()) continue
    // "XY path" or "XY old -> new"; quoted when the path has special chars.
    let p = line.slice(3)
    const arrow = p.indexOf(' -> ')
    if (arrow !== -1) p = p.slice(arrow + 4)
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
    if (p.startsWith('.muse/') || session.has(p)) continue
    count++
  }
  return count
}

// ---- commit plumbing ---------------------------------------------------------------

export type ShareCommit = { commit: string; tree: string; noChanges: boolean }

// Build a commit of `files` (paths relative to root, content read from DISK — what the
// designer is looking at) on top of `parentRef`, without touching the user's index or
// working tree. The temp index starts from the parent's tree, so every path NOT in
// `files` is byte-identical to the parent by construction.
export async function createShareCommit(
  root: string,
  files: string[],
  message: { title: string; body: string },
  opts: { parentRef: string; run?: Runner; authorEnv?: Record<string, string>; indexFile?: string },
): Promise<ShareCommit> {
  const run = opts.run ?? defaultRun
  const git = makeGit(root, run)
  const indexFile =
    opts.indexFile ??
    path.join(os.tmpdir(), `muse-share-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    const parentSha = (await must(git(['rev-parse', '--verify', `${opts.parentRef}^{commit}`]), 'resolve the base commit')).stdout.trim()
    const parentTree = (await must(git(['rev-parse', `${parentSha}^{tree}`]), 'resolve the base tree')).stdout.trim()

    await must(git(['read-tree', parentSha], { env }), 'prepare the share index')
    // update-index runs the same clean filters a normal `git add` would, so the
    // committed blob matches a hand-made commit (CRLF behavior included).
    await must(git(['update-index', '--add', '--', ...files], { env }), 'stage the session files')
    const tree = (await must(git(['write-tree'], { env }), 'write the share tree')).stdout.trim()

    if (tree === parentTree) return { commit: parentSha, tree, noChanges: true }

    const commit = (
      await must(
        git(['commit-tree', tree, '-p', parentSha, '-m', `${message.title}\n\n${message.body}`], {
          env: { ...env, ...opts.authorEnv },
        }),
        'create the share commit',
      )
    ).stdout.trim()
    return { commit, tree, noChanges: false }
  } finally {
    try { fs.unlinkSync(indexFile) } catch { /* never created, or already gone */ }
  }
}

async function must(p: Promise<RunResult>, what: string): Promise<RunResult> {
  const r = await p
  if (r.code !== 0) throw new Error(`Couldn’t ${what}: ${r.stderr.trim() || `git exited ${r.code}`}`)
  return r
}

// ---- push + PR -----------------------------------------------------------------------

export async function pushBranch(
  root: string,
  branch: string,
  opts?: { run?: Runner },
): Promise<{ pushed: boolean; reason?: string }> {
  const run = opts?.run ?? defaultRun
  const git = makeGit(root, run)
  const r = await git(['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], { timeoutMs: 60_000 })
  if (r.code === 0) return { pushed: true }
  const err = r.stderr.toLowerCase()
  let reason = 'Couldn’t upload to the remote.'
  if (r.code === CODE_TIMEOUT) {
    reason = 'Uploading timed out.'
  } else if (/authentication|permission denied|403|could not read username|publickey|access denied/.test(err)) {
    reason = 'Couldn’t sign in to the remote to upload.'
  } else if (/could not resolve host|unable to access|network|connection|couldn't connect/.test(err)) {
    reason = 'Couldn’t reach the remote (network).'
  }
  return { pushed: false, reason }
}

export async function createPr(
  root: string,
  branch: string,
  title: string,
  body: string,
  opts?: { run?: Runner },
): Promise<{ prUrl: string | null; reason?: string }> {
  const run = opts?.run ?? defaultRun
  const ghOpts = { cwd: root, timeoutMs: 60_000 }
  // --head works without checking the branch out — the whole pipeline never switches.
  const r = await run('gh', ['pr', 'create', '--head', branch, '--title', title, '--body', body], ghOpts)
  if (r.code === 0) {
    const url = /https:\/\/\S+/.exec(r.stdout)?.[0] ?? null
    return url ? { prUrl: url } : { prUrl: null, reason: 'The pull request was created but its link couldn’t be read.' }
  }
  if (/already exists/i.test(r.stderr)) {
    // Share-again on the same branch: the PR is already open — reuse its URL.
    const view = await run('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], ghOpts)
    const url = view.code === 0 ? view.stdout.trim() : ''
    if (url) return { prUrl: url }
  }
  return { prUrl: null, reason: 'Couldn’t open a pull request automatically.' }
}

// ---- orchestration --------------------------------------------------------------------

const MUSE_IDENTITY = {
  GIT_AUTHOR_NAME: 'Muse',
  GIT_AUTHOR_EMAIL: 'muse@localhost',
  GIT_COMMITTER_NAME: 'Muse',
  GIT_COMMITTER_EMAIL: 'muse@localhost',
}

export type PerformShareRequest = {
  files: string[]
  changes: ShareChange[]
  slugHint?: string
  branch?: string
}

// The full share flow. `files` must already be validated by the caller (the handler
// gates every path through resolveInSrc, same as /write). Degradations append warnings
// on an ok:true result — the local branch is the success floor.
export async function performShare(
  root: string,
  req: PerformShareRequest,
  opts?: { run?: Runner; now?: Date },
): Promise<ShareResult> {
  const run = opts?.run ?? defaultRun
  const git = makeGit(root, run)
  const warnings: string[] = []
  try {
    const probe = await probeShare(root, req.files, { run })
    if (!probe.available) return { ok: false, error: probe.reason }

    // Drop files whose disk state matches HEAD (net-zero after undos). Untracked
    // files are invisible to `git diff`, so they're always included.
    const files: string[] = []
    for (const f of req.files) {
      const tracked = (await git(['ls-files', '--error-unmatch', '--', f])).code === 0
      if (!tracked) { files.push(f); continue }
      const diff = await git(['diff', '--quiet', 'HEAD', '--', f])
      if (diff.code === 0) warnings.push(`${f} already matches the last commit — skipped.`)
      else files.push(f)
    }
    if (files.length === 0) {
      return { ok: false, error: 'No changes to share — everything already matches the last commit.' }
    }

    // Branch: continue this session's share branch when the client sends one (and it
    // still exists and is ours), else mint a fresh unique muse/* name.
    let branch: string
    let parentRef: string
    const requested = typeof req.branch === 'string' ? req.branch : ''
    const requestedExists =
      /^muse\//.test(requested) &&
      (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${requested}`])).code === 0
    if (requestedExists) {
      branch = requested
      parentRef = `refs/heads/${requested}`
    } else {
      const base = buildBranchName(req.slugHint ?? req.changes[0]?.labels[0], opts?.now ?? new Date())
      branch = base
      for (let i = 2; (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0; i++) {
        if (i > 99) return { ok: false, error: 'Couldn’t find a free branch name — clean up old muse/* branches.' }
        branch = `${base}-${i}`
      }
      parentRef = 'HEAD'
    }

    const authorEnv = probe.hasIdentity ? undefined : MUSE_IDENTITY
    if (!probe.hasIdentity) {
      warnings.push('Committed as "Muse" — set git user.name and user.email to commit as yourself.')
    }

    const message = buildCommitMessage(req.changes)
    const built = await createShareCommit(root, files, message, { parentRef, run, authorEnv })

    if (built.noChanges) {
      // Tree-identical to the share branch's tip: already shared. Surface the existing
      // PR link when gh can tell us; otherwise the client still has it in its store.
      let prUrl: string | undefined
      if (probe.ghAvailable && probe.remote) {
        const view = await run('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], { cwd: root, timeoutMs: 30_000 })
        if (view.code === 0 && view.stdout.trim()) prUrl = view.stdout.trim()
      }
      return { ok: true, branch, commit: built.commit, pushed: false, alreadyShared: true, prUrl, warnings }
    }

    await must(git(['update-ref', `refs/heads/${branch}`, built.commit]), 'create the share branch')

    if (!probe.remote) {
      warnings.push(`No remote is configured — your changes are saved locally on branch ${branch}.`)
      return { ok: true, branch, commit: built.commit, pushed: false, warnings }
    }

    const push = await pushBranch(root, branch, { run })
    if (!push.pushed) {
      warnings.push(
        `${push.reason ?? 'Couldn’t upload to the remote.'} Your changes are saved on branch ${branch} — ask an engineer to run: git push origin ${branch}`,
      )
      return { ok: true, branch, commit: built.commit, pushed: false, warnings }
    }

    if (probe.ghAvailable) {
      const pr = await createPr(root, branch, message.title, message.body, { run })
      if (pr.prUrl) return { ok: true, branch, commit: built.commit, pushed: true, prUrl: pr.prUrl, warnings }
      if (pr.reason) warnings.push(pr.reason)
    }

    const compareUrl = probe.remote ? compareUrlFor(probe.remote, probe.defaultBranch, branch) : null
    if (compareUrl) {
      return { ok: true, branch, commit: built.commit, pushed: true, compareUrl, warnings }
    }
    warnings.push(`Branch ${branch} was uploaded — ask an engineer to open a pull request for it.`)
    return { ok: true, branch, commit: built.commit, pushed: true, warnings }
  } catch (err) {
    console.error('[muse] share error:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Sharing failed unexpectedly.' }
  }
}
