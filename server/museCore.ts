// ============================================================
//  MUSE BACKEND CORE  —  framework-agnostic HTTP handlers
// ------------------------------------------------------------
//  All endpoint logic lives here, decoupled from Vite. Two adapters consume it:
//    • server/musePlugin.ts  — Vite dev-server middleware (same-origin, no CORS)
//    • server/standaloneServer.ts — standalone Node http server (CORS-enabled,
//      any bundler: Vite, Next.js, webpack, …)
//
//  The core receives a MuseContext (config + mutable session state) and exposes
//  createMuseHandlers() — a map of async (req, res) handler functions.
// ============================================================
import path from 'node:path'
import fs from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import {
  computeStyleEdit,
  computeTextEdit,
  computeTextEditable,
  computeReorder,
  computeReorderable,
  findStyledExport,
  styledObjectPatches,
  type Mutation,
  type OffsetHint,
  type StyleStrategy,
  type VarEdit,
  type ModuleEdit,
} from './styleEdit'
import { editCssVar } from '../src/muse/style/cssVarEdit'
import { setRuleProperty } from '../src/muse/style/cssRuleEdit'
import { setTemplateProperty } from '../src/muse/style/styledEdit'

// ---- Constants ----------------------------------------------------------------

export const DEFAULT_BACKEND = 'claude-cli'
export const DEFAULT_MODEL = 'claude-sonnet-4-6'        // anthropic backend, /chat
export const DEFAULT_CLI_MODEL = 'sonnet'               // claude-cli backend (alias = latest)
export const DEFAULT_OBSERVE_MODEL = 'claude-haiku-4-5' // /observe — cheap + fast
const MAX_WRITE_BYTES = 200_000
const CLI_TIMEOUT_MS = 300_000
const MAX_DESIGN_BYTES = 40_000
const DESIGN_MD_CANDIDATES = ['DESIGN.md', 'src/DESIGN.md', 'src/demo/DESIGN.md']

// ---- MuseContext ---------------------------------------------------------------

export type MuseContext = {
  root: string
  apiKey: string
  model: string
  backend: string
  cliModel: string
  observeModel: string
  claudeBin: string
  designMdOverride: string
  designExclude: string[]
  // Mutable session state
  lineOffsetHint: OffsetHint
  detectedStrategy: StyleStrategy | null
  designGenerating: boolean
}

export function createMuseContext(
  env: Record<string, string | undefined>,
  root: string,
): MuseContext {
  const get = (key: string) => env[key] ?? ''
  const backend = (get('MUSE_BACKEND') || DEFAULT_BACKEND).trim()
  return {
    root,
    apiKey: get('ANTHROPIC_API_KEY'),
    model: get('MUSE_MODEL') || DEFAULT_MODEL,
    backend,
    cliModel: get('MUSE_CLI_MODEL') || DEFAULT_CLI_MODEL,
    observeModel: get('MUSE_OBSERVE_MODEL') || DEFAULT_OBSERVE_MODEL,
    claudeBin: backend === 'claude-cli' ? resolveClaudeBin() : 'claude',
    designMdOverride: get('MUSE_DESIGN_MD'),
    designExclude: get('MUSE_DESIGN_EXCLUDE')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    lineOffsetHint: { value: null },
    detectedStrategy: null,
    designGenerating: false,
  }
}

// ---- Handler type -------------------------------------------------------------

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export type MuseHandlers = {
  chat: Handler
  observe: Handler
  write: Handler
  styleEdit: Handler
  textEdit: Handler
  textEditable: Handler
  reorder: Handler
  reorderable: Handler
  designGenerate: Handler
  design: Handler
}

export function createMuseHandlers(ctx: MuseContext): MuseHandlers {
  return {
    chat:           (req, res) => handleChat(req, res, ctx),
    observe:        (req, res) => handleObserve(req, res, ctx),
    write:          (req, res) => handleWrite(req, res, ctx),
    styleEdit:      (req, res) => handleStyleEdit(req, res, ctx),
    textEdit:       (req, res) => handleTextEdit(req, res, ctx),
    textEditable:   (req, res) => handleTextEditable(req, res, ctx),
    reorder:        (req, res) => handleReorder(req, res, ctx),
    reorderable:    (req, res) => handleReorderable(req, res, ctx),
    designGenerate: (req, res) => handleDesignGenerate(req, res, ctx),
    design:         (req, res) => handleDesign(req, res, ctx),
  }
}

// ---- Utility functions --------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function resolveInSrc(root: string, fileName: unknown): string | null {
  if (typeof fileName !== 'string' || fileName.length === 0) return null
  const abs = path.resolve(fileName)
  if (!fs.existsSync(abs)) return null
  const srcDir = fs.realpathSync(path.resolve(root, 'src'))
  const real = fs.realpathSync(abs)
  const rel = path.relative(srcDir, real)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return real
}

const relOf = (root: string, abs: string) => path.relative(root, abs).replace(/\\/g, '/')

function detectStrategy(root: string): StyleStrategy {
  const configs = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
  ]
  return configs.some((c) => fs.existsSync(path.join(root, c))) ? 'tailwind-first' : 'inline'
}

function collectCssFiles(dir: string, acc: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectCssFiles(full, acc)
    else if (e.isFile() && e.name.endsWith('.css')) acc.push(full)
  }
}

function findCssVarFiles(root: string, varName: string): string[] {
  const files: string[] = []
  collectCssFiles(path.join(root, 'src'), files)
  files.sort()
  const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  return files.filter((f) => {
    try {
      return re.test(fs.readFileSync(f, 'utf8'))
    } catch {
      return false
    }
  })
}

function resolveModuleSpecifier(root: string, fromAbs: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return resolveInSrc(root, path.resolve(path.dirname(fromAbs), specifier))
}

const STYLED_MODULE_EXTS = ['.tsx', '.ts', '.jsx', '.js']
function resolveStyledSpecifier(root: string, fromAbs: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromAbs), specifier)
  const candidates = [
    base,
    ...STYLED_MODULE_EXTS.map((e) => base + e),
    ...STYLED_MODULE_EXTS.map((e) => path.join(base, 'index' + e)),
  ]
  for (const c of candidates) {
    const hit = resolveInSrc(root, c)
    if (hit && fs.statSync(hit).isFile()) return hit
  }
  return null
}

