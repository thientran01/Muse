// ============================================================
//  MUSE BACKEND  —  Vite plugin (Thien's piece)
// ------------------------------------------------------------
//  Adds two endpoints to the Vite dev server (same origin, no CORS,
//  one `npm run dev` process):
//
//    POST /api/muse/chat   -> Claude with two tools (ask_clarifying_questions |
//                             propose_options). Accepts one OR many target elements
//                             (a batch), reads each element's source file, and
//                             returns edits across however many files change.
//    POST /api/muse/observe-> a cheap, tool-less, ~300-token call that returns a
//                             one-line observation + 3 starter chips when the
//                             user selects a fresh element (the thread opener).
//    POST /api/muse/write  -> writes the approved files to disk (each sandboxed
//                             to src/), which triggers Vite HMR -> live reload.
//
//  /chat has two backends, selected by MUSE_BACKEND (default 'claude-cli'):
//    'claude-cli' -> shells out to the `claude` CLI, which spends your logged-in
//                    Claude subscription rather than metered API tokens. No
//                    ANTHROPIC_API_KEY required for /chat.
//    'anthropic'  -> the original metered Messages API path (needs a key).
//  /observe always uses the cheap Messages API (Haiku by default), so it needs a
//  key regardless of backend. Models: MUSE_MODEL (api /chat), MUSE_CLI_MODEL
//  (cli /chat), MUSE_OBSERVE_MODEL (/observe).
// ============================================================
import path from 'node:path'
import fs from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Plugin, loadEnv } from 'vite'
import Anthropic from '@anthropic-ai/sdk'

const DEFAULT_BACKEND = 'claude-cli'
const DEFAULT_MODEL = 'claude-sonnet-4-5' // anthropic backend, /chat
const DEFAULT_CLI_MODEL = 'sonnet' // claude-cli backend, /chat (alias = latest on your plan)
const DEFAULT_OBSERVE_MODEL = 'claude-haiku-4-5' // /observe — cheap + latency-friendly
const MAX_WRITE_BYTES = 200_000 // sanity cap per file on model-proposed content
const CLI_TIMEOUT_MS = 300_000 // kill a hung `claude` after this; full-file rewrites are slow + high-variance

const MUSE_SYSTEM_PROMPT = `You are Muse — a design partner embedded in someone's live web app. A non-technical user (a founder, PM, or marketer) points at an element and tells you, in plain language, how they want it to feel. You handle the craft, and you have a point of view.

# Context you receive

The FULL source of every React + TypeScript file the selected elements live in, plus a list of which elements were selected and which file each lives in. The app is styled with Tailwind utility classes inline in className. When multiple elements are selected (a batch), apply the change consistently across all of them.

# Tools

You must use exactly one tool per turn.

- propose_options — your DEFAULT. Offer 1–3 distinct design DIRECTIONS for the request, each a complete applyable edit. Give a different option ONLY when there's a genuinely different good take (e.g. "Editorial" vs "Punchy") — don't pad to three with near-duplicates; one confident option is the right answer when there's one clear move. Each option carries the COMPLETE updated contents of every file it changes (one entry per file, exact relative path from context), changing only what's needed and keeping all other code byte-for-byte identical. Style with Tailwind utility classes inline in className only — never add CSS files, style objects, or extracted class variables. IMPORTANT: scope each option's change to the SELECTED element (and its own subtree) so the user can preview it in place; if the request genuinely needs to touch siblings or parents, that's fine, but prefer the tightest change that satisfies it.

- ask_clarifying_questions — the EXCEPTION. Use ONLY when the answer would materially change what you'd ship. If a thoughtful designer would just pick a direction and run with it, do that instead and let the user redirect after seeing it. When you do ask, ask ONE question with 2–3 concrete visual options, written for a non-technical person.

# Voice

You're a designer collaborator, not an AI assistant. That means:

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

The top-level rationale is one or two short sentences for a non-technical user: lead with the move, then the reason. Each option's label is 1–2 words ("Editorial", "Punchy") and its description is one plain-English sentence on what that direction does. Skip the diff narration — they can see the result.

You are a partner, not a tool. Make the call.`

