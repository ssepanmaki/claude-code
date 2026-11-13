# PROACTIVE: proactive mode

> Feature Flag: `FEATURE_PROACTIVE=1` (shares functionality with `FEATURE_KAIROS=1`)
> Implementation status: the core loop and SleepTool are in place; some surrounding docs are still being filled in
> References: 37

## 1. Overview

PROACTIVE implements a tick-driven autonomous agent. The CLI keeps working even when the user is not typing: it wakes up on a timer to run tasks, and SleepTool controls the pace. It suits long-running background work (waiting for CI, watching file changes, periodic checks, and so on).

### Relationship with KAIROS

Every code check is `feature('PROACTIVE') || feature('KAIROS')`, so:
- `FEATURE_PROACTIVE=1` alone gives the proactive capability
- `FEATURE_KAIROS=1` alone also gives the proactive capability
- Both together have the same effect (no duplication)

## 2. Architecture

### 2.1 Module status

| Module | File | Status | Notes |
|------|------|------|------|
| Core logic | `src/proactive/index.ts` | **Implemented** | `activateProactive()`, `deactivateProactive()`, `pause/resume`, `nextTickAt` scheduling state |
| SleepTool prompt | `src/tools/SleepTool/prompt.ts` | **Complete** | Tool prompt definition (tool name: `Sleep`) |
| Command registration | `src/commands.ts:62-65` | **Wired** | Dynamically loads `./commands/proactive.js` |
| Tool registration | `src/tools.ts:26-28` | **Wired** | SleepTool is loaded dynamically |
| REPL integration | `src/screens/REPL.tsx` | **Implemented** | Tick driving, standby/sleeping states, footer and bridge automation metadata reporting |
| System prompt | `src/constants/prompts.ts:864-918` | **Complete** | Autonomous-work instructions (a detailed prompt of about 55 lines) |
| Remote-control state mirror | `src/utils/sessionState.ts` | **Implemented** | Exposes `automation_state` metadata to remote-control/CCR |

### 2.2 System prompt content

The autonomous-work instructions injected by `getProactiveSection()` include:

| Section | Content |
|------|------|
| Tick driving | The `<tick_tag>` prompt keeps it alive and carries the user's local time |
| Pacing | SleepTool controls the wait interval; the prompt cache expires after 5 minutes |
| No-op rule | When there is nothing to do it **must** call Sleep and must not output "still waiting" |
| First wake-up | A short greeting, then wait for direction (no proactive exploration) |
| Later wake-ups | Look for useful work: investigate, verify, check (without spamming the user) |
| Bias toward action | Read files, search code, commit, without asking |
| Terminal focus | The `terminalFocus` field adjusts how autonomous it is |

### 2.3 Data flow

```
activateProactive()
      │
      ▼
Tick scheduler starts
      │
      ├── Periodically generates <tick_tag> messages
      │   ├── Includes the user's current local time
      │   └── Injected into the conversation stream (sessionStorage)
      │
      ▼
Model handles the tick
      │
      ├── Work to do → runs tools → may Sleep again
      └── Nothing to do → must call SleepTool
      │
      ▼
SleepTool waits
      │
      ├── User adds new work / a command is queued → wakes immediately
      ├── proactive is turned off → interrupted immediately
      └── On entering sleep, reports `automation_state = sleeping` to remote surfaces
      │
      ▼
Next tick arrives
```

## 3. Current behavior notes

- `standby`: proactive is on, no turn is running, and the next tick is scheduled.
- `sleeping`: the model explicitly called `SleepTool` and entered a wait window.
- remote-control/CCR receives these two states through `external_metadata.automation_state`, used for the Autopilot status display in the Web UI.
- `SleepTool` is no longer a pure timer; it wakes early when new work appears in the shared command queue.

## 4. Key design decisions

1. **Tick-driven**: the model controls its own wake-up frequency through SleepTool; it is not driven by external event pushes
2. **No-op must Sleep**: prevents empty "still waiting" messages from wasting turns and tokens
3. **Prompt cache aware**: the SleepTool prompt mentions the 5-minute cache expiry and suggests balancing the wait time
4. **Terminal focus aware**: the model adjusts how autonomous it is based on whether the user is looking at the terminal

## 5. Usage

```bash
# Enable proactive alone
FEATURE_PROACTIVE=1 bun run dev

# Enable indirectly through KAIROS
FEATURE_KAIROS=1 bun run dev

# Combined
FEATURE_PROACTIVE=1 FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 bun run dev
```

## 6. File index

| File | Responsibility |
|------|------|
| `src/proactive/index.ts` | Core logic and next-tick state |
| `src/tools/SleepTool/prompt.ts` | SleepTool prompt |
| `src/tools/SleepTool/SleepTool.ts` | Sleep/wake execution logic |
| `src/constants/prompts.ts:864-918` | Autonomous-work system prompt |
| `src/screens/REPL.tsx` | REPL tick integration and automation state reporting |
| `src/utils/sessionStorage.ts:4892-4912` | Tick message injection |
| `src/utils/sessionState.ts` | bridge/CCR metadata mirror |
| `src/components/PromptInput/PromptInputFooterLeftSide.tsx` | Footer UI state |
