# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI coding agents when working with code in this repository.

## Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. TypeScript strict mode is enforced — **`bun run precheck` must pass with zero errors** (it runs typecheck + lint fix + tests).

## Git Commit Message Convention

Use **Conventional Commits**:

```
<type>: <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`

Examples:
- `feat: add model 1M context switch`
- `fix: fix first-login validation`
- `chore: remove prefetchOfficialMcpUrls call on startup`

## Commands

```bash
# Install dependencies
bun install

# Dev mode (runs cli.tsx with MACRO defines injected via -d flags)
bun run dev

# Dev mode with debugger (set BUN_INSPECT=9229 to pick port)
bun run dev:inspect

# Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# Build (code splitting, outputs dist/cli.js + chunk files)
bun run build

# Build with Vite (alternative build pipeline)
bun run build:vite

# Test
bun test                                    # run all tests
bun test src/utils/__tests__/hash.test.ts   # run single file
bun test --coverage                         # with coverage report

# Lint & Format (Biome) — use precheck for day-to-day work instead of calling these individually
bun run lint              # lint check (whole project)
bun run lint:fix          # auto-fix lint issues
bun run format            # format all (whole project)
bun run check             # lint + format check (whole project)
bun run check:fix         # lint + format auto-fix

# Health check
bun run health

# Check unused exports
bun run check:unused

# Full check (typecheck + lint fix + test) — must be run after finishing a task
bun run precheck

# Remote Control Server
bun run rcs

# Docs dev server (Mintlify)
bun run docs:dev
```

See `docs/testing-spec.md` for detailed testing conventions, coverage status and improvement plans.

## Architecture

### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `build.ts` runs `Bun.build()` with `splitting: true`, entry `src/entrypoints/cli.tsx`, output `dist/cli.js` + chunk files. The build enables a default set of features (see the Feature Flag section below). After building, `import.meta.require` is automatically replaced with a Node.js-compatible version (the output runs on both Bun and Node). The build copies `vendor/audio-capture/` and `src/utils/vendor/ripgrep/` into `dist/vendor/`.
- **Build (Vite)**: `vite.config.ts` + `scripts/post-build.ts`, code-splitting mode, chunks are emitted to `dist/chunks/`. The post-build step walks all `.js` files under `dist/` and `dist/chunks/` to patch the `globalThis.Bun` destructuring, and copies vendor files to `dist/vendor/`.
- **Vendor path resolution**: after building, chunk files live under `dist/` or `dist/chunks/`, and vendor binaries live in `dist/vendor/`. `src/utils/distRoot.ts` provides a shared `distRoot` function that locates the root by finding `lastIndexOf('dist')` or `lastIndexOf('src')` in the `import.meta.url` path. `ripgrep.ts`, `computerUse/setup.ts`, `claudeInChrome/setup.ts` and `updateCCB.ts` all use `distRoot` instead of computing paths from `import.meta.url` inline. `packages/audio-capture-napi/src/index.ts` has its own equivalent `lastIndexOf('dist')` logic.
- **Why Vite must split code**: Bun/JSC parses the bytecode and JIT of a single large JS file in full; a single 17MB output pushed RSS up to ~1GB (Node/V8 lazy parsing needs only ~220MB). After splitting into 600+ small chunks, Bun loads them on demand: `--version` RSS dropped from 966MB to 35MB, and a full load from 1GB+ to ~500MB.
- **Dev mode**: `scripts/dev.ts` injects `MACRO.*` defines via Bun's `-d` flag and runs `src/entrypoints/cli.tsx`. All features are enabled by default.
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — the workspace packages in `packages/` (plus a few helper directories) are resolved via `workspace:*`.
- **Lint/Format**: Biome (`biome.json`). Covers the whole project: `src/`, `scripts/`, `packages/` (including `packages/@ant/`). `bun run lint` / `bun run lint:fix` / `bun run format` / `bun run check` / `bun run check:fix`. 42 rules are turned off because of the decompiled code; only the `recommended` baseline is kept.
- **Pre-commit**: husky + lint-staged. On commit, staged files are checked with `biome check --fix` (TS/JS) and `biome format --write` (JSON).
- **CI Lint**: `ci.yml` runs `bunx biome ci .` after installing dependencies and before type checking; CI fails if lint or formatting is not clean.
- **Defines**: managed centrally in `scripts/defines.ts`. The version number is read from `package.json` (no longer hardcoded).
- **CI**: GitHub Actions — `ci.yml` (lint + build + test), `release-rcs.yml` (RCS release).

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint. The `main()` function handles several fast paths in priority order:
   - `--version` / `-v` — zero module loading
   - `--dump-system-prompt` — feature-gated (DUMP_SYSTEM_PROMPT)
   - `--claude-in-chrome-mcp` / `--chrome-native-host`
   - `--computer-use-mcp` — standalone MCP server mode
   - `--daemon-worker=<kind>` — feature-gated (DAEMON)
   - `remote-control` / `rc` / `remote` / `sync` / `bridge` — feature-gated (BRIDGE_MODE)
   - `daemon` [subcommand] — feature-gated (DAEMON)
   - `ps` / `logs` / `attach` / `kill` / `--bg` — feature-gated (BG_SESSIONS)
   - `new` / `list` / `reply` — template job commands
   - `environment-runner` / `self-hosted-runner` — BYOC runner
   - `--tmux` + `--worktree` combination
   - Default path: loads `main.tsx` and starts the full CLI
