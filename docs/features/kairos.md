# KAIROS — Always-On Assistant Mode

> Feature Flag: `FEATURE_KAIROS=1` (plus sub-features)
> Status: core framework complete, some submodules are stubs; proactive/sleep pacing control works
> References: 154 (largest in the codebase)

## 1. Overview

KAIROS turns the Claude Code CLI from a "Q&A tool" into an "always-on assistant". When enabled, the CLI keeps running in the background and supports:

- **Persistent bridge sessions**: sessions are reused across terminal restarts, connected to claude.ai through Anthropic OAuth
- **Background task execution**: keeps working while the user is away from the terminal (together with the PROACTIVE feature)
- **Mobile push notifications**: pushes when a task finishes or input is needed (with `KAIROS_PUSH_NOTIFICATION`)
- **Daily memory log**: automatically records and reviews work (with `KAIROS_DREAM`)
- **External channel messages**: Slack/Discord/Telegram messages forwarded to the CLI (with `KAIROS_CHANNELS`)
- **Structured Brief output**: emits structured messages through BriefTool (with `KAIROS_BRIEF`)

### Sub-Feature Dependencies

```
KAIROS (main switch)
├── KAIROS_BRIEF (BriefTool, structured output)
├── KAIROS_CHANNELS (external channel messages)
├── KAIROS_PUSH_NOTIFICATION (mobile push)
├── KAIROS_GITHUB_WEBHOOKS (GitHub PR webhooks)
└── KAIROS_DREAM (memory distillation)
```

**Note**: PROACTIVE is tightly bound to KAIROS. Every code check is `feature('PROACTIVE') || feature('KAIROS')`, so enabling KAIROS automatically grants proactive capability.

## 2. System Prompt

KAIROS injects two main sections into the system prompt:

### 2.1 Brief Section (`getBriefSection`)

File: `src/constants/prompts.ts:847-858`

Injected when `feature('KAIROS') || feature('KAIROS_BRIEF')`. It carries the instructions for structured message output through the Brief tool (`SendUserMessage`). The `/brief` toggle and the `--brief` flag only control display filtering and do not affect model behavior.

### 2.2 Proactive/Autonomous Work Section (`getProactiveSection`)

File: `src/constants/prompts.ts:864-918`

Injected when `feature('PROACTIVE') || feature('KAIROS')` and `isProactiveActive()`. Core behavioral instructions:

- **Tick-driven**: stays alive through `<tick_tag>` prompts, each tick carrying the user's current local time
- **Pacing control**: uses `SleepTool` to control the wait interval (the prompt cache expires after 5 minutes)
- **Must Sleep when idle**: emitting "still waiting"-style text is forbidden (it wastes turns and tokens)
- **Bias toward action**: reading files, searching code, modifying files and committing all happen without asking
- **Terminal focus awareness**: the `terminalFocus` field indicates whether the user is looking at the terminal
  - Unfocused → act with high autonomy
  - Focused → be more collaborative and present options

## 3. Architecture

### 3.1 Core Modules

| Module | File | Status | Responsibility |
|--------|------|--------|----------------|
| Assistant entry | `src/assistant/index.ts` | Stub | `isAssistantMode()`, `initializeAssistantTeam()` |
| Session discovery | `src/assistant/sessionDiscovery.ts` | Stub | Discovers available bridge sessions |
| Session history | `src/assistant/sessionHistory.ts` | Stub | Persists session history |
| Gate control | `src/assistant/gate.ts` | Stub | GrowthBook gate checks |
| Session chooser | `src/assistant/AssistantSessionChooser.ts` | Stub | UI for choosing a session |
| BriefTool | `src/tools/BriefTool/` | Stub | Structured message output tool |
| Channel Notification | `src/services/mcp/channelNotification.ts` | Stub | External channel message intake |
| Dream Task | `src/components/tasks/src/tasks/DreamTask/` | Stub | Memory distillation task |
| Memory Directory | `src/memdir/memdir.ts` | Stub | Memory directory management |

### 3.2 SleepTool (shared with Proactive)

File: `src/tools/SleepTool/prompt.ts`

