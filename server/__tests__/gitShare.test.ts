// ============================================================
//  gitShare — share-changes plumbing over throwaway git repos
// ------------------------------------------------------------
//  Pins the share pipeline's core invariant: the user's working tree, index,
//  and checked-out branch are NEVER touched — the commit is built against a
//  temp index and lands on a fresh muse/* ref. Real git repos in tmp dirs
//  (CI has git on both ubuntu and windows); gh is always faked via an
//  injected runner so the suite never talks to a real forge.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildBranchName,
  buildCommitMessage,
  compareUrlFor,
  createPr,
  createShareCommit,
  defaultRun,
  parseRemote,
  performShare,
  probeShare,
  pushBranch,
  slugify,
  type RunResult,
  type Runner,
} from '../gitShare'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const crlf = (s: string) => s.replace(/\n/g, '\r\n')

// ---- fixture helpers --------------------------------------------------------------

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

function sh(cwd: string, bin: string, args: string[]): string {
  return execFileSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true })
}

function shCode(cwd: string, args: string[]): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? 1
  }
}

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-git-'))
  roots.push(dir)
  return dir
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

// A committed repo on branch `main` with deterministic config: a local identity,
// no autocrlf (so CRLF assertions are byte-exact), no signing surprises.
function makeGitProject(files: Record<string, string>): string {
  const root = tmpDir()
  writeFiles(root, files)
  sh(root, 'git', ['init', '-b', 'main'])
  sh(root, 'git', ['config', 'user.name', 'Test'])
  sh(root, 'git', ['config', 'user.email', 'test@example.com'])
  sh(root, 'git', ['config', 'core.autocrlf', 'false'])
  sh(root, 'git', ['config', 'commit.gpgsign', 'false'])
  sh(root, 'git', ['add', '-A'])
  sh(root, 'git', ['commit', '-m', 'init'])
  return root
}

// gh is never real in this suite: `noGh` reports it missing; `withFakeGh` scripts it.
const noGh: Runner = (bin, args, opts) =>
  bin === 'gh' ? Promise.resolve({ code: 127, stdout: '', stderr: 'not found' }) : defaultRun(bin, args, opts)

function withFakeGh(impl: (args: string[]) => RunResult): { run: Runner; calls: string[][] } {
  const calls: string[][] = []
  const run: Runner = (bin, args, opts) => {
    if (bin !== 'gh') return defaultRun(bin, args, opts)
    calls.push(args)
    return Promise.resolve(impl(args))
  }
  return { run, calls }
}

const NOW = new Date(2026, 5, 10, 14, 30) // 2026-06-10 14:30 local
const STAMP = '20260610-1430'

const baseFiles = {
  'src/App.tsx': 'export const App = () => <div className="p-4">hi</div>\n',
  'src/Other.tsx': 'export const Other = () => <span>other</span>\n',
}

const CHANGES = [{ fileName: 'src/App.tsx', labels: ['padding 8px'] }]

// ---- pure builders ------------------------------------------------------------------

describe('pure builders', () => {
  it('slugify normalizes labels into branch-safe slugs', () => {
    expect(slugify('Padding 8px')).toBe('padding-8px')
    expect(slugify('  Text: “Hello, World!”  ')).toBe('text-hello-world')
    expect(slugify('')).toBe('design-edits')
    expect(slugify(undefined)).toBe('design-edits')
    expect(slugify('***')).toBe('design-edits')
    const long = slugify('a very long label that keeps going and going')
    expect(long.length).toBeLessThanOrEqual(24)
    expect(long.endsWith('-')).toBe(false)
  })

  it('buildBranchName stamps muse/<slug>-<yyyymmdd-hhmm>', () => {
    expect(buildBranchName('padding 8px', NOW)).toBe(`muse/padding-8px-${STAMP}`)
    expect(buildBranchName(undefined, NOW)).toBe(`muse/design-edits-${STAMP}`)
  })

  it('buildCommitMessage is deterministic from labels', () => {
    const single = buildCommitMessage(CHANGES)
    expect(single.title).toBe('Muse: padding 8px')
    expect(single.body).toContain('- src/App.tsx: padding 8px')

    const multi = buildCommitMessage([
      { fileName: 'src/App.tsx', labels: ['padding 8px', 'color #fff'] },
      { fileName: 'src/Other.tsx', labels: ['reorder'] },
    ])
    expect(multi.title).toBe('Muse: padding 8px and 2 more design edits')
    expect(multi.body).toContain('- src/App.tsx: padding 8px, color #fff')
    expect(multi.body).toContain('- src/Other.tsx: reorder')
  })

  it('parseRemote handles GitHub https/ssh forms and falls back to other', () => {
    expect(parseRemote('https://github.com/foo/bar.git')).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar' })
    expect(parseRemote('https://github.com/foo/bar')).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar' })
    expect(parseRemote('git@github.com:foo/bar.git')).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar' })
    expect(parseRemote('ssh://git@github.com/foo/bar.git')).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar' })
    expect(parseRemote('https://gitlab.com/foo/bar.git')).toMatchObject({ host: 'other' })
  })

  it('compareUrlFor builds GitHub compare links only', () => {
    const remote = parseRemote('https://github.com/foo/bar.git')
    expect(compareUrlFor(remote, 'develop', 'muse/x-1')).toBe('https://github.com/foo/bar/compare/develop...muse/x-1?expand=1')
    expect(compareUrlFor(remote, null, 'muse/x-1')).toBe('https://github.com/foo/bar/compare/main...muse/x-1?expand=1')
    expect(compareUrlFor(parseRemote('https://gitlab.com/foo/bar.git'), 'main', 'muse/x-1')).toBeNull()
  })
})