2. **`src/main.tsx`** (~5.7k lines) — Commander.js CLI definition. Registers many subcommands: `mcp` (serve/add/remove/list...), `server`, `ssh`, `open`, `auth`, `plugin`, `agents`, `auto-mode`, `doctor`, `update`, etc. The main `.action()` handler is responsible for permissions, MCP, session resume, and dispatching to REPL/headless mode.
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog).

### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- **7 providers**: `firstParty` (Anthropic direct), `bedrock` (AWS), `vertex` (Google Cloud), `foundry`, `openai`, `gemini`, `grok` (xAI).
- Provider selection is in `src/utils/model/providers.ts`. Priority: `modelType` parameter > environment variable > default `firstParty`.

### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; tools are imported from the `@claude-code-best/builtin-tools` package. Some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/constants/tools.ts`** — The `CORE_TOOLS` allowlist constant (38 core tool names), used by the allowlist-based `isDeferredTool` check.
- **`packages/builtin-tools/src/tools/`** — About 60 tool directories (including shared/testing helper directories), exported through the `@claude-code-best/builtin-tools` package. Main categories:
  - **File operations**: FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool
  - **Shell/execution**: BashTool, PowerShellTool, REPLTool
  - **Agent system**: AgentTool, TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool
  - **Planning**: EnterPlanModeTool, ExitPlanModeV2Tool, VerifyPlanExecutionTool
  - **Web/MCP**: WebFetchTool, WebSearchTool, MCPTool, McpAuthTool
  - **Scheduling**: CronCreateTool, CronDeleteTool, CronListTool
  - **Tool discovery**: SearchExtraToolsTool, ExecuteExtraTool, SyntheticOutput (CORE_TOOLS, used for on-demand loading of deferred tools)
  - **Other**: LSPTool, ConfigTool, SkillTool, EnterWorktreeTool, ExitWorktreeTool, etc.
