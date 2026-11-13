# FORK_SUBAGENT — Context-Inheriting Sub-Agents

> Feature Flag: `FEATURE_FORK_SUBAGENT=1`
> Status: fully working
> References: 4

## 1. Overview

FORK_SUBAGENT lets AgentTool spawn "fork sub-agents" that inherit the parent's full conversation context. A sub-agent sees all of the parent's history, tool set and system prompt, and shares the parent's API request prefix to maximize prompt cache hits.

### Key Benefits

- **Maximal prompt cache hits**: parallel forks share the same API request prefix; only the final directive text block differs
- **Complete context**: the sub-agent inherits the parent's entire conversation history (including thinking config)
- **Permission bubbling**: permission prompts from the sub-agent surface in the parent's terminal
- **Worktree isolation**: supports git worktree isolation so the sub-agent works on its own branch

## 2. User Interaction

### How It Triggers

When `FORK_SUBAGENT` is enabled, an AgentTool call without `subagent_type` takes the fork path automatically:

```
// Fork path (inherits context)
Agent({ prompt: "Fix this bug" })  // no subagent_type

// Regular agent path (fresh context)
Agent({ subagent_type: "general-purpose", prompt: "..." })
```

### The /fork Command

A `/fork` slash command is registered (currently a stub). When FORK_SUBAGENT is on, the `/branch` command loses its `fork` alias to avoid a conflict.

## 3. Implementation

### 3.1 Gating and Mutual Exclusion

File: `packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts:32-39`

```ts
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false   // Coordinator has its own delegation model
    if (getIsNonInteractiveSession()) return false  // disabled in pipe/SDK mode
    return true
  }
  return false
}
```

### 3.2 FORK_AGENT Definition

```ts
export const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],              // wildcard: use the parent's full tool set
  maxTurns: 200,
  model: 'inherit',          // inherit the parent's model
  permissionMode: 'bubble',  // permissions bubble up to the parent terminal
  getSystemPrompt: () => '', // unused: the parent's rendered prompt is passed through directly
}
```

### 3.3 Core Call Flow

```
AgentTool.call({ prompt, name })
      │
      ▼
isForkSubagentEnabled() && !subagent_type?
      │
      ├── No → regular agent path
      │
      └── Yes → fork path
            │
            ▼
      Recursion guard checks
      ├── querySource === 'agent:builtin:fork' → reject
      └── isInForkChild(messages) → reject
            │
            ▼
      Get the parent's system prompt
      ├── toolUseContext.renderedSystemPrompt (preferred)
      └── buildEffectiveSystemPrompt (fallback)
            │
            ▼
      buildForkedMessages(prompt, assistantMessage)
      ├── clone the parent's assistant message
      ├── generate placeholder tool_results
      └── append the directive text block
            │
            ▼
      [optional] buildWorktreeNotice()
            │
            ▼
      runAgent({
        useExactTools: true,
        override.systemPrompt: parent's,
        forkContextMessages: parent's messages,
        availableTools: parent's tools,
      })
```

### 3.4 Message Construction: buildForkedMessages

File: `packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts:107-169`

The resulting message structure:

```
[
  ...history (filterIncompleteToolCalls),  // parent's full history
  assistant(all tool_use blocks),           // parent's current-turn assistant message
  user(
    placeholder tool_result × N +           // identical placeholder text
    <fork-boilerplate> directive            // differs per fork
  )
]
```

**All forks use the same placeholder text**: `"Fork started — processing in background"`. This keeps the API request prefix of parallel forks identical, maximizing prompt cache hits.

### 3.5 Recursion Guard

Two checks prevent nested forks:

1. **querySource check**: `toolUseContext.options.querySource === 'agent:builtin:fork'`. It is set on `context.options`, which survives autocompact (autocompact rewrites messages but not options)
2. **Message scan**: `isInForkChild()` scans the message history for the `<fork-boilerplate>` tag

### 3.6 Worktree Isolation Notice

When fork and worktree are combined, a notice is appended to tell the sub-agent:

> "You inherited the parent agent's conversation context in `{parentCwd}`, but you are operating in a separate git worktree `{worktreeCwd}`. Paths need to be translated, and files should be re-read before editing."

### 3.7 Forced Async

When `isForkSubagentEnabled()` is true, every agent launch is forced to be asynchronous. The `run_in_background` parameter is removed from the schema. All interaction goes through `<task-notification>` XML messages.

## 4. Prompt Cache Optimization

This is the main optimization goal of the whole fork design:

| Optimization | Implementation |
|--------------|----------------|
| **Same system prompt** | Passes `renderedSystemPrompt` straight through to avoid re-rendering (GrowthBook state may be inconsistent) |
| **Same tool set** | `useExactTools: true` uses the parent's tools directly, skipping `resolveAgentTools` filtering |
| **Same thinking config** | Inherits the parent's thinking config (non-fork agents disable thinking by default) |
| **Same placeholder result** | All forks use the same `FORK_PLACEHOLDER_RESULT` text |
| **ContentReplacementState clone** | Clones the parent's replacement state by default to keep the wire prefix identical |

## 5. Sub-Agent Instructions

`buildChildMessage()` produces instructions wrapped in `<fork-boilerplate>`:

- You are a fork worker, not the main agent
- Do not spawn further sub-agents (execute directly)
- No small talk, no meta commentary
- Use tools directly
- Commit after modifying files and report the commit hash
- Report format: `Scope:` / `Result:` / `Key files:` / `Files changed:` / `Issues:`

## 6. Key Design Decisions

1. **Fork ≠ regular agent**: a fork inherits full context, a regular agent starts from scratch. The choice depends on whether `subagent_type` is present
2. **renderedSystemPrompt pass-through**: avoids calling `getSystemPrompt()` again at fork time. The parent freezes the prompt bytes at the start of the turn
3. **Shared placeholder results**: parallel forks use exactly the same placeholders; only the directive differs
4. **Coordinator exclusion**: fork is disabled in Coordinator mode because the two have incompatible delegation models
5. **Disabled when non-interactive**: disabled in pipe and SDK modes to avoid invisible fork nesting

## 7. Usage

```bash
# Enable the feature
FEATURE_FORK_SUBAGENT=1 bun run dev

# Use it in the REPL (omit subagent_type to take the fork path)
# Agent({ prompt: "Investigate this module's structure" })
# Agent({ prompt: "Implement this feature" })
```

## 8. File Index

| File | Lines | Responsibility |
|------|-------|----------------|
| `packages/builtin-tools/src/tools/AgentTool/forkSubagent.ts` | ~210 | Core definition + message construction + recursion guard |
| `packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx` | — | Fork routing + forced async |
| `packages/builtin-tools/src/tools/AgentTool/prompt.ts` | — | "When to Fork" prompt section |
| `packages/builtin-tools/src/tools/AgentTool/runAgent.ts` | — | useExactTools path |
| `packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts` | — | Fork agent resume |
| `src/constants/xml.ts` | — | XML tag constants |
| `src/utils/forkedAgent.ts` | — | CacheSafeParams + ContentReplacementState cloning |
| `src/commands/fork/index.ts` | — | /fork command (stub) |
