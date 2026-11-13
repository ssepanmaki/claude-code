# research-report — a library-first example

Runs a workflow **directly** with `@claude-code-best/workflow-engine`, bypassing the Workflow tool and the core `runAgent`.

## Status

- **Engine layer**: complete, with test coverage of **99.65% lines / 99.20% functions** (all 112 mock tests of the workflow-engine package pass).
- **This example**: the orchestration logic (`parallel` / `pipeline` / `schema` / `args`) is verified end to end with mocks; **a real LLM run works** (connecting straight to the Anthropic SDK).
- **Positioning**: a **reference implementation + smoke demo** of the library API and engine logic, not a production service — see "Production readiness" below.

## What it demonstrates

- **The library is usable on its own**: `run.ts` only does `import { runWorkflow, ... } from '@claude-code-best/workflow-engine'` and assembles the 7 ports itself, depending on no core module under `src/`.
- **The agent backend connects straight to the Anthropic SDK**: `agentRunner` calls `client.messages.create`; a sub-agent = one model call (no core `runAgent`, no Workflow tool).
- **Real LLM + structured output**: `agent(schema)` → the prompt gets a JSON instruction appended → JSON is extracted → validated with `validateAgainstSchema` (Ajv), falling back to `dead` on failure.
- **Full coverage of engine capabilities**: `parallel` (barrier, multi-angle fan-out) → `pipeline` (no barrier, per-finding deep dive) → `phase` / `log` / `args`.

## Running

See the usage comment at the top of `run.ts`.

Environment variables:

- `ANTHROPIC_API_KEY` (required)
- `ANTHROPIC_MODEL`: defaults to `claude-sonnet-4-5`
- `WORKFLOW_API_CONCURRENCY`: API concurrency limit, defaults to `3` (see below). On a low tier you can set `1` to run serially
- `RESEARCH_RUNS_DIR`: journal directory, defaults to `~/.claude/workflow-runs` (reused on resume)

## Robustness and troubleshooting

The runner has several built-in measures that keep real API runs stable:

- **API concurrency limit**: `llmAgent` limits concurrency through its own semaphore (default 3), **independent of the engine's CPU-level semaphore** — LLM APIs are far more sensitive to concurrency than CPU, and sizing concurrency by cores (possibly 14) would trigger 429s. Tune it with `WORKFLOW_API_CONCURRENCY`.
- **429/5xx retry**: exponential backoff (500ms → 1s → 2s → 4s, at most 4 attempts); connection/timeout errors are retried too.
- **SDK logging off**: `new Anthropic({ logLevel: 'off' })` (options take the highest priority, overriding the `ANTHROPIC_LOG` env). Otherwise the SDK prints the full request JSON as `[log_xxxxx] sending request {…}`.
- **Condensed error summaries**: failures print only a short line such as `HTTP 429 rate_limit_error`, not the whole message including the request body.
- **Synthesize guards against JSON**: the prompt explicitly forbids pasting the input `deepFindings` JSON verbatim into the report.

Quick troubleshooting:

| Symptom | Cause / fix |
|---------|-------------|
| Frequent `HTTP 429 ...` | Lower `WORKFLOW_API_CONCURRENCY=1` (or 2) |
| Many agent `✗ [dead]` | The model did not return JSON matching the schema; use a stronger model or relax the schema |
| `[log_xxx] sending request` floods the screen | Should no longer appear (`logLevel:'off'` is set); if it still does, check whether an env var overrides it |
| Report truncated | synthesize already uses `maxTokens:8192`; if still not enough, edit the workflow script |

## Files

| File | Purpose |
|------|---------|
| `research-report.workflow.mjs` | The workflow script (orchestration logic, plain JS, executed in the engine sandbox) |
| `run.ts` | The runner: assembles the ports + connects straight to the SDK + runs + prints terminal progress |
| (sibling `../smoke.ts`) | Minimal smoke entry (3 calls, verifies the path in seconds) |

## Extension points

- **Web research**: add `tools: [{ type: 'web_search_20250305' }]` (Anthropic server-side web search) to `messages.create` in `llmAgent`, and the research angles can browse the web.
- **Named command reuse**: copy `research-report.workflow.mjs` to the project's `.claude/workflows/research-report.mjs` to run it via `/research-report` or the Workflow tool (same script, two entry points).
- **Token budget**: `runWorkflow({ budgetTotal: 200000 })` sets a cap; inside the script use `budget.remaining()` to scale adaptively.
- **Resume**: the same `runId` + `resume: true` replays the journal, and agents that already finished are not re-run.

## Production readiness (honest version)

This example verifies the **library API and the engine's orchestration logic**, not a production service. What is still missing for production:

- **Real-LLM load testing**: realistic validation of long workflows, heavy concurrency and interrupt/resume (mocks cannot cover model behavior).
- **v1 deferred items of the core adapter**: `budgetTotal` injection, skip/retry UI, worktree isolation, full StructuredOutput integration (this example uses prompt + JSON parsing, which is weaker than the real core path).
- **Error recovery**: journal resume has only been verified with mocks; replay correctness after a real mid-run crash has not been load tested.

The engine's core logic (concurrency / budget / journal / schema) is backed by mock tests with 99.65% coverage and can serve as a base to keep building on.