- **`src/tools/shared/`** / **`packages/builtin-tools/src/tools/shared/`** — Shared tool helper functions.
- **`src/services/searchExtraTools/`** — TF-IDF tool index module (`toolIndex.ts`) that provides semantic search for deferred tools. It reuses the TF-IDF functions from `localSearch.ts` (`computeWeightedTf`, `computeIdf` and `cosineSimilarity` are exported). When changing those functions, also check the tool index tests. `extractQueryFromMessages` in `prefetch.ts` reuses the same-named export from `skillSearch/prefetch.ts`; when changing that function in skill prefetch, also check the tool prefetch behavior. Tool prefetch uses its own `discoveredToolsThisSession` Set, independent of the dedup set used by skill prefetch.

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`packages/@ant/ink/`** — Custom Ink framework (forked/internal), containing components, core, hooks, keybindings, theme and utils. Note: it is not `src/ink/`.
- **Legacy console compatibility mode** — `packages/@ant/ink/src/core/legacyConsole.ts`: enabled automatically when a Windows build < 17763 is detected (old systems without ConPTY, e.g. 1709/LTSC machines on corporate networks); the render loop in `log-update.ts` replaces the incremental diff with one full redraw about every second (`LEGACY_CONSOLE_RESET_MS`), which self-heals the cursor-drift garbled output of the old conhost. `CLAUDE_CODE_LEGACY_CONSOLE=1`/`=0` forces it on/off. Other environments never take this path.
- **`src/components/`** — About 150 component directories/files, rendered in the terminal Ink environment. Key components:
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics)
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering
  - `PromptInput/` — User input handling
  - `permissions/` — Tool permission approval UI
  - `design-system/` — Reusable UI components (Dialog, FuzzyPicker, ProgressBar, ThemeProvider, etc.)
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/AppStateStore.ts`** — Default state and store factory.
- **`src/state/store.ts`** — Zustand-style store for AppState (`createStore`).
- **`src/state/selectors.ts`** — State selectors.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts, model overrides, client type, permission mode).

### Workspace Packages

| Package | Description |
|---------|-------------|
| `packages/@ant/ink/` | Forked Ink framework (components, hooks, keybindings, theme) |
| `packages/@ant/computer-use-mcp/` | Computer Use MCP server (screenshots / keyboard & mouse / clipboard / app management) |
| `packages/@ant/computer-use-input/` | Keyboard & mouse simulation (dispatcher + darwin/win32/linux backends) |
| `packages/@ant/computer-use-swift/` | Screenshots + app management (dispatcher + per-platform backends) |
| `packages/@ant/claude-for-chrome-mcp/` | Chrome browser control (enabled via `--chrome`) |
| `packages/@ant/model-provider/` | Model provider abstraction layer |
| `packages/builtin-tools/` | Built-in tool set (about 60 tool implementations, exported via `@claude-code-best/builtin-tools`) |
| `packages/agent-tools/` | Agent tool set |
| `packages/workflow-engine/` | Workflow engine (runs deterministic JS workflow scripts; port-adapter based) |
| `packages/acp-link/` | ACP proxy server (WebSocket → ACP agent bridge) |
| `packages/mcp-client/` | MCP client library |
| `packages/remote-control-server/` | Self-hosted Remote Control Server (Docker deployment, with Web UI) — the Web UI is built with React + Vite + Radix UI and supports ACP agent connections |
| `packages/cloud-artifacts/` | Standalone Cloudflare Worker + R2 service: POST `/upload` uploads HTML and returns a hash URL, GET `/<7d\|30d>/<id>.html` is read through the Worker; an R2 lifecycle rule expires objects after 7/30 days |
| `packages/audio-capture-napi/` | Native audio capture (restored) |
| `packages/color-diff-napi/` | Color difference computation (full implementation, 11 tests) |
| `packages/image-processor-napi/` | Image processing (restored) |
| `packages/modifiers-napi/` | Keyboard modifier detection (macOS FFI implementation) |
| `packages/url-handler-napi/` | URL scheme handling (environment variables + CLI argument reading) |

Helper directories (no package.json, not workspace packages): `langfuse-dashboard` (Langfuse dashboard), `shared-web-ui` (shared Web UI components), `highlight-code` (code highlighting), `claude-pencil` (editor), `vscode-ide-bridge` (VS Code bridge).

### Bridge / Remote Control

- **`src/bridge/`** — Remote Control / Bridge mode. Feature-gated by `BRIDGE_MODE`. Includes the bridge API, session management, JWT authentication, message transport, permission callbacks, etc. Entry: `bridgeMain.ts`.
- **`packages/remote-control-server/`** — Self-hosted RCS with Docker deployment support and a Web UI control panel (React 19 + Vite + Radix UI). Supports ACP agents connecting through acp-link (ACP WebSocket handler, relay handler, SSE event stream). Started with `bun run rcs`.
- CLI fast paths: `claude remote-control` / `claude rc` / `claude bridge`.
- See `docs/features/remote-control-self-hosting.md` for details.

### HTML Artifact Hosting

- **`packages/cloud-artifacts/`** — A standalone Cloudflare Worker + R2 service, positioned like `remote-control-server/` as a "separately deployed service", and **not imported by the main CLI**. The Worker handles `POST /upload` (Bearer token auth + text/html validation + 10MB limit + ttl ∈ {7,30}) and `GET /<7d|30d>/<id>.html` (read from R2 + `Cache-Control: max-age=86400`). R2 implements TTL with a prefix + lifecycle rule (`7d/` expires after 7 days, `30d/` after 30 days); the Worker takes no part in expiry. The ID defaults to `nanoid(21)` (126 bits of entropy), and a custom ID can be given via `?hash=` (overwrite semantics: first delete the old key under the 7d/30d prefixes, then write the new key). The Worker uses the global `Env` type generated by `wrangler types` (`worker-configuration.d.ts`, gitignored) and does not depend on `@cloudflare/workers-types`. Deploy by initializing with `npm create cloudflare@latest`, then `bun run setup` (creates the bucket + lifecycle + secret) and `bun run deploy`. Set `PUBLIC_URL` in `wrangler.toml` to the public origin; if you put an edge proxy in front, note that it may flatten HTTP status codes to 200 (the `{error}` field in the body is preserved). See `packages/cloud-artifacts/README.md`.

### ACP Protocol (Agent Client Protocol)

- **`src/services/acp/`** — ACP agent implementation, including `agent.ts` (AcpAgent class), `bridge.ts` (Claude Code ↔ ACP bridge), `permissions.ts` (permission handling) and `entry.ts` (entry point).
- **`packages/acp-link/`** — ACP proxy server that bridges WebSocket clients to the ACP agent. Provides the `acp-link` CLI command, supports custom port/HTTPS/auth/session management, RCS integration (REST registration + WS identify two-step flow), and permission-mode passthrough (fallback: client value > config > `ACP_PERMISSION_MODE` environment variable).
- ACP permission pipeline improvements: `createAcpCanUseTool` unifies the permission pipeline, `applySessionMode` syncs modes, and `bypassPermissions` availability detection (non-root / sandbox environments).
- ACP Plan visualization supports `session/update plan` messages (PlanView component with progress bar / status icons / priority tags).

### Daemon Mode

- **`src/daemon/`** — Daemon mode (long-running supervisor). Feature-gated by `DAEMON`. Contains `main.ts` (entry) and `workerRegistry.ts` (worker management).

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

### Feature Flag System

Feature flags control which functionality is enabled at runtime. Code always imports them with `import { feature } from 'bun:bundle'` and calls `feature('FLAG_NAME')`, which returns a `boolean`.

**How to enable**: environment variable `FEATURE_<FLAG_NAME>=1`. For example `FEATURE_BUDDY=1 bun run dev`.

**Build default features** (65+, see `DEFAULT_BUILD_FEATURES` in `build.ts`):
- Basics: `BUDDY`, `TRANSCRIPT_CLASSIFIER`, `BRIDGE_MODE`, `AGENT_TRIGGERS_REMOTE`, `CHICAGO_MCP`, `VOICE_MODE`
- Stats/cache: `SHOT_STATS`, `PROMPT_CACHE_BREAK_DETECTION`, `TOKEN_BUDGET`
- P0 local: `AGENT_TRIGGERS`, `ULTRATHINK`, `BUILTIN_EXPLORE_PLAN_AGENTS`, `LODESTONE`
- P1 API-dependent: `EXTRACT_MEMORIES`, `VERIFICATION_AGENT`, `KAIROS_BRIEF`, `AWAY_SUMMARY`, `ULTRAPLAN`
- P2: `DAEMON`, `ACP`
- Workflows: `WORKFLOW_SCRIPTS`, `HISTORY_SNIP`, `MONITOR_TOOL`, `KAIROS`
- Multi-worker: `COORDINATOR_MODE`, `BG_SESSIONS`, `TEMPLATES`
- Connectors: `CONNECTOR_TEXT`, `COMMIT_ATTRIBUTION`, `DIRECT_CONNECT`
- Experimental: `EXPERIMENTAL_SKILL_SEARCH`, `EXPERIMENTAL_SEARCH_EXTRA_TOOLS`
- Modes: `POOR`, `SSH_REMOTE`
- Disabled: `CONTEXT_COLLAPSE`, `FORK_SUBAGENT`, `UDS_INBOX`, `LAN_PIPES`, `REVIEW_ARTIFACT`, `TEAMMEM`, `SKILL_LEARNING`

**Dev mode default**: all enabled (see `scripts/dev.ts`).

**Type declaration**: the signature of the `feature` function of the `bun:bundle` module is declared in `src/types/internal-modules.d.ts`.

**The right way to add a feature**: keep the standard `import { feature } from 'bun:bundle'` + `feature('FLAG_NAME')` pattern and control it at runtime through environment variables or configuration; do not bypass the feature flag with a direct import.

### Multi-API Compatibility Layer

All compatibility layers use the stream-adapter pattern: they convert third-party API formats into the internal Anthropic format, leaving downstream code unchanged. Configure them via the `/login` command.

#### OpenAI compatibility layer

Enabled with `CLAUDE_CODE_USE_OPENAI=1`. Supports any endpoint speaking the OpenAI Chat Completions protocol, such as Ollama/DeepSeek/vLLM. Includes DeepSeek thinking mode support.

- **`src/services/api/openai/`** — client, message/tool conversion, stream adapter, model mapping
- Key environment variables: `CLAUDE_CODE_USE_OPENAI`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`

