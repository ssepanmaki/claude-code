/**
 * research-report runner — runs the workflow directly with @claude-code-best/workflow-engine,
 * bypassing the Workflow tool and the core runAgent entirely. The agent() backend connects straight to the Anthropic SDK
 * (@anthropic-ai/sdk): a sub-agent = one messages.create call.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... \
 *     bun run packages/workflow-engine/examples/research-report/run.ts "Edge Computing"
 *
 * Optional environment variables:
 *   ANTHROPIC_MODEL     model name, defaults to claude-sonnet-4-5
 *   RESEARCH_RUNS_DIR   journal directory, defaults to ~/.claude/workflow-runs (reused on resume)
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createFileJournalStore,
  createHostHandle,
  runWorkflow,
  Semaphore,
  validateAgainstSchema,
  type AgentRunParams,
  type AgentRunResult,
  type ProgressEvent,
  type WorkflowPorts,
} from '@claude-code-best/workflow-engine'

const SCRIPT_FILE = `${import.meta.dir}/research-report.workflow.mjs`
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
const MAX_TOKENS = 4096

// Terminal coloring (no third-party dependencies)
const paint = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

// client is constructed by main() and referenced by the llmAgent closure. The null guard avoids real calls at import time.
const clientRef: { client: Anthropic | null } = { client: null }

// API concurrency limit (independent of the engine's CPU semaphore — LLM APIs are far more sensitive to concurrency than CPU; default 3).
// Adjust with WORKFLOW_API_CONCURRENCY.
const apiSem = new Semaphore(
  Math.max(1, Number(process.env.WORKFLOW_API_CONCURRENCY) || 3),
)

/** Retry on 429/5xx/connection errors with exponential backoff (500ms → 1s → 2s → 4s), at most 4 times. */
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isRetryable(e) || attempt >= retries) throw e
      const wait = Math.min(500 * 2 ** attempt, 8000)
      await new Promise(r => {
        setTimeout(r, wait)
      })
    }
  }
}

function isRetryable(e: unknown): boolean {
  const err = e as { status?: number; name?: string }
  if (err.status === 429) return true
  if (typeof err.status === 'number' && err.status >= 500) return true
  if (typeof err.name === 'string' && /Connection|Timeout/i.test(err.name)) {
    return true
  }
  return false
}

/** Condensed error summary (avoids printing the whole message including the request body). */
function errSummary(e: unknown): string {
  const err = e as {
    status?: number
    error?: { type?: string }
    message?: string
  }
  if (err.status) return `HTTP ${err.status} ${err.error?.type ?? ''}`.trim()
  return (err.message ?? 'unknown').slice(0, 120)
}

/**
 * Real LLM agentRunner: one messages.create (via the API concurrency semaphore + retry).
 * schema mode: append a JSON instruction to the prompt → take the text → extract JSON → Ajv validation → return dead on failure.
 * non-schema: return plain text.
 */
async function llmAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const client = clientRef.client
  if (client === null) return { kind: 'dead' }

  const schemaInstruction = params.schema
    ? '\n\nYou must answer with a single JSON object as the entire response (no Markdown code fences, no explanation), and it must match the following JSON Schema:\n' +
      JSON.stringify(params.schema)
    : ''

  const release = await apiSem.acquire()
  try {
    const resp = await withRetry(() =>
      client.messages.create({
        model: params.model ?? DEFAULT_MODEL,
        max_tokens: params.maxTokens ?? MAX_TOKENS,
        messages: [
          { role: 'user', content: params.prompt + schemaInstruction },
        ],
      }),
    )
    const outputTokens = resp.usage.output_tokens
    const truncated = resp.stop_reason === 'max_tokens'

    if (params.schema) {
      // Truncated JSON is almost certainly incomplete → mark dead directly (rather than letting parsing fail vaguely)
      if (truncated) return { kind: 'dead' }
      const text = resp.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim()
      const parsed = extractJsonObject(text)
      if (parsed === null) return { kind: 'dead' }
      const { valid } = validateAgainstSchema(parsed, params.schema)
      if (!valid) return { kind: 'dead' }
      return { kind: 'ok', output: parsed as object, usage: { outputTokens } }
    }
    const text = resp.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    if (truncated) {
      console.error(
        paint.yellow(
          `  ⚠ Output truncated by max_tokens (${outputTokens} tokens)`,
        ),
      )
    }
    return { kind: 'ok', output: text, usage: { outputTokens } }
  } catch (e) {
    console.error(paint.red(`  ✗ ${errSummary(e)}`))
    return { kind: 'dead' }
  } finally {
    release()
  }
}