function followStyledExport(
  root: string,
  moduleAbs: string,
  exportName: string,
): { abs: string; exportName: string } | null {
  let abs = moduleAbs
  let name = exportName
  const visited = new Set<string>()
  for (let hop = 0; hop < 6; hop++) {
    if (visited.has(abs)) return null
    visited.add(abs)
    let content: string
    try { content = fs.readFileSync(abs, 'utf8') } catch { return null }
    const loc = findStyledExport(content, name)
    if (!loc || !('reexport' in loc)) return { abs, exportName: name }
    const next = resolveStyledSpecifier(root, abs, loc.reexport.specifier)
    if (!next) return null
    abs = next
    name = loc.reexport.exportName
  }
  return null
}

function parseObserveJson(text: string): { observation: string; chips: string[] } | null {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as { observation?: unknown; chips?: unknown }
    const observation = typeof obj.observation === 'string' ? obj.observation.trim() : ''
    const chips = Array.isArray(obj.chips)
      ? obj.chips
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map((c) => c.trim())
          .filter((c, i, a) => a.indexOf(c) === i)
          .slice(0, 3)
      : []
    if (!observation || chips.length === 0) return null
    return { observation, chips }
  } catch {
    return null
  }
}

function loadDesignBrief(root: string, override: string): string | null {
  const tryRead = (p: string): string | null => {
    try {
      const st = fs.statSync(p)
      if (!st.isFile()) return null
      const len = Math.min(st.size, MAX_DESIGN_BYTES)
      const fd = fs.openSync(p, 'r')
      try {
        const buf = Buffer.alloc(len)
        fs.readSync(fd, buf, 0, len, 0)
        const text = buf.toString('utf8').trim()
        return text || null
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return null
    }
  }
  if (override) return tryRead(path.isAbsolute(override) ? override : path.resolve(root, override))
  for (const rel of DESIGN_MD_CANDIDATES) {
    const hit = tryRead(path.resolve(root, rel))
    if (hit) return hit
  }
  return null
}

const designBriefBlock = (brief: string) =>
  `# The app's design system (DESIGN.md)\nFollow this. The tokens are normative — prefer them over inventing values, and apply colors through their CSS variables (never hardcode hex).\n\n${brief}`

function resolveDesignPath(root: string, override: string): { path: string; exists: boolean } {
  const isFile = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }
  if (override) {
    const p = path.isAbsolute(override) ? override : path.resolve(root, override)
    return { path: p, exists: isFile(p) }
  }
  for (const rel of DESIGN_MD_CANDIDATES) {
    const p = path.resolve(root, rel)
    if (isFile(p)) return { path: p, exists: true }
  }
  return { path: path.resolve(root, DESIGN_MD_CANDIDATES[0]), exists: false }
}

// ---- System prompts -----------------------------------------------------------

export const MUSE_SYSTEM_PROMPT = `You are Muse — a design partner embedded in a live web app. The person using you is a product designer or design engineer: they point at an element in their running app and tell you how they want it to change. They have taste, design vocabulary, and usually read code — talk to them as a peer, not a layperson. They own the direction; you own the craft of executing it in real source, and you bring a point of view of your own.

# Context you receive

The FULL source of every React + TypeScript file the selected elements live in, plus a list of which elements were selected and which file each lives in. The app is styled with Tailwind utility classes inline in className. When multiple elements are selected (a batch), apply the change consistently across all of them.

# Tools

You must use exactly one tool per turn.

- propose_options — your DEFAULT. Offer 1–3 distinct design DIRECTIONS for the request, each a complete applyable edit. Give a different option ONLY when there's a genuinely different good take (e.g. "Editorial" vs "Punchy") — don't pad to three with near-duplicates; one confident option is the right answer when there's one clear move. Each option carries the COMPLETE updated contents of every file it changes (one entry per file, exact relative path from context), changing only what's needed and keeping all other code byte-for-byte identical. Style with Tailwind utility classes inline in className only — never add CSS files, style objects, or extracted class variables. IMPORTANT: scope each option's change to the SELECTED element (and its own subtree) so the user can preview it in place; if the request genuinely needs to touch siblings or parents, that's fine, but prefer the tightest change that satisfies it.

- ask_clarifying_questions — the EXCEPTION. Use ONLY when the answer would materially change what you'd ship. If a thoughtful designer would just pick a direction and run with it, do that instead and let the user redirect after seeing it. When you do ask, ask ONE question with 2–3 concrete visual options, written as directions a designer would recognize.

# Voice

You're a design-engineer collaborator, not an AI assistant. That means:

- **Talk to a peer.** They speak design and read code, so use real vocabulary — name the property, the token, the type scale, the spacing step. "Dropped the title to text-4xl and tightened tracking" beats "made the title smaller." Don't over-explain or soften for a layperson.
- **No preambles.** Never start with "Certainly!", "I'll help you with that", "Here's what I changed:". Start with the move or the observation.
- **Have a POV.** "Pushed the hierarchy — heavier title, tighter spacing, denser accent" beats "I've updated the styling." State the move, then the reason.
- **Notice what wasn't asked.** If you spotted something else worth fixing *in the same files as the selected elements*, mention it briefly: "Also tightened the gap to 16px — 32px felt heavy for this density." Never touch files that aren't already in your context.
- **Short and declarative.** A confident sentence beats a careful paragraph.
- **Occasional dry humor is fine; corporate enthusiasm is not.**

# Decisiveness rubric

Before calling ask_clarifying_questions, check: would a senior designer ship a confident first pass without asking this? If yes, use propose_options and ship it. If two or three directions are each defensible, that's exactly when to return multiple options instead of asking. If the user wants something else, they'll tell you and you'll iterate. Almost always: don't ask.

Examples of when NOT to ask (just propose):
- "make this pop" on a CTA → pick a confident treatment (stronger color, denser type, clearer shadow) and propose. Note in the rationale how to dial it back if too loud.
- "feel more premium" on a card → pick the move (more whitespace, refined type pairing, restrained color) and propose.
- "simplify this" → pick the simplification and propose.
- "match the rest of the app" on an element → look at the surrounding code, pick the consistent treatment, propose.

When TO ask:
- "redesign this hero" → scope is too big to ship blind. Ask one narrowing question with 2–3 concrete directions ("editorial-and-quiet", "punchy-and-loud", "playful-and-warm").
- The selected element is doing two unrelated jobs and the request is ambiguous about which one to address.

# Rationale rules (for propose_options)

The top-level rationale is one or two short sentences for a fellow designer: lead with the move, then the reason, in real design language. Each option's label is 1–2 words ("Editorial", "Punchy") and its description is one crisp sentence on what that direction does. Skip the diff narration — they can see the result.

You are a partner, not a tool. Make the call.`

