/**
 * Smoke end-to-end entry — real SDK + engine, minimal verification of the end-to-end path.
 * 3 model calls (2 parallel angles with schema + 1 synthesis), finishes in seconds at low cost.
 * Covers: runWorkflow, parallel (barrier), structured agent(schema), text agent, progress events.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... \
 *     bun run packages/workflow-engine/examples/smoke.ts
 *
 * Optional: ANTHROPIC_MODEL (defaults to claude-sonnet-4-5)
 */
import Anthropic from '@anthropic-ai/sdk'
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

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
const clientRef: { client: Anthropic | null } = { client: null }

const POINT_SCHEMA = {
  type: 'object',
  required: ['point'],
  properties: { point: { type: 'string' } },
}

// Minimal workflow: 2 parallel angles (structured via schema) → synthesis (text). Concatenate with + inside the script to avoid ${}.
const SMOKE_SCRIPT =
  `
export const meta = { name: 'smoke', description: 'minimal end-to-end smoke' }
phase('Smoke')
const angles = ['a one-sentence definition', 'the single core value']
const points = await parallel(
  angles.map(a => () =>
    agent('In one short sentence (under 30 words) explain the "' + a + '" of workflow orchestration.', {
      label: 'p:' + a,
      schema: ` +
  JSON.stringify(POINT_SCHEMA) +
  `,
    }),
  ),
)
const clean = points.filter(Boolean)
const joined = clean.map(p => p.point).join('；')
const summary = await agent('Synthesize the following points into a one-sentence conclusion. Points: ' + joined, {
  label: 'summary',
})
return { points: clean, summary }
`

// API concurrency limit (independent of the engine's CPU semaphore — LLM APIs are far more sensitive to concurrency than CPU; default 3).
const apiSem = new Semaphore(
  Math.max(1, Number(process.env.WORKFLOW_API_CONCURRENCY) || 3),
)

/** Retry on 429/5xx/connection errors with exponential backoff, at most 4 times. */
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

function errSummary(e: unknown): string {
  const err = e as {
    status?: number
    error?: { type?: string }
    message?: string
  }
  if (err.status) return `HTTP ${err.status} ${err.error?.type ?? ''}`.trim()
  return (err.message ?? 'unknown').slice(0, 120)
}

async function llmAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const client = clientRef.client
  if (client === null) return { kind: 'dead' }
  const schemaInstruction = params.schema
    ? '\n\nAnswer with a single JSON object (no fences, no explanation) matching the schema:\n' +
      JSON.stringify(params.schema)
    : ''
  const release = await apiSem.acquire()
  try {
    const resp = await withRetry(() =>
      client.messages.create({
        model: params.model ?? DEFAULT_MODEL,
        max_tokens: params.maxTokens ?? 1024,
        messages: [
          { role: 'user', content: params.prompt + schemaInstruction },
        ],
      }),
    )
    const outputTokens = resp.usage.output_tokens
    if (resp.stop_reason === 'max_tokens') return { kind: 'dead' }
    const text = resp.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    if (params.schema) {
      const parsed = extractJsonObject(text)
      if (parsed === null) return { kind: 'dead' }
      if (!validateAgainstSchema(parsed, params.schema).valid) {
        return { kind: 'dead' }
      }
      return { kind: 'ok', output: parsed as object, usage: { outputTokens } }
    }
    return { kind: 'ok', output: text, usage: { outputTokens } }
  } catch (e) {
    console.error(`  ✗ ${errSummary(e)}`)
    return { kind: 'dead' }
  } finally {
    release()
  }
}

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

function makePorts(runsDir: string): WorkflowPorts {
  return {
    agentRunner: { runAgentToResult: llmAgent },
    progressEmitter: {
      emit: (e: ProgressEvent) => {
        if (e.type === 'phase_started') console.log(`\n━ phase: ${e.phase}`)
        else if (e.type === 'agent_started')
          console.log(`  → ${e.label ?? 'agent'}`)
        else if (e.type === 'agent_done')
          console.log(
            `  ${e.result.kind === 'ok' ? '✓' : '✗'} ${e.label ?? ''} [${e.result.kind}]`,
          )
        else if (e.type === 'log') console.log(`  · ${e.message}`)
      },
    },
    taskRegistrar: {
      register: () => ({
        runId: 'smoke',
        signal: new AbortController().signal,
      }),
      complete() {},
      fail() {},
      kill() {},
      pendingAction: () => null,
    },
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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('✗ Missing ANTHROPIC_API_KEY environment variable')
    process.exit(1)
  }
  clientRef.client = new Anthropic({ apiKey, logLevel: 'off' })
  const runsDir =
    process.env.RESEARCH_RUNS_DIR ?? join(homedir(), '.claude', 'workflow-runs')

  const result = await runWorkflow({
    script: SMOKE_SCRIPT,
    args: {},
    runId: `smoke-${Date.now()}`,
    ports: makePorts(runsDir),
    host: createHostHandle(null),
    signal: new AbortController().signal,
    cwd: process.cwd(),
    budgetTotal: null,
  })

  if (result.status !== 'completed') {
    console.error(`\n✗ FAIL：${result.status} ${result.error ?? ''}`)
    process.exit(1)
  }
  const ret = result.returnValue as {
    points: Array<{ point: string }>
    summary: string
  }
  console.log('\n━━━━━━━━ Smoke result ━━━━━━━━')
  for (const p of ret.points) console.log(`• ${p.point}`)
  console.log(`\nSummary: ${ret.summary}`)
  console.log(
    `\n✓ PASS: end-to-end path OK (${ret.points.length} points + synthesis, 3 model calls)`,
  )
}

if (import.meta.main) {
  await main()
}