/**
 * Fault-tolerant JSON extraction: strip code fences → from the first { do bracket-depth matching (skipping string literals and
 * escapes, modeled on extractMeta in src/engine/script.ts), take the paired {…} → JSON.parse.
 * More robust than lastIndexOf('}'): correctly handles } in prose after the JSON, a second object, and } inside strings.
 */
function extractJsonObject(text: string): unknown | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const start = stripped.indexOf('{')
  if (start < 0) {
    try {
      return JSON.parse(stripped)
    } catch {
      return null
    }
  }
  let depth = 0
  let inStr: string | null = null
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** In-memory taskRegistrar: bypasses the core LocalWorkflowTask and only maintains runId → AbortController. */
function makeTaskRegistrar(): WorkflowPorts['taskRegistrar'] {
  const controllers = new Map<string, AbortController>()
  return {
    register(opts) {
      const ac = new AbortController()
      const runId = opts.runId ?? `research-${controllers.size + 1}`
      controllers.set(runId, ac)
      return { runId, signal: ac.signal }
    },
    complete() {},
    fail() {},
    kill(runId) {
      controllers.get(runId)?.abort()
    },
    pendingAction() {
      return null
    },
  }
}

/** Progress events → real-time terminal output. */
function printProgress(e: ProgressEvent): void {
  switch (e.type) {
    case 'run_started':
      console.log(paint.bold(paint.cyan(`\n▶ ${e.workflowName}`)))
      break
    case 'phase_started':
      console.log(paint.cyan(`\n━ phase: ${e.phase}`))
      break
    case 'phase_done':
      break
    case 'agent_started':
      console.log(`  ${paint.dim('→')} ${e.label ?? 'agent'}`)
      break
    case 'agent_done': {
      const tag =
        e.result.kind === 'ok'
          ? paint.green('✓')
          : e.result.kind === 'skipped'
            ? paint.yellow('⊘')
            : paint.red('✗')
      console.log(
        `  ${tag} ${e.label ?? 'agent'} ${paint.dim(`[${e.result.kind}]`)}`,
      )
      break
    }
    case 'log':
      console.log(`  ${paint.dim('·')} ${e.message}`)
      break
    case 'run_done':
      console.log(paint.bold(`\n■ ${e.status}`))
      break
  }
}

/** Assemble ports: the agent backend connects straight to the SDK, the rest are self-contained implementations that never touch the core layer. */
function makePorts(runsDir: string): WorkflowPorts {
  return {
    agentRunner: { runAgentToResult: llmAgent },
    progressEmitter: { emit: printProgress },
    taskRegistrar: makeTaskRegistrar(),
    journalStore: createFileJournalStore(runsDir),
    permissionGate: { isAborted: () => false },
    logger: { debug: () => {}, event: () => {} },
    hostFactory: () => ({
      handle: createHostHandle(null),
      cwd: process.cwd(),
      budgetTotal: null,
    }),
  }
}

async function main(): Promise<void> {
  const topic = process.argv[2]
  if (!topic) {
    console.error(paint.red('✗ Usage: run.ts <research topic>'))
    console.error(paint.dim('  e.g.: bun run run.ts "Edge Computing"'))
    process.exit(1)
  }

  clientRef.client = new Anthropic({ logLevel: 'off' })
  const runsDir =
    process.env.RESEARCH_RUNS_DIR ?? join(homedir(), '.claude', 'workflow-runs')
  const script = await readFile(SCRIPT_FILE, 'utf-8')

  const result = await runWorkflow({
    script,
    args: { topic },
    runId: `research-${Date.now()}`,
    ports: makePorts(runsDir),
    host: createHostHandle(null),
    signal: new AbortController().signal,
    cwd: process.cwd(),
    budgetTotal: null,
  })

  if (result.status !== 'completed') {
    console.error(
      paint.red(`✗ workflow ${result.status}：${result.error ?? ''}`),
    )
    process.exit(1)
  }
  const ret = result.returnValue as {
    report?: string
    topic?: string
    anglesCovered?: number
    findingsDeepened?: number
  }
  console.log(
    paint.bold(
      paint.green(
        `\n════════ Technical research report: ${ret.topic ?? topic} ════════`,
      ),
    ),
  )
  console.log(
    paint.dim(
      `angles=${ret.anglesCovered ?? '?'} deepened=${ret.findingsDeepened ?? '?'}`,
    ),
  )
  console.log(ret.report ?? '(no report output)')
}

// Only starts when run directly as a script (not triggered on import, convenient for smoke tests / reusing the port factory)
if (import.meta.main) {
  await main()
}