// Used by /api/muse/observe in PR3 — a cheap, low-token call that fires when
// the user selects a new element, returning a one-line observation + 3
// starter chips for the opener of a fresh target context. Defined here so
// the voice rules live in one place; the endpoint lands next PR.
const OBSERVE_SYSTEM_PROMPT = `You are Muse — a design partner. The user just selected an element in their live app. Give them a quick read.

Respond with a JSON object containing two fields:

- observation: ONE short sentence (max ~20 words) noting something specific and useful about the element's current visual state from its className list and surrounding code. Be specific — "the border-white/10 is reading as a flat plate, not a contained card" beats "this could be improved." Designer voice. No preamble. No "I notice...".
- chips: 3 starter prompts tailored to the element's tag and context, each 2–4 words, written as something the user would say to you ("Make it pop", "Tighten the spacing", "Try a different color"). Vary them — don't return three rephrasings of the same idea.

Ground observations in what's actually visible in the className list. Don't speculate about things you can't see.`

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

// Resolve a client-supplied path and confirm it truly lives inside <root>/src.
// Uses realpath + path.relative rather than a string startsWith, which guards
// against prefix collisions (`src-evil/`), `..` traversal, symlink escapes, and
// Windows case-insensitivity. Returns the canonical absolute path, or null.
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

// The observe endpoint asks for a bare JSON object, but models sometimes wrap
// it in prose or a ```json fence. Be liberal: strip fences, grab the outermost
// braces, parse, and validate the shape. Returns null if it can't recover a
// usable {observation, chips} — the client falls back to its heuristic opener.
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
          .filter((c, i, a) => a.indexOf(c) === i) // de-dupe — chips are React keys
          .slice(0, 3)
      : []
    if (!observation || chips.length === 0) return null
    return { observation, chips }
  } catch {
    return null
  }
}