const OBSERVE_SYSTEM_PROMPT = `You are Muse — a design partner reading over a product designer's shoulder. They just selected an element in their live app. Give them the quick, knowledgeable read a design-engineer peer would offer glancing at the same element.

Respond with a JSON object containing two fields:

- observation: ONE short sentence (max ~20 words) reading the element from its className list and surrounding code — name what it's doing or the effect it's going for. This is a READ, not a verdict. Often the right read is naming the craft that's already there ("the tracking-tight + text-5xl is doing real editorial weight here"); when there's a genuine opportunity, name it plainly ("the 32px gap is loosening what reads like one unit") — but don't manufacture a flaw just to have something to say. Specific over generic. Designer voice — real vocabulary, no preamble, no "I notice...".
- chips: 3 starter prompts tailored to the element's tag and context, each 2–4 words, phrased as a design move the designer might say to you ("Tighten the rhythm", "Push the contrast", "Try a warmer accent"). Vary them — three distinct moves, not rephrasings of one idea.

Ground everything in what's actually in the className list and code. Don't speculate about what you can't see.`

// ---- Tool schemas -------------------------------------------------------------

export const ASK_TOOL: Anthropic.Tool = {
  name: 'ask_clarifying_questions',
  description:
    "Ask ONE short clarifying question with 2–3 concrete visual options. Use ONLY when the answer would materially change what you ship — if a thoughtful designer would just pick a direction and run with it, use propose_edit instead (that is the default). Almost always: don't ask.",
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Exactly ONE question, in almost every case. Two only if genuinely needed.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question, in plain language.' },
            options: {
              type: 'array',
              description: '2 or 3 options.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Short choice label (1–4 words).' },
                  description: {
                    type: 'string',
                    description: 'One plain-English sentence on what this option means.',
                  },
                },
                required: ['label', 'description'],
              },
            },
          },
          required: ['question', 'options'],
        },
      },
    },
    required: ['questions'],
  },
}

const EDITS_SCHEMA = {
  type: 'array' as const,
  description: 'One entry per changed file.',
  items: {
    type: 'object' as const,
    properties: {
      fileName: {
        type: 'string' as const,
        description: 'The exact relative path of the file (as shown in the context).',
      },
      newContent: { type: 'string' as const, description: 'The complete updated contents of the file.' },
    },
    required: ['fileName', 'newContent'],
  },
}

export const PROPOSE_OPTIONS_TOOL: Anthropic.Tool = {
  name: 'propose_options',
  description:
    'Propose 1–3 distinct design directions for the request. Give multiple options only when there are genuinely different good takes; one confident option is correct when there is one clear move. Each option is a complete, applyable edit. Scope each change to the selected element so it can be previewed in place.',
  input_schema: {
    type: 'object',
    properties: {
      rationale: {
        type: 'string',
        description:
          'One or two crisp sentences for a fellow designer: the overall move and why, in real design language. Covers the whole proposal.',
      },
      options: {
        type: 'array',
        description: '1 to 3 design directions.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short name for this direction (1–2 words), e.g. "Editorial".' },
            description: {
              type: 'string',
              description: 'One plain-English sentence on what this direction does.',
            },
            edits: EDITS_SCHEMA,
          },
          required: ['label', 'description', 'edits'],
        },
      },
    },
    required: ['rationale', 'options'],
  },
}

// ---- CLI backend helpers -------------------------------------------------------

function resolveClaudeBin(): string {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const out = execFileSync(finder, ['claude'], { encoding: 'utf8' })
    const hits = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const exe = hits.find((h) => /\.exe$/i.test(h))
    return exe || hits[0] || 'claude'
  } catch {
    return 'claude'
  }
}

const CLI_SYSTEM_PROMPT = `${MUSE_SYSTEM_PROMPT}

# Output format (IMPORTANT — read this last, it overrides the "Tools" section above)

You have NO callable tools here. Return your answer ONLY as the structured object defined by the schema:

- To propose design directions (your DEFAULT, the old propose_options): set mode="options", write the one/two-sentence rationale, and give 1–3 options. Each option has a 1–2 word label, a one-sentence description, and an "edits" array. Each edit is { fileName: the exact relative path from the context, replacements: [ { search, replace } ] }. For each change, "search" is an EXACT, verbatim substring of that file's CURRENT contents — copy it character-for-character including indentation — chosen just long enough to appear EXACTLY ONCE in the file; "replace" is the text to put in its place. Make the smallest replacements that achieve the change (usually just the selected element's className string). Do NOT return whole files. Tailwind utility classes inline only. Leave "questions" empty.
- To ask (the rare exception, the old ask_clarifying_questions): set mode="clarify" and give exactly ONE entry in "questions" with 2–3 concrete visual options. Leave "rationale" and "options" empty.

Every voice, decisiveness, and rationale rule above still applies — only the delivery mechanism changed.`