#### Gemini compatibility layer

Enabled with `CLAUDE_CODE_USE_GEMINI=1`. Uses its own set of environment variables.

- **`src/services/api/gemini/`** — client, model mapping, type definitions
- Key environment variables: `GEMINI_API_KEY` (required), `GEMINI_MODEL` (direct override), `GEMINI_DEFAULT_SONNET_MODEL`/`GEMINI_DEFAULT_OPUS_MODEL` (mapping by capability)
- Model mapping priority: `GEMINI_MODEL` > `GEMINI_DEFAULT_*_MODEL` > `ANTHROPIC_DEFAULT_*_MODEL` (deprecated) > returned as-is

#### Grok compatibility layer

Enabled with `CLAUDE_CODE_USE_GROK=1`. Custom model mapping supporting the xAI Grok API.

- **`src/services/api/grok/`** — client, model mapping

See the docs for each compatibility layer for details.

### Budget Mode ("poor mode")

- Toggled with the `/poor` command and persisted to `settings.json`.
- When enabled it skips `extract_memories`, `prompt_suggestion` and `verification_agent`, significantly reducing token consumption.
- Implemented in `src/commands/poor/poorMode.ts`.

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Restored — macOS + Windows + Linux (backend completeness varies) |
| `*-napi` packages | All restored/implemented: `audio-capture-napi` and `image-processor-napi` restored; `color-diff-napi` complete; `modifiers-napi` (macOS FFI); `url-handler-napi` (environment variables + CLI) |
| Voice Mode | Restored — push-to-talk voice input (requires Anthropic OAuth) |
| OpenAI/Gemini/Grok compatibility layers | Restored |
| Remote Control Server | Restored — self-hosted RCS + Web UI |
| `packages/shell/`, `packages/swarm/`, `packages/mcp-server/`, `packages/cc-knowledge/`, `packages/weixin/` | Removed — functionality merged or deprecated |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / LSP Server | Restored — Magic Docs auto-update + LSP server manager |
| Plugins / Marketplace | Restored — plugin install/uninstall/enable/disable + marketplace browsing |
| MCP OAuth | Simplified |

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Testing