// ---- probe ----------------------------------------------------------------------------

describe.skipIf(!hasGit)('probeShare', () => {
  it('fails closed outside a git repository', async () => {
    const root = tmpDir()
    const probe = await probeShare(root, [], { run: noGh })
    expect(probe).toMatchObject({ available: false })
    if (!probe.available) expect(probe.reason).toContain('repository')
  })

  it('fails closed when git itself is missing', async () => {
    const root = tmpDir()
    const gitless: Runner = () => Promise.resolve({ code: 127, stdout: '', stderr: 'not found' })
    const probe = await probeShare(root, [], { run: gitless })
    expect(probe).toMatchObject({ available: false })
    if (!probe.available) expect(probe.reason.toLowerCase()).toContain('installed')
  })

  it('fails closed on a repo with no commits', async () => {
    const root = tmpDir()
    sh(root, 'git', ['init', '-b', 'main'])
    const probe = await probeShare(root, [], { run: noGh })
    expect(probe).toMatchObject({ available: false })
    if (!probe.available) expect(probe.reason).toContain('no commits')
  })

  it('reports branch, identity, remote and dirty counts on a healthy repo', async () => {
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['remote', 'add', 'origin', 'https://github.com/foo/bar.git'])
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')
    fs.writeFileSync(path.join(root, 'src', 'Other.tsx'), 'changed too\n')
    fs.mkdirSync(path.join(root, '.muse'), { recursive: true })
    fs.writeFileSync(path.join(root, '.muse', 'flags.json'), '{}\n')

    const probe = await probeShare(root, ['src/App.tsx'], { run: noGh })
    expect(probe).toMatchObject({
      available: true,
      branch: 'main',
      detached: false,
      ghAvailable: false,
      hasIdentity: true,
    })
    if (probe.available) {
      expect(probe.remote).toMatchObject({ host: 'github', owner: 'foo', repo: 'bar' })
      // Other.tsx is dirty and not in the session; .muse/ state never counts.
      expect(probe.dirtyOtherCount).toBe(1)
    }
  })

  it('reports detached HEAD as available with branch null', async () => {
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['checkout', '--detach'])
    const probe = await probeShare(root, [], { run: noGh })
    expect(probe).toMatchObject({ available: true, branch: null, detached: true })
  })
})

// ---- the core invariant: share without touching the user's state ----------------------

