/**
 * registry multi-backend routing demo (mock adapter, no API key needed).
 *
 * Two adapters: strong (matched by the researcher route) + fast (default).
 * In the script agent({agentType:'researcher'}) → strong, everything else → fast.
 * Proves the agent backend can be plugged in and routed via AgentAdapterRegistry; the engine does not care about the implementation.
 *
 * Usage: bun run packages/workflow-engine/examples/registry-demo.ts
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AgentAdapterRegistry,
  createFileJournalStore,
  createHostHandle,
  runWorkflow,
  type AgentAdapter,
  type AgentRunParams,
  type AgentRunResult,
  type WorkflowPorts,
} from '@claude-code-best/workflow-engine'

const strongAdapter: AgentAdapter = {
  id: 'strong',
  capabilities: { structuredOutput: true, tools: true },
  async run(p: AgentRunParams): Promise<AgentRunResult> {
    return {
      kind: 'ok',
      output: `[strong] ← ${p.prompt}`,
      usage: { outputTokens: 1 },
    }
  },
}

const fastAdapter: AgentAdapter = {
  id: 'fast',
  capabilities: { structuredOutput: false },
  async run(p: AgentRunParams): Promise<AgentRunResult> {
    return {
      kind: 'ok',
      output: `[fast] ← ${p.prompt}`,
      usage: { outputTokens: 1 },
    }
  },
}

const registry = new AgentAdapterRegistry()
  .register(strongAdapter)
  .register(fastAdapter)
  .route({ kind: 'agentType', agentType: 'researcher', adapter: 'strong' })
  .default('fast')

const SCRIPT = `
export const meta = { name: 'registry-demo', description: 'multi-adapter routing' }
phase('Route')
const research = await agent('Deep research task', { agentType: 'researcher', label: 'research' })
const quick = await agent('Quick small task', { label: 'quick' })
return { research, quick }
`

function makePorts(runsDir: string): WorkflowPorts {
  return {
    // The registry takes priority; agentRunner is only a shape placeholder (never called)
    agentRunner: { runAgentToResult: async () => ({ kind: 'dead' }) },
    agentAdapterRegistry: registry,
    progressEmitter: {
      emit: e => {
        if (e.type === 'phase_started') console.log(`\n━ phase: ${e.phase}`)
        else if (e.type === 'agent_done') {
          const out =
            e.result.kind === 'ok'
              ? String(e.result.output)
              : `[${e.result.kind}]`
          console.log(`  ✓ ${e.label} → ${out}`)
        }
      },
    },
    taskRegistrar: {
      register: () => ({
        runId: 'demo',
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

if (import.meta.main) {
  await registry.initializeAll()
  try {
    const result = await runWorkflow({
      script: SCRIPT,
      runId: `demo-${Date.now()}`,
      ports: makePorts(join(tmpdir(), 'wf-registry-demo')),
      host: createHostHandle(null),
      signal: new AbortController().signal,
      cwd: process.cwd(),
      budgetTotal: null,
    })
    console.log(`\n■ ${result.status}`)
    if (result.status === 'completed') {
      const ret = result.returnValue as { research: string; quick: string }
      console.log(
        `research(agentType:researcher) → ${ret.research.startsWith('[strong]') ? 'strong adapter ✓' : '??'}`,
      )
      console.log(
        `quick(default)           → ${ret.quick.startsWith('[fast]') ? 'fast adapter ✓' : '??'}`,
      )
    }
  } finally {
    await registry.disposeAll()
  }
}