- **Framework**: `bun:test` (built-in assertions + mock)
- **Unit tests**: colocated in `src/**/__tests__/`, file name `<module>.test.ts`
- **Integration tests**: `tests/integration/` — 6 files (cli-arguments, context-build, message-pipeline, tool-chain, autonomy-lifecycle-user-flow, dependency-overrides)
- **Shared mocks/fixtures**: `tests/mocks/` (api-responses, file-system, fixtures/)
- **Naming**: `describe("functionName")` + `test("behavior description")`, in English
- **Package tests**: packages under `packages/` also have their own tests (e.g. 11 tests for `color-diff-napi`)

### Mock Usage Rules

**Only mock dependency chains that have side effects; do not mock pure functions or pure-data modules.**

The root cause of forced mocking: `log.ts` / `debug.ts` → `bootstrap/state.ts` (module-level `realpathSync` / `randomUUID` side effects). Modules that must be mocked: `log.ts`, `debug.ts`, `bun:bundle`, `settings/settings.js`, `config.ts`, `auth.ts`, third-party network libraries.

**`log.ts` and `debug.ts` use shared mocks** (`tests/mocks/log.ts` / `tests/mocks/debug.ts`); do not inline mock definitions in test files. Usage:

```ts
import { logMock } from "../../../tests/mocks/log";
mock.module("src/utils/log.ts", logMock);

import { debugMock } from "../../../../tests/mocks/debug";
mock.module("src/utils/debug.ts", debugMock);
```