const CLI_EDITS_SCHEMA = {
  type: 'array' as const,
  description: 'One entry per changed file.',
  items: {
    type: 'object' as const,
    properties: {
      fileName: {
        type: 'string' as const,
        description: 'The exact relative path of the file (as shown in the context).',
      },
      replacements: {
        type: 'array' as const,
        description: 'One or more search/replace edits to apply within this file, in order.',
        items: {
          type: 'object' as const,
          properties: {
            search: {
              type: 'string' as const,
              description:
                "An EXACT, verbatim substring of the file's CURRENT contents (copied character-for-character, including indentation), long enough to appear exactly once.",
            },
            replace: { type: 'string' as const, description: 'The text to put in its place.' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['fileName', 'replacements'],
  },
}

const CLI_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['options', 'clarify'] },
    rationale: { type: 'string', description: 'For mode="options": one or two plain-English sentences — the move and why.' },
    options: {
      type: 'array',
      description: 'For mode="options": 1–3 design directions.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short name (1–2 words), e.g. "Editorial".' },
          description: { type: 'string', description: 'One plain-English sentence on what this direction does.' },
          edits: CLI_EDITS_SCHEMA,
        },
        required: ['label', 'description', 'edits'],
      },
    },
    questions: {
      type: 'array',
      description: 'For mode="clarify": exactly one question.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question, in plain language.' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short choice label (1–4 words).' },
                description: { type: 'string', description: 'One plain-English sentence on what this option means.' },
              },
              required: ['label', 'description'],
            },
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  required: ['mode'],
}

function flattenTranscript(messages: Anthropic.MessageParam[]): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        lines.push(`USER: ${m.content}`)
      } else if (Array.isArray(m.content)) {
        for (const b of m.content as Array<{ type?: string; text?: string; content?: unknown }>) {
          if (b.type === 'tool_result') {
            const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
            lines.push(`USER (answering your question): ${c}`)
          } else if (b.type === 'text' && b.text) {
            lines.push(`USER: ${b.text}`)
          }
        }
      }
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content as Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>) {
        if (b.type === 'text' && b.text) {
          lines.push(`MUSE: ${b.text}`)
        } else if (b.type === 'tool_use') {
          if (b.name === 'ask_clarifying_questions') {
            const q = (b.input?.questions as Array<{ question?: string }>)?.[0]?.question ?? '(a clarifying question)'
            lines.push(`MUSE (asked): ${q}`)
          } else {
            const labels = ((b.input?.options as Array<{ label?: string }>) ?? [])
              .map((o) => o?.label)
              .filter(Boolean)
              .join(', ')
            lines.push(`MUSE (proposed${labels ? ` — ${labels}` : ''}): ${(b.input?.rationale as string) ?? ''}`)
          }
        }
      }
    }
  }
  return lines.join('\n')
}

function applyReplacements(
  original: string,
  replacements: Array<{ search?: unknown; replace?: unknown }>,
): string {
  if (!Array.isArray(replacements) || replacements.length === 0) throw new Error('no replacements')
  let text = original
  for (const r of replacements) {
    const search = typeof r?.search === 'string' ? r.search : ''
    const replace = typeof r?.replace === 'string' ? r.replace : ''
    if (!search) throw new Error('empty search block')
    const idx = text.indexOf(search)
    if (idx !== -1) {
      if (text.indexOf(search, idx + 1) !== -1) throw new Error('ambiguous search block (matches more than once)')
      text = text.slice(0, idx) + replace + text.slice(idx + search.length)
      continue
    }
    const trimmed = search.trim()
    if (trimmed && trimmed !== search) {
      const ti = text.indexOf(trimmed)
      if (ti !== -1 && text.indexOf(trimmed, ti + 1) === -1) {
        text = text.slice(0, ti) + replace + text.slice(ti + trimmed.length)
        continue
      }
    }
    const applied = applyNormalizedLines(text, search, replace)
    if (applied == null) throw new Error('could not locate the snippet to change')
    text = applied
  }
  return text
}

function applyNormalizedLines(text: string, search: string, replace: string): string | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const textLines = text.split('\n')
  const searchLines = search.split('\n').map(norm).filter((l) => l.length > 0)
  if (searchLines.length === 0) return null
  let matchAt = -1
  for (let i = 0; i + searchLines.length <= textLines.length; i++) {
    let ok = true
    for (let j = 0; j < searchLines.length; j++) {
      if (norm(textLines[i + j]) !== searchLines[j]) { ok = false; break }
    }
    if (ok) {
      if (matchAt !== -1) return null
      matchAt = i
    }
  }
  if (matchAt === -1) return null
  const before = textLines.slice(0, matchAt)
  const after = textLines.slice(matchAt + searchLines.length)
  return [...before, replace, ...after].join('\n')
}