describe.skipIf(!hasGit)('performShare', () => {
  it('creates a muse/* branch without touching branch, index, or working tree', async () => {
    const root = makeGitProject(baseFiles)
    const edited = 'export const App = () => <div className="p-8">hi</div>\n'
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), edited)
    fs.writeFileSync(path.join(root, 'src', 'Other.tsx'), 'unrelated dirty work\n')

    const r = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.branch).toBe(`muse/padding-8px-${STAMP}`)
    expect(r.pushed).toBe(false) // no remote
    expect(r.warnings.join(' ')).toContain('No remote')

    // The user's world is untouched:
    expect(sh(root, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main')
    expect(shCode(root, ['diff', '--cached', '--quiet'])).toBe(0) // nothing staged
    const status = sh(root, 'git', ['status', '--porcelain'])
    expect(status).toContain('src/App.tsx') // still dirty in the working tree
    expect(status).toContain('src/Other.tsx')

    // The share commit holds exactly the session file, at its disk content:
    const names = sh(root, 'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', r.commit]).trim().split('\n')
    expect(names).toEqual(['src/App.tsx'])
    expect(sh(root, 'git', ['show', `${r.branch}:src/App.tsx`])).toBe(edited)
    // Unrelated dirty work did NOT ride along:
    expect(sh(root, 'git', ['show', `${r.branch}:src/Other.tsx`])).toBe(baseFiles['src/Other.tsx'])
  })

  it('includes untracked session files', async () => {
    const root = makeGitProject(baseFiles)
    const fresh = '.brand { color: red; }\n'
    fs.writeFileSync(path.join(root, 'src', 'new.css'), fresh)

    const r = await performShare(
      root,
      { files: ['src/new.css'], changes: [{ fileName: 'src/new.css', labels: ['new token sheet'] }] },
      { run: noGh, now: NOW },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(sh(root, 'git', ['show', `${r.branch}:src/new.css`])).toBe(fresh)
  })

  it('preserves CRLF byte-exact in the committed blob', async () => {
    const root = makeGitProject({ 'src/App.tsx': crlf(baseFiles['src/App.tsx']) })
    const edited = crlf('export const App = () => <div className="p-8">hi</div>\n')
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), edited)

    const r = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(sh(root, 'git', ['show', `${r.branch}:src/App.tsx`])).toBe(edited)
  })

  it('skips net-zero files with a warning and refuses an all-clean share', async () => {
    const root = makeGitProject(baseFiles)
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')

    const r = await performShare(
      root,
      { files: ['src/App.tsx', 'src/Other.tsx'], changes: CHANGES },
      { run: noGh, now: NOW },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.join(' ')).toContain('src/Other.tsx')
    const names = sh(root, 'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', r.commit]).trim().split('\n')
    expect(names).toEqual(['src/App.tsx'])

    const clean = await performShare(root, { files: ['src/Other.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(clean.ok).toBe(false)
    if (!clean.ok) expect(clean.error).toContain('No changes to share')
  })

  it('suffixes the branch name on collision', async () => {
    const root = makeGitProject(baseFiles)
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed once\n')
    const first = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(first.ok).toBe(true)

    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed twice\n')
    // No `branch` sent (fresh client) + same timestamp → same base name → -2 suffix.
    const second = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.branch).toBe(`${first.branch}-2`)
  })

  it('share-again on the same branch: no-op when tree-identical, append when edited', async () => {
    const root = makeGitProject(baseFiles)
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')
    const first = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const again = await performShare(
      root,
      { files: ['src/App.tsx'], changes: CHANGES, branch: first.branch },
      { run: noGh, now: NOW },
    )
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.alreadyShared).toBe(true)
    expect(again.branch).toBe(first.branch)
    expect(sh(root, 'git', ['rev-list', '--count', first.branch]).trim()).toBe('2') // init + share

    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed more\n')
    const appended = await performShare(
      root,
      { files: ['src/App.tsx'], changes: CHANGES, branch: first.branch },
      { run: noGh, now: NOW },
    )
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(appended.alreadyShared).toBeUndefined()
    expect(appended.branch).toBe(first.branch)
    expect(sh(root, 'git', ['rev-list', '--count', first.branch]).trim()).toBe('3')
    expect(sh(root, 'git', ['show', `${first.branch}:src/App.tsx`])).toBe('changed more\n')
  })

  it('falls back to a Muse identity when user.email is unset', async () => {
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['config', 'user.email', ''])
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')

    const r = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.join(' ')).toContain('Muse')
    expect(sh(root, 'git', ['log', '-1', '--format=%ae', r.branch]).trim()).toBe('muse@localhost')
  })

  it('pushes to a reachable remote and keeps the branch when the remote is unreachable', async () => {
    const bare = tmpDir()
    sh(bare, 'git', ['init', '--bare'])
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['remote', 'add', 'origin', bare])
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')

    const r = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.pushed).toBe(true)
    // The ref landed in the remote:
    expect(sh(bare, 'git', ['rev-parse', `refs/heads/${r.branch}`]).trim()).toBe(r.commit)
    // Local bare path is not GitHub → no compare URL, just the uploaded-branch message.
    expect(r.compareUrl).toBeUndefined()

    // Unreachable remote: branch survives locally with a friendly warning.
    sh(root, 'git', ['remote', 'set-url', 'origin', path.join(bare, 'does-not-exist')])
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed again\n')
    const failed = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    expect(failed.pushed).toBe(false)
    expect(failed.warnings.join(' ')).toContain(failed.branch)
    expect(sh(root, 'git', ['rev-parse', '--verify', `refs/heads/${failed.branch}`]).trim()).toBe(failed.commit)
  })

  it('opens a PR through gh when available, with the deterministic title/body', async () => {
    const bare = tmpDir()
    sh(bare, 'git', ['init', '--bare'])
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['remote', 'add', 'origin', bare])
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')

    const gh = withFakeGh((args) =>
      args[0] === '--version'
        ? { code: 0, stdout: 'gh version 2', stderr: '' }
        : { code: 0, stdout: 'https://github.com/foo/bar/pull/7\n', stderr: '' },
    )
    const r = await performShare(root, { files: ['src/App.tsx'], changes: CHANGES }, { run: gh.run, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prUrl).toBe('https://github.com/foo/bar/pull/7')
    const create = gh.calls.find((c) => c[0] === 'pr' && c[1] === 'create')
    expect(create).toEqual([
      'pr', 'create',
      '--head', r.branch,
      '--title', 'Muse: padding 8px',
      '--body', expect.stringContaining('- src/App.tsx: padding 8px'),
    ])
  })

  it('works when MUSE_ROOT is a subdirectory of the git toplevel (monorepo)', async () => {
    const top = makeGitProject({ 'app/src/App.tsx': baseFiles['src/App.tsx'], 'README.md': 'top\n' })
    const appRoot = path.join(top, 'app')
    fs.writeFileSync(path.join(appRoot, 'src', 'App.tsx'), 'changed\n')
    fs.writeFileSync(path.join(top, 'README.md'), 'top dirty\n')

    const probe = await probeShare(appRoot, ['src/App.tsx'], { run: noGh })
    expect(probe).toMatchObject({ available: true })
    if (probe.available) expect(probe.dirtyOtherCount).toBe(1) // the toplevel README

    const r = await performShare(appRoot, { files: ['src/App.tsx'], changes: CHANGES }, { run: noGh, now: NOW })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const names = sh(top, 'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', r.commit]).trim().split('\n')
    expect(names).toEqual(['app/src/App.tsx'])
  })
})