SleepTool is the pacing-control core of KAIROS/Proactive. Its description teaches the model the concept of "sleeping":
- Tool name: `Sleep`
- Function: waits the specified time and then responds to the tick prompt; wakes early if new work appears in the queue or proactive is turned off
- Works with `<tick_tag>` to produce heartbeat-style autonomous work
- Remote-control surfaces can see two states, `standby` / `sleeping`, through `automation_state`

### 3.3 Bridge Integration

KAIROS connects to claude.ai servers through Bridge Mode (`src/bridge/`):

```
claude.ai web/app
      │
      ▼ (HTTPS long-poll)
┌──────────────────────┐
│  Bridge API Client   │  src/bridge/bridgeApi.ts
│  (register/poll/     │
│   acknowledge)       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Session Runner      │  src/bridge/sessionRunner.ts
│  (create/resume REPL)│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  REPL + Proactive    │  tick-driven autonomous work
│  Tick Loop           │
└──────────────────────┘
```

### 3.4 Data Flow

```
User sends a message from claude.ai
         │
         ▼
Bridge pollForWork() receives a WorkResponse
         │
         ▼
acknowledgeWork() confirms receipt
         │
         ▼
sessionRunner creates/resumes the REPL session
         │
         ▼
User message is injected into the REPL conversation
         │
         ▼
Model processes → tool calls → BriefTool structured output
         │
         ▼
Result is returned to claude.ai through the Bridge API
```

## 4. Key Design Decisions

1. **Tick-driven rather than event-driven**: the model controls its own wake-up frequency through SleepTool instead of being pushed external events. This simplifies the architecture but adds API call overhead
2. **KAIROS ⊃ PROACTIVE**: every proactive check includes KAIROS, so both flags need not be enabled together
3. **Brief display/behavior separation**: the `/brief` toggle only controls UI filtering; the model can always use BriefTool
4. **Terminal focus awareness**: the model adjusts its autonomy automatically depending on whether the user is looking at the terminal
5. **GrowthBook gating**: some features (such as push notifications) need a server-side GrowthBook switch even when the feature flag is on

## 5. Usage

```bash
# Minimal enablement (always-on assistant + Brief)
FEATURE_KAIROS=1 FEATURE_KAIROS_BRIEF=1 bun run dev

# Everything enabled
FEATURE_KAIROS=1 \
FEATURE_KAIROS_BRIEF=1 \
FEATURE_KAIROS_CHANNELS=1 \
FEATURE_KAIROS_PUSH_NOTIFICATION=1 \
FEATURE_KAIROS_GITHUB_WEBHOOKS=1 \
FEATURE_PROACTIVE=1 \
bun run dev

# Combined with Token Budget
FEATURE_KAIROS=1 FEATURE_TOKEN_BUDGET=1 bun run dev
```

## 6. External Dependencies

- **Anthropic OAuth**: requires a claude.ai subscription login (not an API key)
- **GrowthBook**: server-side feature gating (`tengu_ccr_bridge` etc.)
- **Bridge API**: the `/v1/environments/bridge` family of endpoints

## 7. File Index

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/assistant/index.ts` | 9 | Assistant module entry (stub) |
| `src/assistant/gate.ts` | — | GrowthBook gating (stub) |
| `src/assistant/sessionDiscovery.ts` | — | Session discovery (stub) |
| `src/assistant/sessionHistory.ts` | — | Session history (stub) |
| `src/assistant/AssistantSessionChooser.ts` | — | Session chooser UI (stub) |
| `src/tools/BriefTool/` | — | BriefTool implementation (stub) |
| `src/tools/SleepTool/prompt.ts` | ~30 | SleepTool prompt |
| `src/tools/SleepTool/SleepTool.ts` | ~200 | Sleep/wake and automation metadata |
| `src/services/mcp/channelNotification.ts` | 5 | Channel message intake (stub) |
| `src/memdir/memdir.ts` | — | Memory directory management (stub) |
| `src/constants/prompts.ts:557,847-918` | 72 | System prompt injection |
| `src/components/tasks/src/tasks/DreamTask/` | 3 | Dream task (stub) |
| `src/proactive/index.ts` | — | Proactive core (shared with KAIROS) |
| `src/utils/sessionState.ts` | — | Exposes automation state to bridge/CCR |