function runChatViaCli(
  bin: string,
  model: string,
  prompt: string,
  originals: Record<string, string>,
): Promise<Anthropic.ContentBlock[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', model,
      '--tools', '',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--system-prompt', CLI_SYSTEM_PROMPT,
      '--json-schema', JSON.stringify(CLI_OUTPUT_SCHEMA),
    ]
    const childEnv = { ...process.env }
    delete childEnv.ANTHROPIC_API_KEY

    const child = spawn(bin, args, { env: childEnv })
    let out = ''
    let err = ''
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill()
      done(() => reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s.`)))
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.stdin.on('error', () => {})
    child.on('error', (e) =>
      done(() =>
        reject(new Error(`Could not run the \`claude\` CLI (${(e as Error).message}). Is Claude Code installed and on PATH, and are you logged in (\`claude auth status\`)?`)),
      ),
    )
    child.on('close', (code) => {
      done(() => {
        if (code !== 0) {
          return reject(new Error(`claude CLI exited with code ${code}: ${err.slice(0, 800) || '(no stderr)'}`))
        }
        let res: { structured_output?: unknown; session_id?: string; is_error?: boolean; result?: unknown }
        try {
          res = JSON.parse(out)
        } catch {
          return reject(new Error(`Could not parse claude CLI output: ${out.slice(0, 800)}`))
        }
        if (res.is_error) {
          const msg = typeof res.result === 'string' ? res.result : 'unknown error'
          return reject(new Error(`claude CLI reported an error: ${msg.slice(0, 800)}`))
        }
        const so = res.structured_output as
          | { mode?: string; rationale?: string; options?: unknown; questions?: unknown }
          | undefined
        if (!so || typeof so !== 'object') {
          return reject(new Error('claude CLI returned no structured output.'))
        }
        const id = `cli-${res.session_id ?? randomUUID()}`
        let content: Array<Record<string, unknown>>
        if (so.mode === 'clarify') {
          const questions = Array.isArray(so.questions) ? so.questions : []
          if (questions.length === 0) {
            return reject(new Error('claude CLI returned no question. Try rephrasing.'))
          }
          content = [{ type: 'tool_use', id, name: 'ask_clarifying_questions', input: { questions } }]
        } else {
          const rawOptions = Array.isArray(so.options) ? so.options : []
          const options: Array<Record<string, unknown>> = []
          rawOptions.forEach((o, i) => {
            const opt = o as { label?: unknown; description?: unknown; edits?: unknown }
            const rawEdits = Array.isArray(opt.edits) ? opt.edits : []
            try {
              const edits = rawEdits.map((e) => {
                const edit = e as { fileName?: unknown; replacements?: unknown }
                const fileName = typeof edit.fileName === 'string' ? edit.fileName : ''
                const key = fileName.replace(/\\/g, '/').replace(/^\.\//, '')
                const orig = originals[key] ?? originals[fileName]
                if (orig == null) throw new Error(`edit references unknown file "${fileName}"`)
                const replacements = Array.isArray(edit.replacements) ? edit.replacements : []
                return { fileName: key, newContent: applyReplacements(orig, replacements) }
              })
              if (edits.length > 0) {
                options.push({ id: `opt-${i}`, label: opt.label ?? `Option ${i + 1}`, description: opt.description ?? '', edits })
              }
            } catch (e) {
              console.warn(`[muse] dropped option "${(opt.label as string) ?? i}" — ${(e as Error).message}`)
            }
          })
          if (options.length === 0) {
            return reject(new Error("Couldn't apply the proposed changes to the selected element. Try rephrasing."))
          }
          content = [{ type: 'tool_use', id, name: 'propose_options', input: { rationale: so.rationale ?? '', options } }]
        }
        resolve(content as unknown as Anthropic.ContentBlock[])
      })
    })

    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch {
      // child already gone — 'error'/'close' will reject
    }
  })
}

// ---- Handlers -----------------------------------------------------------------