export function musePlugin(): Plugin {
  let root = process.cwd()
  let apiKey = ''
  let model = DEFAULT_MODEL
  let backend = DEFAULT_BACKEND
  let cliModel = DEFAULT_CLI_MODEL
  let observeModel = DEFAULT_OBSERVE_MODEL
  let claudeBin = 'claude'

  return {
    name: 'muse-backend',
    apply: 'serve', // dev server only
    configResolved(config) {
      root = config.root
      const env = loadEnv(config.mode, root, '')
      apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
      model = env.MUSE_MODEL || process.env.MUSE_MODEL || DEFAULT_MODEL
      backend = (env.MUSE_BACKEND || process.env.MUSE_BACKEND || DEFAULT_BACKEND).trim()
      cliModel = env.MUSE_CLI_MODEL || process.env.MUSE_CLI_MODEL || DEFAULT_CLI_MODEL
      observeModel = env.MUSE_OBSERVE_MODEL || process.env.MUSE_OBSERVE_MODEL || DEFAULT_OBSERVE_MODEL
      if (backend === 'claude-cli') claudeBin = resolveClaudeBin()
    },
    configureServer(server) {
      // --- POST /api/muse/chat -------------------------------------------
      server.middlewares.use('/api/muse/chat', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          // The anthropic backend needs a key; claude-cli rides your subscription.
          if (backend !== 'claude-cli' && !apiKey) {
            return sendJson(res, 500, {
              error:
                'ANTHROPIC_API_KEY is not set. Add it to a .env.local file at the repo root (ANTHROPIC_API_KEY=sk-ant-...) and restart `npm run dev`.',
            })
          }

          const { targets, messages } = JSON.parse(await readBody(req))
          if (!Array.isArray(targets) || targets.length === 0) {
            return sendJson(res, 400, { error: 'No target elements provided.' })
          }

          // Resolve + read each unique source file. Skip anything outside src/.
          const files = new Map<string, string>() // rel -> contents
          const elementLines: string[] = []
          for (let i = 0; i < targets.length; i++) {
            const t = targets[i]
            const abs = resolveInSrc(root, t?.fileName)
            if (!abs) continue
            const rel = relOf(root, abs)
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
          const context =
            `The user selected ${elementLines.length} element(s):\n${elementLines.join('\n')}\n\n` +
            `Relevant files:\n\n${filesBlock}`

          const originals = Object.fromEntries(files) // rel -> original content, for diffing

          // --- claude-cli backend: spend the subscription, not metered tokens.
          if (backend === 'claude-cli') {
            const prompt =
              `${context}\n\n## Conversation so far\n${flattenTranscript(messages as Anthropic.MessageParam[])}\n\n` +
              `## Now\nRespond to the user's latest message using the structured output schema. Default to mode="options".`
            const content = await runChatViaCli(claudeBin, cliModel, prompt)
            return sendJson(res, 200, { content, stop_reason: 'tool_use', originals })
          }

          // --- anthropic backend: the original metered Messages API path.
          // Inject the context into the first (user) message.
          const outMessages = (messages as Anthropic.MessageParam[]).map((m, i) => {
            if (i === 0 && m.role === 'user' && typeof m.content === 'string') {
              return { role: 'user' as const, content: `${context}\n\n## The user's request\n${m.content}` }
            }
            return m
          })

          const client = new Anthropic({ apiKey })
          const resp = await client.messages.create({
            model,
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
      })

      // --- POST /api/muse/observe ----------------------------------------
      // Cheap opener: one element in, {observation, chips} out. No tools, low
      // token cap. The client renders an instant heuristic first and swaps in
      // this read when it lands, caching per element so it fires at most once.
      server.middlewares.use('/api/muse/observe', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          if (!apiKey) {
            return sendJson(res, 500, {
              error:
                'ANTHROPIC_API_KEY is not set. Add it to a .env.local file at the repo root (ANTHROPIC_API_KEY=sk-ant-...) and restart `npm run dev`.',
            })
          }

          const { target } = JSON.parse(await readBody(req))
          if (!target || typeof target !== 'object') {
            return sendJson(res, 400, { error: 'No target element provided.' })
          }
          const abs = resolveInSrc(root, target.fileName)
          if (!abs) {
            return sendJson(res, 400, {
              error: 'The selected element does not map to an editable file under src/.',
            })
          }
          const rel = relOf(root, abs)
          const source = fs.readFileSync(abs, 'utf8')

          const context =
            `Selected element: <${target.tag ?? '?'}> in ${rel}` +
            (target.text ? ` — "${target.text}"` : '') +
            `\nIts className: "${target.classNames ?? ''}"\n\n` +
            `Full source of ${rel} (for surrounding context):\n\`\`\`tsx\n${source}\n\`\`\`\n\n` +
            `Give your read as the JSON object described in your instructions — nothing else.`

          const client = new Anthropic({ apiKey })
          const resp = await client.messages.create({
            model: observeModel,
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
      })

      // --- POST /api/muse/write ------------------------------------------
      server.middlewares.use('/api/muse/write', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const { files } = JSON.parse(await readBody(req))
          if (!Array.isArray(files) || files.length === 0) {
            return sendJson(res, 400, { error: 'No files to write.' })
          }

          // Validate everything BEFORE writing anything (all-or-nothing).
          const resolved: Array<{ abs: string; content: string }> = []
          for (const f of files) {
            const abs = resolveInSrc(root, f?.fileName)
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
          for (const r of resolved) fs.writeFileSync(r.abs, r.content, 'utf8') // -> Vite HMR
          return sendJson(res, 200, { ok: true })
        } catch (err) {
          console.error('[muse] /write error:', err)
          return sendJson(res, 500, { error: (err as Error).message ?? String(err) })
        }
      })
    },
  }
}

// --- Tool schemas -----------------------------------------------------------
const ASK_TOOL: Anthropic.Tool = {
  name: 'ask_clarifying_questions',
  description:
    'Ask ONE short clarifying question with 2–3 concrete visual options. Use ONLY when the answer would materially change what you ship — if a thoughtful designer would just pick a direction and run with it, use propose_edit instead (that is the default). Almost always: don\'t ask.',
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

const PROPOSE_OPTIONS_TOOL: Anthropic.Tool = {
  name: 'propose_options',
  description:
    'Propose 1–3 distinct design directions for the request. Give multiple options only when there are genuinely different good takes; one confident option is correct when there is one clear move. Each option is a complete, applyable edit. Scope each change to the selected element so it can be previewed in place.',
  input_schema: {
    type: 'object',
    properties: {
      rationale: {
        type: 'string',
        description:
          'One or two plain-English sentences for a non-technical user: the overall move and why. Covers the whole proposal.',
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

// --- claude-cli backend -----------------------------------------------------
// The CLI has no native tool-calling, so the two-tool design (propose_options |
// ask_clarifying_questions) collapses into ONE structured-output schema with a
// `mode` discriminator, validated by `claude --json-schema`. The result lands in
// the response's `structured_output` field, which we reshape back into the exact
// tool_use-shaped `content` the frontend already consumes — so the client is
// untouched and either backend looks identical to it.

// Resolve the `claude` executable once. `where` (win) / `which` (posix) returns
// the real path so spawn can run it shell-free — which matters because we pass a
// multi-line system prompt and a quote-heavy JSON schema as raw argv entries.
function resolveClaudeBin(): string {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const out = execFileSync(finder, ['claude'], { encoding: 'utf8' })
    const hits = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    // On Windows `where` may list a .cmd shim alongside the native .exe. Prefer
    // the .exe — spawn() runs it shell-free; a .cmd would need a shell (and the
    // multi-line system prompt / JSON-schema args don't survive shell quoting).
    const exe = hits.find((h) => /\.exe$/i.test(h))
    return exe || hits[0] || 'claude'
  } catch {
    return 'claude' // fall back to PATH lookup at spawn time
  }
}

// MUSE_SYSTEM_PROMPT references the two tools by name; this appendix maps that
// same behaviour onto the single structured-output object the CLI returns.
const CLI_SYSTEM_PROMPT = `${MUSE_SYSTEM_PROMPT}

# Output format (IMPORTANT — read this last, it overrides the "Tools" section above)

You have NO callable tools here. Return your answer ONLY as the structured object defined by the schema:

- To propose design directions (your DEFAULT, the old propose_options): set mode="options", write the one/two-sentence rationale, and give 1–3 options. Each option has a 1–2 word label, a one-sentence description, and an "edits" array. Each edit is { fileName: the exact relative path from the context, newContent: the COMPLETE updated contents of that file }. Change only what's needed; keep every other byte identical. Tailwind utility classes inline only. Leave "questions" empty.
- To ask (the rare exception, the old ask_clarifying_questions): set mode="clarify" and give exactly ONE entry in "questions" with 2–3 concrete visual options. Leave "rationale" and "options" empty.

Every voice, decisiveness, and rationale rule above still applies — only the delivery mechanism changed.`

// One schema, `mode` discriminator. We don't hard-require options/questions at
// the schema level (the model fills the pair that matches `mode`); the reshape
// below tolerates either being absent.
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
          edits: EDITS_SCHEMA,
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

// Flatten the message history (which can carry assistant tool_use blocks and user
// tool_result blocks from prior turns) into a plain transcript. The CLI is
// stateless per call and we re-read current file state every turn, so prior edit
// bodies aren't needed — just the conversational flow that shaped the request.
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
      for (const b of m.content as Array<{ type?: string; text?: string; name?: string; input?: any }>) {
        if (b.type === 'text' && b.text) {
          lines.push(`MUSE: ${b.text}`)
        } else if (b.type === 'tool_use') {
          if (b.name === 'ask_clarifying_questions') {
            const q = b.input?.questions?.[0]?.question ?? '(a clarifying question)'
            lines.push(`MUSE (asked): ${q}`)
          } else {
            const labels = (b.input?.options ?? []).map((o: { label?: string }) => o?.label).filter(Boolean).join(', ')
            lines.push(`MUSE (proposed${labels ? ` — ${labels}` : ''}): ${b.input?.rationale ?? ''}`)
          }
        }
      }
    }
  }
  return lines.join('\n')
}

// Shell out to `claude -p`, feed the prompt over stdin, and reshape the validated
// structured_output back into the frontend's tool_use-shaped content array.
// Flags, in order of why they're here:
//   --tools ""            no built-in tools — stays a single-shot generator, can't
//                         read/write files on its own (preserves the approve→/write loop)
//   --strict-mcp-config   ignore this dir's MCP servers (else ~28k tokens of schemas)
//   --setting-sources ""  ignore user/project settings (hooks, CLAUDE.md, auto-memory)
//   --json-schema         server-side structured-output validation
// ANTHROPIC_API_KEY is stripped from the child env so auth can only resolve to the
// logged-in subscription, never silently bill a key picked up from .env.local.
function runChatViaCli(bin: string, model: string, prompt: string): Promise<Anthropic.ContentBlock[]> {
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

    // Settle exactly once — a timeout, an error, and a close can all race.
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    // A hung `claude` (waiting on auth, a stalled API call) would otherwise hold
    // the HTTP request open forever. Kill it past the deadline and reject.
    const timer = setTimeout(() => {
      child.kill()
      done(() => reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s.`)))
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    // stdin can EPIPE if the child dies before draining the prompt; swallow it so
    // it surfaces as a clean reject via 'error'/'close', not an uncaught throw.
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
        // The CLI can exit 0 yet flag a model-level failure (rate limit, refusal);
        // surface its message rather than the generic "no structured output".
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
          // Match the API tool's minItems:1 invariant, and stamp an `id` on each
          // option so the frontend isn't relying on its index fallback.
          const options = (Array.isArray(so.options) ? so.options : []).map((o, i) => ({
            id: `opt-${i}`,
            ...(o as Record<string, unknown>),
          }))
          if (options.length === 0) {
            return reject(new Error("claude CLI didn't return any changes. Try rephrasing."))
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
      // child already gone — the 'error'/'close' handler will reject.
    }
  })
}
