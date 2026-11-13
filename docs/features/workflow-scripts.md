# WORKFLOW_SCRIPTS: Deterministic Multi-Agent Workflow Orchestration

> Feature flag: `FEATURE_WORKFLOW_SCRIPTS=1`
> Engine package: [`@claude-code-best/workflow-engine`](../../packages/workflow-engine/) (deterministic JS script orchestration, zero runtime dependencies in the core layer)
> Integration layer: [`src/workflow/`](../../src/workflow/)

## 1. Overview

WORKFLOW_SCRIPTS lets Claude Code orchestrate multiple sub-agents with **deterministic JavaScript scripts**: work that can be decomposed or parallelized, needs multi-perspective confidence, exceeds a single context, and must be resumable and auditable.

- **Orchestration primitives**: `agent` / `parallel` / `pipeline` / `phase` / `log` / `workflow` (see the engine package).
- **Determinism**: scripts run in a restricted sandbox where `Date.now()`, `Math.random()`, and argument-less `new Date()` are disabled, so the journal can be replayed.
- **Deep backend**: a single `claude-code` AgentAdapter plugs into the current session system (provider / model / agentType / tools), and `agent()` calls inside a workflow run real sub-agents.
- **Monitoring panel**: the `/workflows` two-column live panel (see section 6).
- **Orchestration handbook**: `/ultracode` injects orchestration practice (see section 7).

> History: early versions were a YAML/JSON DSL with an all-stub implementation (`WorkflowDetailDialog` and others). It has been fully rewritten as an engine-driven JS approach.

## 2. Architecture

```
   .claude/workflows/<name>.ts        Workflow tool (name/script/scriptPath/args/resumeFromRunId)
            │                                       │
            ▼                                       ▼
   namedWorkflowCommands.ts              src/workflow/wiring.ts (createWorkflowToolCore)
   (/<name> command discovery)                      │
                                                   ▼
                                      WorkflowService (facade: launch/kill/subscribe/listRuns/listNamed)
                                                   │
                                  ┌────────────────┼─────────────────┐
                                  ▼                ▼                 ▼
                          ports.ts            registry.ts        progress/
                       (port aggregation)  (AgentAdapterRegistry)  bus + store
                                  │                │
                                  ▼                ▼
                      hostHandle.ts        backends/claudeCodeBackend.ts
                     (opaque host)         (reads the session system deeply, runs real agents)
                                  │
                                  ▼
                  @claude-code-best/workflow-engine
                  (runWorkflow / hooks / journal / budget / concurrency semaphore)
```

### 2.1 Module list

| Layer | File | Responsibility |
|----|------|------|
| Engine | `packages/workflow-engine/src/` | Deterministic script sandbox + hooks + journal + budget + semaphore; exports `createWorkflowTool` |
| Tool assembly | `src/workflow/wiring.ts` | `createWorkflowToolCore()` assembles the `Workflow` tool from `WorkflowService.ports` |
| Service facade | `src/workflow/service.ts` | `WorkflowService` singleton: `launch` / `kill` / `subscribe` / `listRuns` / `listNamed` / `getWorkflowService()` |
| Ports | `src/workflow/ports.ts` | `createWorkflowPorts()` aggregates all ports (agentRunner/registry/progress/task/journal/permission/logger/hostFactory) |
| Backend registration | `src/workflow/registry.ts` | `buildRegistry()` registers the `claude-code` backend and makes it the default |
| Deep backend | `src/workflow/backends/claudeCodeBackend.ts` | AgentAdapter: resolves the session system by `agentType`/`model`, runs real sub-agents, structured output |
| Host handle | `src/workflow/hostHandle.ts` | `buildHostBundle()` opaquely wraps `toolUseContext`/`canUseTool`/`parentMessage` |
| Progress bus | `src/workflow/progress/bus.ts` | Set-based progress event emitter |
| Progress state | `src/workflow/progress/store.ts` | Reducer: correlates `agent_done` precisely by `agentId` (fixes a concurrency race) |
| Monitoring panel | `src/workflow/panel/*.tsx` | The `/workflows` two-column UI (see section 6) |
| Named commands | `src/workflow/namedWorkflowCommands.ts` | Scans `.claude/workflows/` to generate `/<name>` commands |
| Permission request | `src/workflow/WorkflowPermissionRequest.tsx` | Workflow launch permission UI |