async function handleChat(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    if (ctx.backend !== 'claude-cli' && !ctx.apiKey) {
      return sendJson(res, 500, {
        error:
          'ANTHROPIC_API_KEY is not set. Add it to a .env.local file at the project root (ANTHROPIC_API_KEY=sk-ant-...) or export it in your shell, then restart the server.',
      })
    }

    const { targets, messages } = JSON.parse(await readBody(req))
    if (!Array.isArray(targets) || targets.length === 0) {
      return sendJson(res, 400, { error: 'No target elements provided.' })
    }

    const files = new Map<string, string>()
    const elementLines: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      const abs = resolveInSrc(ctx.root, t?.fileName)
      if (!abs) continue
      const rel = relOf(ctx.root, abs)
      if (!files.has(rel)) files.set(rel, fs.readFileSync(abs, 'utf8'))
      elementLines.push(
        `  ${i + 1}. <${t.tag ?? '?'}> in ${rel}` +
          (t.text ? ` — "${t.text}"` : '') +
          (t.classNames ? ` (classes: "${t.classNames}")` : ''),
      )
    }
    if (files.size === 0) {
      return sendJson(res, 400, {
        error: 'None of the selected elements map to an editable file under src/.',
      })
    }

    const filesBlock = [...files.entries()]
      .map(([rel, content]) => `// ${rel}\n\`\`\`tsx\n${content}\n\`\`\``)
      .join('\n\n')
    const brief = loadDesignBrief(ctx.root, ctx.designMdOverride)
    const context =
      (brief ? `${designBriefBlock(brief)}\n\n` : '') +
      `The user selected ${elementLines.length} element(s):\n${elementLines.join('\n')}\n\n` +
      `Relevant files:\n\n${filesBlock}`

    const originals = Object.fromEntries(files)

    if (ctx.backend === 'claude-cli') {
      const prompt =
        `${context}\n\n## Conversation so far\n${flattenTranscript(messages as Anthropic.MessageParam[])}\n\n` +
        `## Now\nRespond to the user's latest message using the structured output schema. Default to mode="options".`
      const content = await runChatViaCli(ctx.claudeBin, ctx.cliModel, prompt, originals)
      return sendJson(res, 200, { content, stop_reason: 'tool_use', originals })
    }

    const outMessages = (messages as Anthropic.MessageParam[]).map((m, i) => {
      if (i === 0 && m.role === 'user' && typeof m.content === 'string') {
        return { role: 'user' as const, content: `${context}\n\n## The user's request\n${m.content}` }
      }
      return m
    })

    const client = new Anthropic({ apiKey: ctx.apiKey })
    const resp = await client.messages.create({
      model: ctx.model,
      max_tokens: 8192,
      system: [{ type: 'text', text: MUSE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [ASK_TOOL, PROPOSE_OPTIONS_TOOL],
      tool_choice: { type: 'any' },
      messages: outMessages,
    })

    return sendJson(res, 200, {
      content: resp.content,
      stop_reason: resp.stop_reason,
      originals,
    })
  } catch (err) {
    console.error('[muse] /chat error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleObserve(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    if (!ctx.apiKey) {
      return sendJson(res, 500, {
        error:
          'ANTHROPIC_API_KEY is not set. Add it to a .env.local file at the project root (ANTHROPIC_API_KEY=sk-ant-...) or export it in your shell, then restart the server.',
      })
    }

    const { target } = JSON.parse(await readBody(req))
    if (!target || typeof target !== 'object') {
      return sendJson(res, 400, { error: 'No target element provided.' })
    }
    const abs = resolveInSrc(ctx.root, target.fileName)
    if (!abs) {
      return sendJson(res, 400, {
        error: 'The selected element does not map to an editable file under src/.',
      })
    }
    const rel = relOf(ctx.root, abs)
    const source = fs.readFileSync(abs, 'utf8')
    const brief = loadDesignBrief(ctx.root, ctx.designMdOverride)

    const context =
      (brief ? `${designBriefBlock(brief)}\n\n` : '') +
      `Selected element: <${target.tag ?? '?'}> in ${rel}` +
      (target.text ? ` — "${target.text}"` : '') +
      `\nIts className: "${target.classNames ?? ''}"\n\n` +
      `Full source of ${rel} (for surrounding context):\n\`\`\`tsx\n${source}\n\`\`\`\n\n` +
      `Give your read as the JSON object described in your instructions — nothing else.`

    const client = new Anthropic({ apiKey: ctx.apiKey })
    const resp = await client.messages.create({
      model: ctx.observeModel,
      max_tokens: 300,
      system: [{ type: 'text', text: OBSERVE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: context }],
    })

    const textBlock = resp.content.find((b) => b.type === 'text') as { text?: string } | undefined
    const parsed = parseObserveJson(textBlock?.text ?? '')
    if (!parsed) {
      return sendJson(res, 200, { error: "Couldn't read a usable observation." })
    }
    return sendJson(res, 200, parsed)
  } catch (err) {
    console.error('[muse] /observe error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleWrite(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const { files } = JSON.parse(await readBody(req))
    if (!Array.isArray(files) || files.length === 0) {
      return sendJson(res, 400, { error: 'No files to write.' })
    }

    const resolved: Array<{ abs: string; content: string }> = []
    for (const f of files) {
      const abs = resolveInSrc(ctx.root, f?.fileName)
      if (!abs) {
        return sendJson(res, 400, {
          error: `Refusing to write "${f?.fileName}" — must be an existing file under src/.`,
        })
      }
      if (typeof f.newContent !== 'string' || f.newContent.length === 0) {
        return sendJson(res, 400, { error: `Empty content for "${f.fileName}".` })
      }
      if (f.newContent.length > MAX_WRITE_BYTES) {
        return sendJson(res, 400, { error: `"${f.fileName}" exceeds ${MAX_WRITE_BYTES} bytes.` })
      }
      resolved.push({ abs, content: f.newContent })
    }
    for (const r of resolved) fs.writeFileSync(r.abs, r.content, 'utf8')
    return sendJson(res, 200, { ok: true })
  } catch (err) {
    console.error('[muse] /write error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleStyleEdit(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; mutations?: unknown }>
      strategy?: unknown
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const strategy: StyleStrategy =
      body.strategy === 'inline'
        ? 'inline'
        : body.strategy === 'tailwind-first'
          ? 'tailwind-first'
          : (ctx.detectedStrategy ??= detectStrategy(ctx.root))

    const out: Array<{ fileName: string; newContent: string }> = []
    const warnings: string[] = []
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; mutations: Mutation[] }> }>()

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      const mutations = (Array.isArray(e?.mutations) ? e!.mutations : []) as Mutation[]
      if (!Number.isInteger(line) || line <= 0 || mutations.length === 0) {
        warnings.push(`skipped ${rel} — needs a positive line and at least one mutation.`)
        continue
      }
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: Number.isFinite(column) ? column : 0, tag, classNames, mutations })
      byFile.set(rel, bucket)
    }

    const originals: Record<string, string> = {}
    const varEdits: VarEdit[] = []
    const moduleEdits: Array<{ cssAbs: string; cssRel: string; className: string; cssProp: string; value: string }> = []
    const unresolvedModule = new Set<string>()
    const styledEdits: Array<{ tgtAbs: string; tgtRel: string; exportName: string; cssProp: string; value: string }> = []
    const unresolvedStyled = new Set<string>()

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = computeStyleEdit(content, it.line, it.column, it.mutations, strategy, it.tag, it.classNames, ctx.lineOffsetHint)
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.varEdits.length) varEdits.push(...result.varEdits)
        for (const me of result.moduleEdits) {
          const cssAbs = resolveModuleSpecifier(ctx.root, abs, me.specifier)
          if (!cssAbs) {
            const key = `${rel}::${me.specifier}`
            if (!unresolvedModule.has(key)) {
              unresolvedModule.add(key)
              warnings.push(me.specifier.startsWith('.')
                ? `${rel}: couldn't resolve CSS module "${me.specifier}" under src/ — left unchanged.`
                : `${rel}: CSS module "${me.specifier}" is an alias/package import — only relative ./ imports are editable; left unchanged.`)
            }
            continue
          }
          moduleEdits.push({ cssAbs, cssRel: relOf(ctx.root, cssAbs), className: me.className, cssProp: me.cssProp, value: me.value })
        }
        for (const se of result.styledEdits) {
          const firstAbs = resolveStyledSpecifier(ctx.root, abs, se.specifier)
          const final = firstAbs ? followStyledExport(ctx.root, firstAbs, se.exportName) : null
          if (!final) {
            const key = `${rel}::${se.specifier}`
            if (!unresolvedStyled.has(key)) {
              unresolvedStyled.add(key)
              warnings.push(`${rel}: couldn't resolve styled import "${se.specifier}" under src/ — left unchanged.`)
            }
            continue
          }
          styledEdits.push({ tgtAbs: final.abs, tgtRel: relOf(ctx.root, final.abs), exportName: final.exportName, cssProp: se.cssProp, value: se.value })
        }
        if (result.changed) {
          content = result.newContent
          changed = true
        }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    if (varEdits.length) {
      const byVar = new Map<string, string>()
      const order: string[] = []
      for (const ve of varEdits) {
        if (byVar.has(ve.varName) && byVar.get(ve.varName) !== ve.value) {
          warnings.push(`${ve.varName} got conflicting values in one edit — kept the last (${ve.value}).`)
        }
        if (!byVar.has(ve.varName)) order.push(ve.varName)
        byVar.set(ve.varName, ve.value)
      }
      const cssByFile = new Map<string, { abs: string; rel: string; vars: Array<[string, string]> }>()
      for (const varName of order) {
        const cssFiles = findCssVarFiles(ctx.root, varName)
        if (cssFiles.length === 0) {
          warnings.push(`couldn't find where ${varName} is defined — left unchanged.`)
          continue
        }
        if (cssFiles.length > 1) {
          warnings.push(`${varName} is defined in ${cssFiles.length} stylesheets — edited ${relOf(ctx.root, cssFiles[0])}.`)
        }
        const abs = cssFiles[0]
        const rel = relOf(ctx.root, abs)
        const bucket = cssByFile.get(rel) ?? { abs, rel, vars: [] }
        bucket.vars.push([varName, byVar.get(varName)!])
        cssByFile.set(rel, bucket)
      }
      for (const { abs, rel, vars } of cssByFile.values()) {
        let content = fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const [varName, value] of vars) {
          const r = editCssVar(content, varName, value)
          if (r.matches > 1) {
            warnings.push(`${varName} is themed in ${r.matches} selectors — updated the base value; theme overrides unchanged.`)
          }
          if (r.changed) {
            warnings.push(`updated ${varName} in ${rel} — this changes everything that uses it.`)
            content = r.newContent
            changed = true
          }
        }
        if (changed) {
          if (!(rel in originals)) originals[rel] = before
          out.push({ fileName: rel, newContent: content })
        }
      }
    }

    if (moduleEdits.length) {
      const byCss = new Map<string, { abs: string; rel: string; edits: Array<{ className: string; cssProp: string; value: string }> }>()
      for (const me of moduleEdits) {
        const bucket = byCss.get(me.cssRel) ?? { abs: me.cssAbs, rel: me.cssRel, edits: [] }
        bucket.edits.push({ className: me.className, cssProp: me.cssProp, value: me.value })
        byCss.set(me.cssRel, bucket)
      }
      for (const { abs, rel, edits } of byCss.values()) {
        const staged = out.find((o) => o.fileName === rel)
        let content = staged ? staged.newContent : fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const { className, cssProp, value } of edits) {
          const r = setRuleProperty(content, className, cssProp, value)
          if (r.matches > 1) {
            warnings.push(`.${className} is defined in ${r.matches} rules in ${rel} — edited the first; media/theme overrides unchanged.`)
          }
          if (r.changed) {
            content = r.newContent
            changed = true
            if (r.grouped) {
              warnings.push(`.${className} shares a rule with other selectors in ${rel} — they were restyled too.`)
            }
          } else if (r.matches === 0) {
            warnings.push(`no .${className} rule in ${rel} — left ${cssProp} unchanged.`)
          }
        }
        if (changed) {
          if (staged) staged.newContent = content
          else {
            originals[rel] = before
            out.push({ fileName: rel, newContent: content })
          }
        }
      }
    }

    if (styledEdits.length) {
      const byModule = new Map<string, { abs: string; rel: string; byExport: Map<string, Array<{ cssProp: string; value: string }>> }>()
      for (const se of styledEdits) {
        const bucket = byModule.get(se.tgtRel) ?? { abs: se.tgtAbs, rel: se.tgtRel, byExport: new Map() }
        const props = bucket.byExport.get(se.exportName) ?? []
        props.push({ cssProp: se.cssProp, value: se.value })
        bucket.byExport.set(se.exportName, props)
        byModule.set(se.tgtRel, bucket)
      }
      for (const { abs, rel, byExport } of byModule.values()) {
        const staged = out.find((o) => o.fileName === rel)
        let content = staged ? staged.newContent : fs.readFileSync(abs, 'utf8')
        const before = content
        let changed = false
        for (const [exportName, props] of byExport) {
          const label = exportName === 'default' ? 'default export' : `"${exportName}"`
          const loc = findStyledExport(content, exportName)
          if (!loc) {
            warnings.push(`${rel}: no styled ${label} found — left unchanged (an imported component that isn't a styled template here).`)
            continue
          }
          if ('reexport' in loc) {
            warnings.push(`${rel}: styled ${label} re-exports another module — left unchanged.`)
            continue
          }
          if ('unsupported' in loc) {
            warnings.push(`${rel}: styled ${label} is ${loc.unsupported} — left unchanged.`)
            continue
          }
          if ('object' in loc) {
            const ps = styledObjectPatches(content, loc.object, props.map((p) => [p.cssProp, p.value] as [string, string]))
            if (ps.length) {
              ps.sort((a, b) => b.start - a.start)
              for (const p of ps) content = content.slice(0, p.start) + p.text + content.slice(p.end)
              changed = true
            }
            continue
          }
          let body = content.slice(loc.bodyStart, loc.bodyEnd)
          let any = false
          for (const { cssProp, value } of props) {
            const r = setTemplateProperty(body, cssProp, value)
            if (r.changed) { body = r.newContent; any = true }
          }
          if (any) {
            content = content.slice(0, loc.bodyStart) + body + content.slice(loc.bodyEnd)
            changed = true
          }
        }
        if (changed) {
          if (staged) staged.newContent = content
          else {
            originals[rel] = before
            out.push({ fileName: rel, newContent: content })
          }
        }
      }
    }

    if (out.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'] })
    }
    return sendJson(res, 200, { edits: out, originals, warnings })
  } catch (err) {
    console.error('[muse] /style-edit error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleTextEdit(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; text?: unknown }>
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const out: Array<{ fileName: string; newContent: string }> = []
    const originals: Record<string, string> = {}
    const warnings: string[] = []
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; text: string }> }>()

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      const text = typeof e?.text === 'string' ? e.text : null
      if (!Number.isInteger(line) || line <= 0 || text === null) {
        warnings.push(`skipped ${rel} — needs a positive line and text.`)
        continue
      }
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: Number.isFinite(column) ? column : 0, tag, classNames, text })
      byFile.set(rel, bucket)
    }

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = computeTextEdit(content, it.line, it.column, it.text, it.tag, it.classNames, ctx.lineOffsetHint)
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.changed) { content = result.newContent; changed = true }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    if (out.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'] })
    }
    return sendJson(res, 200, { edits: out, originals, warnings })
  } catch (err) {
    console.error('[muse] /text-edit error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleTextEditable(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown }
    const abs = resolveInSrc(ctx.root, b?.fileName)
    const line = Number(b?.line)
    if (!abs || !Number.isInteger(line) || line <= 0) {
      return sendJson(res, 200, { editable: false, reason: 'not an editable element' })
    }
    const source = fs.readFileSync(abs, 'utf8')
    const tag = typeof b?.tag === 'string' ? b.tag : undefined
    const classNames = typeof b?.classNames === 'string' ? b.classNames : undefined
    const result = computeTextEditable(source, line, Number.isFinite(Number(b?.column)) ? Number(b?.column) : 0, tag, classNames, ctx.lineOffsetHint)
    return sendJson(res, 200, result)
  } catch (err) {
    console.error('[muse] /text-editable error:', err)
    return sendJson(res, 200, { editable: false, reason: 'check failed' })
  }
}