When the exports of a source file change, only the matching file under `tests/mocks/` needs updating; there is no need to modify tests one by one.

Do not mock: pure-function modules (`errors.ts`, `stringUtils.js`), modules whose mock value equals the real implementation, and modules whose mock path does not match the actual import.

Path rule: always use the `.ts` extension + the `src/*` alias path, and never double-mock the same module.

#### Cross-file mock pollution (process-global `mock.module`)

**Bun's `mock.module` is process-global (last-write-wins), not isolated per file.** A `mock.module` in one test file pollutes the `require`/`import` of all other test files in the same process.

**Key facts (verified on Bun 1.x):**
- The execution order of test files is **not strictly alphabetical**; do not assume file A always runs before file B.
- `mock.module` called inside `beforeAll` is **not hoisted**, but it still pollutes files loaded afterwards.
- `require()` and `import()` share the same module registry, and `mock.module` takes effect for both.
- Once a module is replaced by some file's `mock.module`, every later `require`/`import` in the same process returns the mock value, even if the caller uses a different specifier path.

**Core rule: do not mock the upper-level business module of the module under test.**

Wrong (pollutes the `api.test.ts` in the same directory):
```ts
// launchSchedule.test.ts — mocks the source API module directly ❌
mock.module('src/commands/schedule/triggersApi.js', () => ({
  listTriggers: listTriggersMock,
  // ...
}))
```

Right (mock the underlying HTTP layer, do not pollute business modules): follow the pattern in `launchSkillStore.test.ts` and `launchVault.test.ts`.
```ts
// launchSchedule.test.ts — mock axios instead of triggersApi ✅
import { setupAxiosMock } from '../../../../tests/mocks/axios.js'

const axiosHandle = setupAxiosMock()
axiosHandle.stubs.get = axiosGetMock
axiosHandle.stubs.post = axiosPostMock

beforeAll(() => { axiosHandle.useStubs = true })
afterAll(() => { axiosHandle.useStubs = false })
```

**Criterion:** if a directory has both `launch*.test.ts` (integration tests) and `api.test.ts` (regression tests), `launch*.test.ts` must mock axios rather than the source API module. `api.test.ts` needs to test the HTTP method/URL/error handling of the real API module, which cannot be tested once it is mocked.

**How to track down mock pollution:**
1. Run the suspect file alone to confirm it passes: `bun test path/to/suspect.test.ts`
2. Run it together with the other files in the same directory to locate the polluter: `bun test path/to/__tests__/`
3. Add `console.error('[file] milestone')` in both files to trace the real execution order
4. Check whether the `mock.module` specifier resolves to the same module as the `require`/`import` paths of the other tests in the directory

### Type Checking

The project uses TypeScript strict mode, and **tsc must report zero errors**. Run after every change:

```bash
bun run precheck
```

**Type conventions**:
- No `as any` in production code; mock data in test files may use `as any`
- For type mismatches, prefer the double assertion `as unknown as SpecificType`, or add an interface
- Use `Record<string, unknown>` instead of `any` for objects of unknown structure
- Narrow union types with type guards; do not force-cast
- `msg.request` property access: `const req = msg.request as Record<string, unknown>`
- Ink `color` prop: use `as keyof Theme` instead of `as any`

## Working with This Codebase

