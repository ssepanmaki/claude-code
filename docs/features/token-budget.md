# TOKEN_BUDGET — Token Budget Auto-Continue Mode

> Feature Flag: `FEATURE_TOKEN_BUDGET=1`
> Status: fully working

## 1. Overview

TOKEN_BUDGET lets the user specify an output token budget target in the prompt (such as `+500k` or `spend 2M tokens`). Claude then **keeps working automatically** until the target is reached, with no need for the user to keep pressing Enter to push it along.

It suits long tasks that need many rounds of tool calls, such as large refactors, bulk edits and large-scale code generation.

## 2. User Interaction

### Syntax

| Format | Example | Description |
|--------|---------|-------------|
| Shorthand (start) | `+500k` | Written at the start of the input |
| Shorthand (end) | `Refactor this module +2m` | Appended to the end of the input |
| Full syntax | `spend 2M tokens` or `use 1B tokens` | Embedded in natural language |

Supported units: `k` (thousand), `m` (million), `b` (billion), case-insensitive.

### UI Feedback

- **Input highlighting**: when the input contains budget syntax, the matching text is highlighted (`PromptInput.tsx` computes it via `findTokenBudgetPositions`)
- **Spinner progress**: the bottom spinner shows live progress, for example:
  - In progress: `Target: 125,000 / 500,000 (25%) · ~2m 30s`
  - Done: `Target: 510,000 used (500,000 min ✓)`
  - Includes an ETA (computed from the current token output rate)

## 3. Architecture

### Data Flow

```
User types "+500k"
     │
     ▼
┌─────────────────────────┐
│  parseTokenBudget()     │  src/utils/tokenBudget.ts
│  regex parse → 500,000  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  REPL.tsx               │  called on submit
│  snapshotOutputTokens   │  snapshotOutputTokensForTurn(500000)
│  ForTurn(500000)        │  records the turn's starting token count + budget
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  query.ts main loop     │  checked at the end of each round
│  checkTokenBudget()     │  current output tokens vs. budget
└────────┬────────────────┘
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
 continue    stop
 (< 90%)     (≥ 90% or diminishing returns)
    │          │
    ▼          ▼
 inject nudge  finish normally
 message and   emit completion event
 continue
```

### Core Modules

#### 1. Parsing Layer — `src/utils/tokenBudget.ts`

Three regular expressions parse the user input:

```
SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i   // "+500k" at the start
SHORTHAND_END_RE   = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i  // "+2m" at the end
VERBOSE_RE         = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i  // "spend 2M tokens"
```

- `parseTokenBudget(text)` — extracts the budget value, returns `number | null`
- `findTokenBudgetPositions(text)` — returns an array of match positions, used for input highlighting
- `getBudgetContinuationMessage(pct, turnTokens, budget)` — builds the continuation message

#### 2. State Layer — `src/bootstrap/state.ts`

Module-level singleton variables track the current turn's budget state:

```
outputTokensAtTurnStart   — cumulative output token count at the start of this turn
currentTurnTokenBudget    — this turn's budget target (null means no budget)
budgetContinuationCount   — number of automatic continuations so far this turn
```

Key functions:
- `getTotalOutputTokens()` — sums output tokens across all models from `STATE.modelUsage`
- `getTurnOutputTokens()` — `getTotalOutputTokens() - outputTokensAtTurnStart`
- `snapshotOutputTokensForTurn(budget)` — resets the turn baseline and sets the new budget
- `getCurrentTurnTokenBudget()` — returns the current budget

#### 3. Decision Layer — `src/query/tokenBudget.ts`

`checkTokenBudget(tracker, agentId, budget, globalTurnTokens)` makes the continue/stop decision:

**Continue conditions**:
- Not inside a sub-agent (`agentId` is empty)
- A budget exists and is > 0
- Current tokens are below **90%** of the budget
- Not diminishing returns (after 3 consecutive nudges, each round adds < 500 tokens)

**Stop conditions**:
- The budget has reached 90%
- Diminishing returns (the model has "run out of steam")
- Skipped outright in sub-agent mode

**Diminishing-returns detection**: `continuationCount >= 3` and the deltas of the last two nudges are both < 500 tokens.

#### 4. Main Loop Integration — `src/query.ts`

```
Inside query():
  1. Create budgetTracker = createBudgetTracker()
  2. Enter the while loop
  3. Call checkTokenBudget() at the end of each round
  4. When decision.action === 'continue':
     - inject a meta user message (the nudge)
     - continue back to the top of the loop
  5. When decision.action === 'stop':
     - record the completion event (with the diminishingReturns flag)
     - return normally
```

#### 5. UI Layer

| File | Responsibility |
|------|----------------|
| `components/PromptInput/PromptInput.tsx:534` | Highlights budget syntax in the input |
| `components/Spinner.tsx:319-338` | Spinner shows progress percentage + ETA |
| `screens/REPL.tsx:2897` | Parses the budget and snapshots on submit |
| `screens/REPL.tsx:2138` | Clears the budget when the user cancels |
| `screens/REPL.tsx:2963` | Captures budget info at turn end for display |

#### 6. System Prompt — `src/constants/prompts.ts:538-551`

Injects the `token_budget` section:

> "When the user specifies a token target (e.g., '+500k', 'spend 2M tokens', 'use 1B tokens'), your output token count will be shown each turn. Keep working until you approach the target — plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you."

Note: this prompt is **cached unconditionally** (it does not change with the budget toggle), because the wording "When the user specifies..." is a no-op when there is no budget.

#### 7. API Attachment — `src/utils/attachments.ts:3830-3845`

Each API call carries an `output_token_usage` attachment:

```json
{
  "type": "output_token_usage",
  "turn": 125000,     // output produced this turn
  "session": 350000,  // total output this session
  "budget": 500000    // budget target
}
```

This lets the model see its own progress.

## 4. Key Design Decisions

1. **90% threshold rather than 100%**: stopping at `COMPLETION_THRESHOLD = 0.9` keeps the last nudge from producing far more tokens than the budget
2. **Diminishing-returns protection**: after 3 consecutive nudges, if each round yields < 500 tokens, the model is judged to have made no real progress and is stopped early
3. **Sub-agent exemption**: sub-tasks inside AgentTool skip the budget check so they don't repeatedly trigger continuation
4. **Unconditionally cached system prompt**: the budget prompt is always injected (it doesn't toggle with the budget), avoiding a ~20K-token cache miss every time the budget changes
5. **Cancel clears the budget**: pressing Escape calls `snapshotOutputTokensForTurn(null)` so a leftover budget can't trigger continuation

## 5. Usage

```bash
# Enable the feature
FEATURE_TOKEN_BUDGET=1 bun run dev

# Use it in a prompt
> +500k refactor all the test files
> spend 2M tokens migrating this project from JS to TS
> write me a complete CRUD module +1m
```

## 6. File Index

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/utils/tokenBudget.ts` | 73 | Regex parsing + position lookup + continuation message generation |
| `src/query/tokenBudget.ts` | 93 | Budget tracker + continue/stop decision |
| `src/bootstrap/state.ts:724-743` | 20 | Per-turn token snapshot state |
| `src/constants/prompts.ts:538-551` | 14 | System prompt injection |
| `src/utils/attachments.ts:3830-3844` | 17 | API attachment |
| `src/query.ts:280,1311-1358` | 48 | Main loop integration |
| `src/screens/REPL.tsx:2897,2963,2138` | 20 | REPL submit/complete/cancel handling |
| `src/components/Spinner.tsx:319-338` | 20 | Progress bar UI |
| `src/components/PromptInput/PromptInput.tsx:534` | 1 | Input highlighting |