// ---- unit-level pieces -------------------------------------------------------------------

describe.skipIf(!hasGit)('createShareCommit', () => {
  it('removes its temporary index file even on failure', async () => {
    const root = makeGitProject(baseFiles)
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'changed\n')
    const indexFile = path.join(tmpDir(), 'share-index')

    const ok = await createShareCommit(root, ['src/App.tsx'], { title: 't', body: 'b' }, { parentRef: 'HEAD', indexFile })
    expect(ok.noChanges).toBe(false)
    expect(fs.existsSync(indexFile)).toBe(false)

    await expect(
      createShareCommit(root, ['src/App.tsx'], { title: 't', body: 'b' }, { parentRef: 'no-such-ref', indexFile }),
    ).rejects.toThrow()
    expect(fs.existsSync(indexFile)).toBe(false)
  })

  it('reports noChanges when the tree matches the parent', async () => {
    const root = makeGitProject(baseFiles)
    const r = await createShareCommit(root, ['src/App.tsx'], { title: 't', body: 'b' }, { parentRef: 'HEAD' })
    expect(r.noChanges).toBe(true)
  })
})

describe.skipIf(!hasGit)('pushBranch', () => {
  it('maps an unreachable remote to a friendly reason', async () => {
    const root = makeGitProject(baseFiles)
    sh(root, 'git', ['remote', 'add', 'origin', path.join(root, 'nope')])
    sh(root, 'git', ['branch', 'muse/x'])
    const r = await pushBranch(root, 'muse/x')
    expect(r.pushed).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('createPr (gh faked)', () => {
  it('recovers the existing PR URL when one is already open for the branch', async () => {
    const gh = withFakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'create') {
        return { code: 1, stdout: '', stderr: 'a pull request for branch "muse/x" already exists' }
      }
      return { code: 0, stdout: 'https://github.com/foo/bar/pull/3\n', stderr: '' }
    })
    const r = await createPr('/tmp', 'muse/x', 't', 'b', { run: gh.run })
    expect(r.prUrl).toBe('https://github.com/foo/bar/pull/3')
    expect(gh.calls.some((c) => c[0] === 'pr' && c[1] === 'view')).toBe(true)
  })

  it('reports a reason when gh fails outright', async () => {
    const gh = withFakeGh(() => ({ code: 1, stdout: '', stderr: 'boom' }))
    const r = await createPr('/tmp', 'muse/x', 't', 'b', { run: gh.run })
    expect(r.prUrl).toBeNull()
    expect(r.reason).toBeTruthy()
  })
})