- **precheck must pass** — `bun run precheck` (typecheck + lint fix + test) must have zero errors; no change may introduce new type/lint/test errors.
- **Feature flags** — all off by default (`feature()` returns `false`). Dev/build each have their own default-enabled lists. Do not redefine the `feature` function in `cli.tsx`.
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` is a Bun built-in module resolved by the runtime/bundler. Do not replace it with a custom function. **`feature()` may only be used directly in the condition position of an `if` statement or a ternary expression** (a Bun compiler limitation); it cannot be assigned to a variable, placed in an arrow function body, or used as part of an `&&` chain. Right: `if (feature('X')) {}` or `feature('X') ? a : b`.
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
- **MACRO defines** — managed centrally in `scripts/defines.ts`. Dev mode injects them via `bun -d`, and the build via `Bun.build({ define })`. To change constants such as the version number, edit only this file.
- **Build output is Node.js compatible** — `build.ts` post-processes `import.meta.require` automatically, so the output can run directly with `node dist/cli.js`.
- **Biome configuration** — 42 lint rules are turned off because of the decompiled code; only the `recommended` baseline is kept. Formatting covers the whole project (`src/`, `scripts/`, `packages/`, including `packages/@ant/`). `.tsx` files use a 120-column width + mandatory semicolons; other files use an 80-column width + semicolons as needed. JSON formatting is enabled. `.editorconfig` is aligned with the Biome config (2-space indent). After changing any code, run `bun run precheck` to confirm there are no type/lint/format/test problems; the pre-commit hook automatically blocks non-compliant commits.
- **Resolving tsc vs. Biome conflicts** — when tsc requires a declared property (used via assignment) but biome reports `noUnusedPrivateClassMembers` (write-only, never read), suppress the lint warning with `// biome-ignore lint/correctness/noUnusedPrivateClassMembers: <reason>` and keep the type declaration. `biome ci` must report zero warnings.
- **`@ts-expect-error` maintenance** — keep `@ts-expect-error` only when the code below really has a type error. If a type-system update turns the directive into an unused one (TS2578), just remove the comment. Always-false comparisons produced by MACRO substitution (such as `'production' === 'development'`) still need `@ts-expect-error`.
- **The Ink framework lives in `packages/@ant/ink/`** — not in `src/ink/` (that directory does not exist). Ink-related components, hooks and keybindings are all in the packages.
- **Provider priority** — `modelType` parameter > environment variable > default `firstParty`. A new provider must be registered in `src/utils/model/providers.ts`.

## Design Context

The Impeccable design context is kept in `.impeccable.md`. Consult that file when designing Web UI (RCS control panel, docs site, landing page).

### Core design principles

1. **Considered over clever** — every design choice should feel deliberate, not trend-chasing
2. **Warmth through subtlety** — convey warmth through orange-tinted neutrals, airy layouts and friendly copy
3. **Density with clarity** — technical users need information density, but it must not become cluttered
4. **Community voice** — the design should feel made by its users, not by a distant design team
5. **Anthropic's shadow** — follow Anthropic's design instincts: clean layouts, generous spacing, warm color temperature

### Brand colors

- Primary: Claude Orange `#D77757` (terra cotta)
- Secondary: Claude Blue `#5769F7`
- Dark mode uses warm dark surfaces (not cold blue-black)

### Target users

Technical teams / enterprises using AI-assisted programming in professional workflows. A friendly open-source community feel, not an enterprise-SaaS style.

### Visual references

Anthropic's own design style — clean, considered, with a warm undertone. Generous whitespace, typography-centered. Avoid common AI-product design clichés (gradient text, glassmorphism, neon colors).

## Owner Rules (always follow)

- **Commits**: one short line, Conventional Commits (`fix: handle empty config`). No `Co-Authored-By` trailer, no "Generated with Claude Code" line, no session links.
- **Branches**: `<type>/<short-kebab-topic>`, e.g. `feat/model-picker`, `fix/login-check`, `chore/english-docs`. Never auto-generated names like `claude/quirky-gates-xxxx`.
- **PR descriptions**: short summary + test notes. No generated-by footer.
- Run `bun run precheck` before committing.