async function handleReorder(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as {
      edits?: Array<{ fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown; toIndex?: unknown }>
    }
    const rawEdits = Array.isArray(body.edits) ? body.edits : []
    if (rawEdits.length === 0) return sendJson(res, 400, { error: 'No edits provided.' })

    const out: Array<{ fileName: string; newContent: string }> = []
    const originals: Record<string, string> = {}
    const warnings: string[] = []
    const byFile = new Map<string, { abs: string; rel: string; items: Array<{ line: number; column: number; tag?: string; classNames?: string; toIndex: number }> }>()

    for (const e of rawEdits) {
      const abs = resolveInSrc(ctx.root, e?.fileName)
      if (!abs) {
        warnings.push(`skipped "${String(e?.fileName)}" — not an editable file under src/.`)
        continue
      }
      const rel = relOf(ctx.root, abs)
      const line = Number(e?.line)
      const column = Number(e?.column)
      const toIndex = Number(e?.toIndex)
      const tag = typeof e?.tag === 'string' ? e.tag : undefined
      const classNames = typeof e?.classNames === 'string' ? e.classNames : undefined
      if (!Number.isInteger(line) || line <= 0 || !Number.isInteger(toIndex) || toIndex < 0) {
        warnings.push(`skipped ${rel} — needs a positive line and a target slot.`)
        continue
      }
      const bucket = byFile.get(rel) ?? { abs, rel, items: [] }
      bucket.items.push({ line, column: Number.isFinite(column) ? column : 0, tag, classNames, toIndex })
      byFile.set(rel, bucket)
    }

    for (const { abs, rel, items } of byFile.values()) {
      let content = fs.readFileSync(abs, 'utf8')
      const before = content
      let changed = false
      items.sort((a, b) => b.line - a.line)
      for (const it of items) {
        const result = computeReorder(content, it.line, it.column, it.toIndex, it.tag, it.classNames, ctx.lineOffsetHint)
        if (result.warnings.length) warnings.push(...result.warnings.map((w) => `${rel}: ${w}`))
        if (result.changed) { content = result.newContent; changed = true }
      }
      if (changed) {
        originals[rel] = before
        out.push({ fileName: rel, newContent: content })
      }
    }

    if (out.length === 0) {
      return sendJson(res, 200, { edits: [], originals: {}, warnings: warnings.length ? warnings : ['no changes computed'] })
    }
    // A reorder shifts line numbers, so the learned Fast-Refresh offset can go stale.
    // Drop it so the next locate re-learns it fresh.
    ctx.lineOffsetHint.value = null
    return sendJson(res, 200, { edits: out, originals, warnings })
  } catch (err) {
    console.error('[muse] /reorder error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleReorderable(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const b = JSON.parse(await readBody(req)) as { fileName?: unknown; line?: unknown; column?: unknown; tag?: unknown; classNames?: unknown }
    const abs = resolveInSrc(ctx.root, b?.fileName)
    const line = Number(b?.line)
    if (!abs || !Number.isInteger(line) || line <= 0) {
      return sendJson(res, 200, { reorderable: false, reason: 'not a reorderable element' })
    }
    const source = fs.readFileSync(abs, 'utf8')
    const tag = typeof b?.tag === 'string' ? b.tag : undefined
    const classNames = typeof b?.classNames === 'string' ? b.classNames : undefined
    const result = computeReorderable(source, line, Number.isFinite(Number(b?.column)) ? Number(b?.column) : 0, tag, classNames, ctx.lineOffsetHint)
    return sendJson(res, 200, result)
  } catch (err) {
    console.error('[muse] /reorderable error:', err)
    return sendJson(res, 200, { reorderable: false, reason: 'check failed' })
  }
}

