# COORDINATOR_MODE: multi-agent orchestration

> Feature Flag: `FEATURE_COORDINATOR_MODE=1` + environment variable `CLAUDE_CODE_COORDINATOR_MODE=1`
> Implementation status: the coordinator is fully usable; the worker agent is a generic AgentTool worker
> References: 32

## 1. Overview

COORDINATOR_MODE turns the CLI into a "coordinator". The coordinator does not touch files itself; it dispatches tasks to several workers through AgentTool and they run in parallel. It suits splitting large tasks, parallel research, and separating implementation from verification.

### Core constraints

- The coordinator can only use: `Agent` (dispatch workers), `SendMessage` (continue a worker) and `TaskStop` (stop a worker)
- Workers can use all the standard tools (Bash, Read, Edit, etc.) plus MCP tools and the Skill tool
- Every coordinator message is meant for the user; worker results arrive as `<task-notification>` XML

## 2. User interaction

### Enabling

```bash
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev
```

Both the feature flag and the environment variable must be set. `CLAUDE_CODE_COORDINATOR_MODE` can switch automatically when a session is resumed (`matchSessionMode`).

### Typical workflow

```
User: "Fix the null pointer in the auth module"

Coordinator:
  1. Dispatches two workers in parallel:
     - Agent({ description: "Investigate auth bug", prompt: "..." })
     - Agent({ description: "Research auth tests", prompt: "..." })

  2. Receives <task-notification>:
     - Worker A: "Found the null pointer at validate.ts:42"
     - Worker B: "Test coverage..."

  3. Synthesizes the findings and continues Worker A:
     - SendMessage({ to: "agent-a1b", message: "Fix validate.ts:42..." })

  4. Receives the fix and dispatches verification:
     - Agent({ description: "Verify the fix", prompt: "..." })
```

## 3. Architecture

### 3.1 Mode detection

File: `src/coordinator/coordinatorMode.ts:36-41`

```ts
export function isCoordinatorMode(): boolean {
  return feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
}
```

### 3.2 Session mode restoration

When an old session is resumed, `matchSessionMode(sessionMode)` checks the stored mode and automatically flips the environment variable if the current one disagrees with the stored one. This prevents resuming a coordinator session in normal mode (or the reverse).

### 3.3 Worker toolset

`getCoordinatorUserContext()` tells the coordinator which tools the workers have:

- **Standard mode**: `ASYNC_AGENT_ALLOWED_TOOLS` excludes internal tools (TeamCreate, TeamDelete, SendMessage, SyntheticOutput)
- **Simple mode** (`CLAUDE_CODE_SIMPLE=1`): only Bash, Read, Edit
- **MCP tools**: lists the names of connected MCP servers
- **Scratchpad**: if the GrowthBook flag `tengu_scratch` is on, provides a scratchpad directory shared across workers

### 3.4 System prompt

File: `src/coordinator/coordinatorMode.ts:111-369`

The coordinator system prompt (`getCoordinatorSystemPrompt()`) is about 370 lines and contains:

| Section | Content |
|------|------|
| 1. Your Role | Definition of the coordinator's responsibilities |
| 2. Your Tools | How to use Agent/SendMessage/TaskStop |
| 3. Workers | Worker capabilities and limits |
| 4. Task Workflow | The Research → Synthesis → Implementation → Verification flow |
| 5. Writing Worker Prompts | A guide to writing self-contained prompts, with good and bad examples |
| 6. Example Session | A full example conversation |

### 3.5 Worker agent

File: `src/coordinator/workerAgent.ts`

Currently a stub. Workers actually use the generic AgentTool `worker` subagent_type.

### 3.6 Data flow

```
User message
      │
      ▼
Coordinator REPL (restricted toolset)
      │
      ├──→ Agent({ subagent_type: "worker", prompt: "..." })
      │         │
      │         ▼
      │    Worker agent (full toolset)
      │    ├── Runs the task (Bash/Read/Edit/...)
      │    └── Returns <task-notification>
      │
      ├──→ SendMessage({ to: "agent-id", message: "..." })
      │         │
      │         ▼
      │    Continues an existing worker
      │
      └──→ TaskStop({ task_id: "agent-id" })
                │
                ▼
           Stops a running worker
```

## 4. Key design decisions

1. **Two switches**: the feature flag controls whether the code is available, and the environment variable controls actual activation. This allows compiling it in without enabling it by default
2. **Restricted coordinator**: it can only use Agent/SendMessage/TaskStop, so it stays focused on dispatching rather than executing
3. **Workers cannot see the coordinator conversation**: each worker prompt must be self-contained (all the context it needs)
4. **Parallel first**: the system prompt stresses "Parallelism is your superpower" and encourages dispatching independent tasks in parallel
5. **Synthesize, don't forward**: the coordinator must understand the worker findings and then write concrete implementation instructions. Lazy delegation like "based on your findings" is forbidden
6. **Optional shared scratchpad**: a shared directory gated by GrowthBook lets workers persist knowledge between them

## 5. Usage

```bash
# Basic enable
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev

# With Fork Subagent
FEATURE_COORDINATOR_MODE=1 FEATURE_FORK_SUBAGENT=1 \
CLAUDE_CODE_COORDINATOR_MODE=1 bun run dev

# Simple mode (workers only have Bash/Read/Edit)
FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 \
CLAUDE_CODE_SIMPLE=1 bun run dev
```

## 6. File index

| File | Lines | Responsibility |
|------|------|------|
| `src/coordinator/coordinatorMode.ts` | 370 | Mode detection + system prompt + user context |
| `src/coordinator/workerAgent.ts` | n/a | Worker agent definition (stub) |
| `src/constants/tools.ts` | n/a | `ASYNC_AGENT_ALLOWED_TOOLS` tool allowlist |
