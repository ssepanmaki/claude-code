# ULTRAPLAN — Enhanced planning

> Feature Flag: `FEATURE_ULTRAPLAN=1`
> Implementation status: keyword detection complete, command handling complete, CCR remote session complete
> References: 10

## 1. Overview

When ULTRAPLAN detects the "ultraplan" keyword in user input, it automatically enters an enhanced planning mode. Compared with normal plan mode, ultraplan offers deeper planning and supports both local and remote (CCR) execution.

### Triggers

| Trigger | Behavior |
|---------|----------|
| Typing text that contains "ultraplan" | Automatically redirected to the `/ultraplan` command |
| `/ultraplan` slash command | Runs directly |
| Rainbow highlight | The "ultraplan" keyword in the input box gets a rainbow animation |

## 2. Implementation architecture

### 2.1 Module status

| Module | File | Lines | Status |
|--------|------|-------|--------|
| Command handler | `src/commands/ultraplan.tsx` | 525 | **Complete** |
| CCR session | `src/utils/ultraplan/ccrSession.ts` | 349 | **Complete** |
| Keyword detection | `src/utils/ultraplan/keyword.ts` | 127 | **Complete** |
| Embedded prompt | `src/utils/ultraplan/prompt.txt` | 1 | **Complete** |
| REPL dialogs | `src/screens/REPL.tsx` | — | **Wired** |
| Keyword highlight | `src/components/PromptInput/PromptInput.tsx` | — | **Wired** |

### 2.2 Keyword detection

File: `src/utils/ultraplan/keyword.ts` (127 lines)

`findUltraplanTriggerPositions(text)` filters intelligently:
- Excludes "ultraplan" inside quotes
- Excludes "ultraplan" inside paths (such as `/path/to/ultraplan/`)
- Excludes contexts other than slash commands
- `replaceUltraplanKeyword(text)` cleans up the keyword

### 2.3 CCR remote session

File: `src/utils/ultraplan/ccrSession.ts` (349 lines)

The `ExitPlanModeScanner` class implements a complete event state machine:
- `pollForApprovedExitPlanMode()` — 3-second polling interval
- Timeout handling and retry
- Supports remote (teleport) and local execution

### 2.4 Data flow

```
User types "help me ultraplan a refactor of this module"
         │
         ▼
processUserInput detects "ultraplan"
         │
         ▼
Redirects to the /ultraplan command
         │
         ├── Local execution → EnterPlanMode
         │
         └── Remote execution → teleportToRemote → CCR session
                │
                ▼
         ExitPlanModeScanner polls
                │
                ▼
         The user approves remotely → the result comes back locally
```

## 3. What still needs to be completed

| Module | Description |
|--------|-------------|
| UltraplanChoiceDialog / UltraplanLaunchDialog in `src/screens/REPL.tsx` | Dialog components for the user to choose local/remote execution |
| `src/commands/ultraplan/` | Empty directory; possibly an unmerged subcommand structure |

## 4. Key design decisions

1. **Smart keyword filtering**: excludes "ultraplan" inside quotes and paths to avoid false triggers
2. **Local/remote dual mode**: supports local plan mode and CCR remote sessions
3. **Rainbow highlight feedback**: the "ultraplan" keyword in the input box uses a rainbow animation to signal that it is a special feature
4. **processUserInput integration**: intercepted in the user-input processing pipeline, redirecting seamlessly

## 5. Usage

```bash
# Enable the feature
FEATURE_ULTRAPLAN=1 bun run dev

# Use it in the REPL
# > ultraplan refactor the auth module
# > /ultraplan
```

## 6. File index

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/commands/ultraplan.tsx` | 525 | Slash command handler |
| `src/utils/ultraplan/ccrSession.ts` | 349 | CCR remote session management |
| `src/utils/ultraplan/keyword.ts` | 127 | Keyword detection and replacement |
| `src/utils/ultraplan/prompt.txt` | 1 | Embedded prompt |
| `src/utils/processUserInput/processUserInput.ts:468` | — | Keyword redirect |
| `src/components/PromptInput/PromptInput.tsx` | — | Rainbow highlight |