### 2.2 Registration points

| Location | Content |
|------|------|
| `src/tools.ts:152-153,254` | `createWorkflowToolCore()` dynamically loads and registers the `Workflow` tool (feature-gated) |
| `src/commands.ts:95-97,392` | The `/workflows` command (local-jsx, loads `panelCall.js`) |
| `src/skills/bundled/ultracode.ts` + `index.ts` | The `/ultracode` knowledge skill (`registerBundledSkill`) |

## 3. Orchestration primitives

The hooks available inside a workflow script (see the engine package's `engine/hooks.ts` for exact semantics):

| Primitive | Semantics |
|------|------|
| `agent(prompt, opts?)` | Dispatches a sub-agent; returns the final text, or a structured object when `opts.schema` is given. opts: `model` / `agentType` / `label` / `phase` / `schema` |
| `parallel([() => …])` | Runs an array of thunks concurrently with a **barrier** (waits for all); if one item throws, that item becomes `null` and the rest are kept |
| `pipeline(items, s1, s2, …)` | Runs each item through the stages in a chain; **no barrier between items**, stages are sequential within an item; if a stage throws for one item, that item becomes `null` |
| `phase(title)` | Marks a phase (the panel groups by it) |
| `log(msg)` | Progress log (shown in the panel, no state change) |
| `workflow(name \| { scriptPath }, args?)` | Nests one level of sub-workflow (only one level is allowed) |

**Hard limits**: a single `parallel`/`pipeline` is capped at `MAX_ITEMS_PER_CALL` (4096); total agents per workflow at `MAX_TOTAL_AGENTS` (1000); the concurrency cap defaults to `DEFAULT_MAX_CONCURRENCY` (3), can be overridden through the Workflow tool's `maxConcurrency` input, and has an absolute ceiling of `MAX_CONCURRENCY_CAP` (16).

## 4. Writing a workflow

Put scripts at `.claude/workflows/<name>.js|.mjs` (`.ts` is also accepted, but **the engine does not transpile TS**, so type annotations cause a syntax error; `.js`/`.mjs` is recommended). Each one automatically becomes a `/<name>` command.

```js
// .claude/workflows/review-changes.js
export const meta = {
  name: 'review-changes',
  description: 'Review changes by dimension and verify adversarially',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}

const DIMENSIONS = [
  { key: 'bugs', prompt: 'Find correctness bugs' },
  { key: 'perf', prompt: 'Find performance problems' },
]

const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review' }),
  review => parallel(
    (review.findings || []).map(f => () =>
      agent(`Adversarial verification: ${f.title}`, { phase: 'Verify' })
    )
  )
)
return results.flat().filter(Boolean)
```

**Script execution constraints** (the engine's execution model; violations raise errors immediately):

A script is the **function body** of a `new AsyncFunction`, not an ESM module:

- **No `import`**: `agent`/`parallel`/`pipeline`/`phase`/`log`/`workflow`, plus `args`/`budget`, are injected parameters; use them directly.
- **No TS syntax**: no type annotations (`x: number`), `interface`, `enum`, `as`, or generics. The engine does not transpile, so even in a `.ts` file these are reported as syntax errors as-is.
- **Exactly one `export const meta = {...}`** (extracted and stripped by the engine with a regex); no other `export`, and no `export default`.
- **A top-level `return` returns the result**.

**Determinism constraints** (violating them breaks resume):
- No `Date.now()` / `Math.random()` / argument-less `new Date()` (the sandbox throws). Pass timestamps or random seeds in through `args`.
- `export const meta = { ... }` must be a **pure literal** (no variables, function calls, or template interpolation). It is evaluated at load time, and anything else throws `ScriptError`.

## 5. The Workflow tool

The model launches a workflow through the `Workflow` tool (see the engine package's `tool/schema.ts` for the input schema):

| Field | Description |
|------|------|
| `script` | Inline script string |
| `name` | Named workflow (corresponds to `.claude/workflows/<name>`) |
| `scriptPath` | Script file path |
| `args` | `args` passed through to the script (any JSON value) |
| `resumeFromRunId` | Replay from an existing runId (completed `agent()` calls return instantly, and execution reruns live after the point of divergence) |

## 6. Monitoring panel: `/workflows`

`/workflows` opens a three-zone focus panel (local-jsx, full screen):

- **Top tabs**: one tab per run (status dot + workflow name + a short `#runId` code); running the same script several times produces several tabs.
- **Left phase sidebar**: `All` plus the merge of phases declared in meta (not yet started `○`, grey pending) and actual phases (`●` running / `✓` done); the selection decides the filter in the right column.
- **Right agent list**: filtered by the selected phase; status color plus trailing text (`running` / `object` / `text` / `dead`).

**Keys**: `Tab`/`Shift+Tab` switch run · `←`/`→` switch the focused column (phases ↔ agents) · `↑`/`↓` move within a column · `r` resume · `x` kill · `n` new prompt · `q`/`Esc` quit.

**Visuals**: no inner frame, one vertical line between left and right; the focused column's title is bold orange; the selected/cursor row gets an orange background (`backgroundColor`) with the text color unchanged.

Progress correlates `agent_done` precisely by the engine's `agentId` (fixing the concurrent LIFO race). Pending phases come from the `meta.phases` carried by the `run_started` event; the store keeps `declaredPhases`, and the panel's `mergePhases` merges them. `useSyncExternalStore` subscribes to `WorkflowService` with a stable snapshot, so nothing re-renders when nothing changes.

## 7. The `/ultracode` skill

`/ultracode` (`src/skills/bundled/ultracode.ts`) injects the practice of orchestrating multi-agent workflows: when to use it and when not, a quick reference for the orchestration primitives, a library of quality patterns (adversarial-verify / judge-panel / loop-until-dry / multi-modal-sweep / completeness-critic), determinism constraints, backend routing, resume/budget, and files and commands.

**A pure-knowledge prompt skill**: zero runtime side effects, no change to the main loop, and no behavior switch. Invoking it just injects the handbook into the context.

## 8. resume / journal / budget

- **journal**: each run is recorded at `.claude/workflow-runs/<runId>/journal.jsonl`. `resumeFromRunId` replays the journal, and completed `agent()` calls return their cached results instantly.
- **budget**: `budget.total` is a hard token ceiling (default `null` = unlimited); `budget.spent()` / `budget.remaining()` read live consumption; once it is exhausted, dispatching another `agent()` throws.
- **Concurrency**: the engine's `Semaphore` defaults to 3 permits (`DEFAULT_MAX_CONCURRENCY`) and can be overridden per run through the Workflow tool's `maxConcurrency` input (clamped to `[1, MAX_CONCURRENCY_CAP=16]`).
- **Errors**: a script syntax/meta error → `parseScript` returns the error immediately (never goes to the background); an agent throws → `kind:'dead'` → `null`, and the workflow continues (`parallel`/`pipeline` tolerate failures); `WorkflowAbortedError` → `killed`.

## 9. File index

| File | Responsibility |
|------|------|
| `src/workflow/wiring.ts` | `Workflow` tool assembly (`createWorkflowToolCore`) |
| `src/workflow/service.ts` | `WorkflowService` facade |
| `src/workflow/ports.ts` | Port aggregation (`createWorkflowPorts`) |
| `src/workflow/registry.ts` | `AgentAdapterRegistry` + default backend |
| `src/workflow/backends/claudeCodeBackend.ts` | Deep-backend AgentAdapter |
| `src/workflow/hostHandle.ts` | Opaque host handle (`buildHostBundle`) |
| `src/workflow/progress/bus.ts` | Progress event bus |
| `src/workflow/progress/store.ts` | Progress reducer (`agentId` correlation) |
| `src/workflow/panel/*.tsx` | The `/workflows` two-column panel |
| `src/workflow/namedWorkflowCommands.ts` | `/<name>` command discovery |
| `src/workflow/WorkflowPermissionRequest.tsx` | Launch permission UI |
| `src/skills/bundled/ultracode.ts` | The `/ultracode` knowledge skill |
| `src/tools.ts:152-153,254` | Tool registration |
| `src/commands.ts:95-97,392` | `/workflows` command registration |
| `packages/workflow-engine/` | Engine package (hooks / journal / budget / concurrency) |