async function handleDesignGenerate(req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  if (ctx.designGenerating) {
    return sendJson(res, 409, { error: 'A design brief is already being generated — hang on.' })
  }
  try {
    const scriptPath = path.resolve(ctx.root, 'scripts/gen-design-md.mjs')
    if (!fs.existsSync(scriptPath)) {
      return sendJson(res, 500, { error: 'Generator not found at scripts/gen-design-md.mjs.' })
    }
    const outPath = resolveDesignPath(ctx.root, ctx.designMdOverride).path
    const args = [
      scriptPath, ctx.root, '--concise', '--force', '--out', outPath,
      ...ctx.designExclude.flatMap((x) => ['--exclude', x]),
    ]
    ctx.designGenerating = true
    const child = spawn(process.execPath, args, { env: process.env })
    let err = ''
    let sent = false
    const reply = (status: number, body: unknown) => {
      if (sent) return
      sent = true
      ctx.designGenerating = false
      sendJson(res, status, body)
    }
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => reply(500, { error: `Could not run the generator: ${(e as Error).message}` }))
    child.on('close', (code) => {
      if (code !== 0) return reply(500, { error: `Generator failed: ${err.slice(-600).trim() || '(no output)'}` })
      const content = loadDesignBrief(ctx.root, ctx.designMdOverride)
      if (!content) return reply(500, { error: `Generator finished but no readable brief at ${relOf(ctx.root, outPath)}.` })
      reply(200, { content, path: relOf(ctx.root, outPath) })
    })
  } catch (err) {
    ctx.designGenerating = false
    console.error('[muse] /design/generate error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}

async function handleDesign(_req: IncomingMessage, res: ServerResponse, ctx: MuseContext): Promise<void> {
  try {
    const { path: p, exists } = resolveDesignPath(ctx.root, ctx.designMdOverride)
    const content = exists ? loadDesignBrief(ctx.root, ctx.designMdOverride) : null
    return sendJson(res, 200, { exists: !!content, content: content ?? undefined, path: relOf(ctx.root, p) })
  } catch (err) {
    console.error('[muse] /design error:', err)
    return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
  }
}
