# `/autofix-pr` Command Implementation Spec

> **Status**: Planning (2026-04-29), awaiting review before implementation.
> **Architecture**: R (Remote-via-CCR), full version (stop subcommand, singleton lock, subscribePR, in-process teammate, skills detection).

---

## 1. Background

### 1.1 Problem

This repository is a decompiled/rebuilt version of Anthropic's official `@anthropic-ai/claude-code`. Many remote capabilities are stubbed out, and `/autofix-pr` is one of them:

```js
// src/commands/autofix-pr/index.js (current stub)
export default { isEnabled: () => false, isHidden: true, name: 'stub' };
```

Together, the three fields make the command completely invisible and impossible to invoke from the slash menu:

| Field | Value | Effect |
|---|---|---|
| `isEnabled` | `() => false` | Judged unavailable at registration time |
| `isHidden` | `true` | Filtered out even if listed |
| `name` | `'stub'` | The registered name is `'stub'`, so typing `/autofix-pr` never matches |

### 1.2 User scenario

A user working in a fork tries to run `/autofix-pr <PR#>` against a pull request in the upstream repository and repeatedly gets `git_repository source setup error`. Root cause: the officially dispatched remote session lands in a repository that MCP denies access to (a permission/visibility problem).

### 1.3 Goals

| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Command is visible and invocable from the slash menu | Typing `/au` shows the completion |
| R2 | Cross-repo PRs: trigger a fix on an upstream PR from a local fork | `/autofix-pr <PR#>` does not report repo-not-allowed |
| R3 | The remote actually completes the fix and pushes back to the PR branch | The PR gets a new commit from the remote |
| R4 | Do not break other existing stubs (e.g. `share`) | Only `autofix-pr` is touched |
| R5 | TypeScript strict mode, zero errors from `bun run typecheck` | CI green |
| R6 | Triggerable through the bridge (Remote Control) | `bridgeSafe: true` takes effect |
| R7 | Support stop/off subcommands | `/autofix-pr stop` ends the current monitor |
| R8 | Singleton lock prevents duplicate dispatch | While a PR is monitored, a new start is rejected with a message |

---

## 2. Decompilation findings (source: the official `claude` binary)

The official binary is a ~242MB Bun-compiled artifact with the JS source embedded. The full call chain was reconstructed by extracting strings from the file (`grep -aoE`).

### 2.1 Main entry function structure

```js
async function entry(input, q, ctx) {
  const isStop = input === "stop" || input === "off"
  const args = { freeformPrompt: input }
  return main(args, q, ctx)
}

async function main(args, q, { signal, onProgress }) {
  // args fields: { prNumber, target, freeformPrompt, repoPath, skills }
  d("tengu_autofix_pr_started", {
    action: "start",
    has_pr_number: String(args.prNumber !== undefined),
    has_repo_path: String(args.repoPath !== undefined),
  })
  // ...
}
```

### 2.2 `teleportToRemote` call signature (the key evidence)

```ts
const session = await teleportToRemote({
  initialMessage: C,                       // initial message for the remote
  source: "autofix_pr",                    // ⚠️ new field, absent from this repo's teleport.tsx
  branchName: N,                           // PR head branch
  reuseOutcomeBranch: N,                   // same as branchName — remote pushes back to the original branch
  title: `Autofix PR: ${owner}/${repo}#${prNumber} (${branch})`,
  useDefaultEnvironment: true,             // ⚠️ does not use a synthetic env (unlike ultrareview)
  signal,
  githubPr: { owner, repo, number },
  cwd: repoPath,
  onBundleFail: (msg) => { /* ... */ },
})
```

**Key differences from `ultrareview`**:

| Field | ultrareview | autofix-pr |
|---|---|---|
| `environmentId` | `env_011111111111111111111113` (synthetic) | Not passed |
| `useDefaultEnvironment` | Not passed | `true` |
| `useBundle` | Yes (branch mode) | Not passed (`skipBundle` is implied by passing no bundle) |
| `reuseOutcomeBranch` | Not passed | Passed (remote pushes back to the original PR branch) |
| `githubPr` | Not passed | Required |
| `source` | Not passed | `"autofix_pr"` |
| `environmentVariables` | A pile of `BUGHUNTER_*` | Not passed |

### 2.3 `registerRemoteAgentTask` call

```ts
registerRemoteAgentTask({
  remoteTaskType: "autofix-pr",
  session: { id: session.id, title: session.title },
  command,
  isLongRunning: true,        // polling does not consume a result; driven by periodic notifications
})
```

### 2.4 Subcommand parsing

```
/autofix-pr <PR#>                    → start monitoring + dispatch a CCR session
/autofix-pr stop                     → stop the current monitor
/autofix-pr off                      → same as stop
/autofix-pr <freeform-prompt>        → freeform prompt mode (no PR number)
/autofix-pr <owner>/<repo>#<n>       → cross-repo (covers the R2 acceptance)
```

### 2.5 State model

- **Singleton lock**: only one PR can be monitored at a time. A repeated start reports: `already monitoring ${repo}#${prNumber}. Run /autofix-pr stop first.` (error_code: `rc_already_monitoring_other`)
- **PR subscription**: calls `kairos.subscribePR(owner, repo, taskId)` — depends on the `KAIROS_GITHUB_WEBHOOKS` feature flag
- **In-process teammate**: registers a background agent
  ```ts
  const teammate = {
    agentId,
    agentName: "autofix-pr",
    teamName: "_autofix",
    color: undefined,
    planModeRequired: false,
    parentSessionId,
  }
  ```
- **Skills detection**: scans the project for autofix-related skills (such as `.claude/skills/autofix-*` or a root `AUTOFIX.md`) and, on a hit, appends to the prompt: `Run X and Y for custom instructions on how to autofix.`

### 2.6 Telemetry

| Event | Fields |
|---|---|
| `tengu_autofix_pr_started` | `{ action, has_pr_number, has_repo_path }` |
| `tengu_autofix_pr_result` | `{ result, error_code? }` |

`result` values: `success_rc` / `failed` / `cancelled`

`error_code` values:

| code | Meaning |
|---|---|
| `rc_already_monitoring_other` | Already monitoring a different PR |
| `session_create_failed` | Teleport failed |
| `exception` | Uncaught exception |

### 2.7 Error return structure

```ts
function errorResult(message: string, code: string) {
  d("tengu_autofix_pr_result", { result: "failed", error_code: code })
  return {
    kind: "error",
    message: `Autofix PR failed: ${message}`,
    code,
  }
}

function cancelledResult() {
  d("tengu_autofix_pr_result", { result: "cancelled" })
  return { kind: "cancelled" }
}
```

---

## 3. Existing infrastructure in this repository

The following capabilities are **reused directly** when implementing `/autofix-pr` (confirmed complete and working):

| Capability | File | Role |
|---|---|---|
| `teleportToRemote` | `src/utils/teleport.tsx:947` | Dispatches a CCR remote session (missing the `source` field; needs to be added) |
| `registerRemoteAgentTask` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:526` | Registers a long-running task in the store |
| `checkRemoteAgentEligibility` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:185` | Pre-flight authorization check |
| `getRemoteTaskSessionUrl` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | Builds the session tracking URL |
| `formatPreconditionError` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | Error message formatting |
| `REMOTE_TASK_TYPES` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:103` | Already includes the `'autofix-pr'` type |
| `AutofixPrRemoteTaskMetadata` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:112` | `{ owner, repo, prNumber }` schema |
| `RemoteSessionProgress` | `src/components/tasks/RemoteSessionProgress.tsx` | Progress panel UI (already recognizes the autofix-pr type) |
| `detectCurrentRepositoryWithHost` | `src/utils/detectRepository.ts` | Resolves owner/repo |
| `getDefaultBranch` / `gitExe` | `src/utils/git.ts` | git helpers |
| `feature('FLAG')` | `bun:bundle` | Feature flag system (hard rule from CLAUDE.md: may only be called directly in an if/ternary condition) |

### Reference implementations

The following three files are confirmed to work and serve as the "reference answers" for this implementation:

- `src/commands/review/reviewRemote.ts` (317 lines) — **primary template**, copy and adapt
- `src/commands/ultraplan.tsx` (525 lines)
- `src/commands/review/ultrareviewCommand.tsx` (89 lines)

---

## 4. Command object spec

### 4.1 Choosing the `Command` type

The `Command` type is defined in `src/types/command.ts` and is one of three kinds: `PromptCommand` / `LocalCommand` / `LocalJSXCommand`.

**Choose `LocalJSXCommand`**, because:
- It needs to spawn a remote session and show a progress panel
- The sibling commands `ultraplan` / `ultrareview` both use local-jsx
- Signature: `call(onDone, context, args) => Promise<React.ReactNode>`

### 4.2 Full shape of `index.ts`

```ts
import { feature } from 'bun:bundle'
import type { Command } from '../../types/command.js'

const autofixPr: Command = {
  type: 'local-jsx',
  name: 'autofix-pr',                          // critical: must be 'autofix-pr', not 'stub'
  description: 'Auto-fix CI failures on a pull request',
  argumentHint: '<pr-number> | stop | <owner>/<repo>#<n>',
  isEnabled: () => feature('AUTOFIX_PR'),
  isHidden: false,
  bridgeSafe: true,
  getBridgeInvocationError: (args) => {
    const trimmed = args.trim()
    if (!trimmed) return 'PR number required, e.g. /autofix-pr 386'
    if (trimmed === 'stop' || trimmed === 'off') return undefined
    if (/^\d+$/.test(trimmed)) return undefined
    if (/^[\w.-]+\/[\w.-]+#\d+$/.test(trimmed)) return undefined
    return 'Invalid args. Use /autofix-pr <pr-number> | stop | <owner>/<repo>#<n>'
  },
  load: async () => {
    const m = await import('./launchAutofixPr.js')
    return { call: m.callAutofixPr }
  },
}

export default autofixPr
```

### 4.3 Argument parsing rules

```
^stop$ | ^off$            → { action: 'stop' }
^\d+$                     → { action: 'start', prNumber, owner: <git>, repo: <git> }
^([\w.-]+)/([\w.-]+)#(\d+)$ → { action: 'start', prNumber, owner, repo }
anything else             → { action: 'start', freeformPrompt: <input> }
empty string              → error
```

---

## 5. File structure

```
src/commands/autofix-pr/
├── index.ts                       # command object (replaces index.js)
├── launchAutofixPr.ts             # main flow
├── parseArgs.ts                   # argument parsing (separate for testability)
├── monitorState.ts                # singleton lock
├── inProcessAgent.ts              # background teammate
├── skillDetect.ts                 # project skills detection
└── __tests__/
    ├── parseArgs.test.ts
    ├── monitorState.test.ts
    ├── launchAutofixPr.test.ts
    └── index.test.ts              # bridge invocation error tests
```

**Delete**: the original `index.js` and `index.d.ts` (merged into `index.ts`).

**Modify**:
- `scripts/defines.ts` — add the `AUTOFIX_PR` flag
- `scripts/dev.ts` — enable by default in dev
- `src/utils/teleport.tsx` — add a `source?: string` option to `teleportToRemote` and pass it through
- `src/commands.ts` — **leave unchanged** (the import path `'./commands/autofix-pr/index.js'` resolves to `.ts` automatically under ESM/Bun)

---

## 6. Module specs

### 6.1 `parseArgs.ts`

```ts
export type ParsedArgs =
  | { action: 'stop' }
  | { action: 'start'; prNumber: number; owner?: string; repo?: string }
  | { action: 'freeform'; prompt: string }
  | { action: 'invalid'; reason: string }

export function parseAutofixArgs(raw: string): ParsedArgs {
  const trimmed = raw.trim()
  if (!trimmed) return { action: 'invalid', reason: 'empty' }
  if (trimmed === 'stop' || trimmed === 'off') return { action: 'stop' }
  if (/^\d+$/.test(trimmed)) {
    return { action: 'start', prNumber: parseInt(trimmed, 10) }
  }
  const cross = trimmed.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/)
  if (cross) {
    return {
      action: 'start',
      owner: cross[1],
      repo: cross[2],
      prNumber: parseInt(cross[3], 10),
    }
  }
  return { action: 'freeform', prompt: trimmed }
}
```

### 6.2 `monitorState.ts`

```ts
import type { UUID } from 'crypto'

type MonitorState = {
  taskId: UUID
  owner: string
  repo: string
  prNumber: number
  abortController: AbortController
  startedAt: number
}

let active: MonitorState | null = null

export function getActiveMonitor(): Readonly<MonitorState> | null {
  return active
}

export function setActiveMonitor(state: MonitorState): void {
  if (active) throw new Error(`Monitor already active: ${active.repo}#${active.prNumber}`)
  active = state
}

export function clearActiveMonitor(): void {
  if (active) {
    active.abortController.abort()
    active = null
  }
}

export function isMonitoring(owner: string, repo: string, prNumber: number): boolean {
  return active?.owner === owner && active?.repo === repo && active?.prNumber === prNumber
}
```

### 6.3 `inProcessAgent.ts`

Modeled on the official `xd9` function:

```ts
import { randomUUID, type UUID } from 'crypto'
import { getCurrentSessionId } from '../../bootstrap/state.js'

export type AutofixTeammate = {
  agentId: UUID
  agentName: 'autofix-pr'
  teamName: '_autofix'
  color: undefined
  planModeRequired: false
  parentSessionId: UUID
  abortController: AbortController
  taskId: UUID
}

export function createAutofixTeammate(
  initialMessage: string,
  target: string,
): AutofixTeammate {
  return {
    agentId: randomUUID(),
    agentName: 'autofix-pr',
    teamName: '_autofix',
    color: undefined,
    planModeRequired: false,
    parentSessionId: getCurrentSessionId(),
    abortController: new AbortController(),
    taskId: randomUUID(),
  }
}
```

### 6.4 `skillDetect.ts`

```ts
import { existsSync } from 'fs'
import { join } from 'path'

export function detectAutofixSkills(cwd: string): string[] {
  const candidates = [
    'AUTOFIX.md',
    '.claude/skills/autofix.md',
    '.claude/skills/autofix-pr/SKILL.md',
  ]
  return candidates.filter(rel => existsSync(join(cwd, rel)))
}

export function formatSkillsHint(skills: string[]): string {
  if (skills.length === 0) return ''
  return ` Run ${skills.join(' and ')} for custom instructions on how to autofix.`
}
```

### 6.5 `launchAutofixPr.ts`

Main flow pseudocode (about 250 lines):

```ts
import type { LocalJSXCommandCall } from '../../types/command.js'
import { parseAutofixArgs } from './parseArgs.js'
import { getActiveMonitor, setActiveMonitor, clearActiveMonitor, isMonitoring } from './monitorState.js'
import { createAutofixTeammate } from './inProcessAgent.js'
import { detectAutofixSkills, formatSkillsHint } from './skillDetect.js'
import { teleportToRemote } from '../../utils/teleport.js'
import { checkRemoteAgentEligibility, registerRemoteAgentTask, getRemoteTaskSessionUrl } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import { detectCurrentRepositoryWithHost } from '../../utils/detectRepository.js'
import { logEvent } from '../../services/analytics/index.js'

export const callAutofixPr: LocalJSXCommandCall = async (onDone, context, args) => {
  const parsed = parseAutofixArgs(args)

  // 1. stop subcommand
  if (parsed.action === 'stop') {
    const m = getActiveMonitor()
    if (!m) {
      onDone('No active autofix monitor.', { display: 'system' })
      return null
    }
    clearActiveMonitor()
    onDone(`Stopped monitoring ${m.repo}#${m.prNumber}.`, { display: 'system' })
    return null
  }

  // 2. invalid
  if (parsed.action === 'invalid') {
    return errorView(`Invalid args: ${parsed.reason}`)
  }

  // 3. freeform — not supported yet, tell the user
  if (parsed.action === 'freeform') {
    return errorView('Freeform prompt mode not yet supported. Use /autofix-pr <pr-number>.')
  }

  // 4. start
  logEvent('tengu_autofix_pr_started', {
    action: 'start',
    has_pr_number: 'true',
    has_repo_path: String(!!process.cwd()),
  })

  // 4.1 Resolve owner/repo
  let owner = parsed.owner
  let repo = parsed.repo
  if (!owner || !repo) {
    const detected = await detectCurrentRepositoryWithHost()
    if (!detected || detected.host !== 'github.com') {
      return errorResult('Cannot detect GitHub repo from current directory.', 'session_create_failed')
    }
    owner = detected.owner
    repo = detected.name
  }

  // 4.2 Singleton lock
  if (isMonitoring(owner, repo, parsed.prNumber)) {
    return errorResult(`already monitoring ${repo}#${parsed.prNumber} in background`, 'success_rc')
  }
  if (getActiveMonitor()) {
    const m = getActiveMonitor()!
    return errorResult(
      `already monitoring ${m.repo}#${m.prNumber}. Run /autofix-pr stop first.`,
      'rc_already_monitoring_other',
    )
  }

  // 4.3 Eligibility check
  const eligibility = await checkRemoteAgentEligibility()
  if (!eligibility.eligible) {
    return errorResult('Remote agent not available.', 'session_create_failed')
  }

  // 4.4 Detect skills
  const skills = detectAutofixSkills(process.cwd())
  const skillsHint = formatSkillsHint(skills)

  // 4.5 Build the initial message
  const target = `${owner}/${repo}#${parsed.prNumber}`
  const branchName = `refs/pull/${parsed.prNumber}/head`
  const initialMessage = `Auto-fix failing CI checks on PR #${parsed.prNumber} in ${owner}/${repo}.${skillsHint}`

  // 4.6 Create the in-process teammate
  const teammate = createAutofixTeammate(initialMessage, target)

  // 4.7 Call teleport
  let bundleFailMsg: string | undefined
  const session = await teleportToRemote({
    initialMessage,
    source: 'autofix_pr',
    branchName,
    reuseOutcomeBranch: branchName,
    title: `Autofix PR: ${target} (${branchName})`,
    useDefaultEnvironment: true,
    signal: teammate.abortController.signal,
    githubPr: { owner, repo, number: parsed.prNumber },
    cwd: process.cwd(),
    onBundleFail: (msg) => { bundleFailMsg = msg },
  })

  if (!session) {
    return errorResult(bundleFailMsg ?? 'remote session creation failed.', 'session_create_failed')
  }

  // 4.8 Register the task in the store
  registerRemoteAgentTask({
    remoteTaskType: 'autofix-pr',
    session,
    command: `/autofix-pr ${parsed.prNumber}`,
    context,
  })

  // 4.9 Set the singleton lock
  setActiveMonitor({
    taskId: teammate.taskId,
    owner,
    repo,
    prNumber: parsed.prNumber,
    abortController: teammate.abortController,
    startedAt: Date.now(),
  })

  // 4.10 PR webhook subscription (feature-gated)
  if (feature('KAIROS_GITHUB_WEBHOOKS')) {
    await kairosSubscribePR(owner, repo, teammate.taskId).catch(() => {/* non-fatal */})
  }

  // 4.11 Return the JSX progress panel
  const sessionUrl = getRemoteTaskSessionUrl(session.id)
  logEvent('tengu_autofix_pr_launched', { target })
  onDone(
    `Autofix launched for ${target}. Track: ${sessionUrl}`,
    { display: 'system' },
  )
  return null  // the progress panel is rendered automatically by RemoteAgentTask
}

function errorResult(message: string, code: string) {
  logEvent('tengu_autofix_pr_result', { result: 'failed', error_code: code })
  // ... render the error JSX
}
```

> **Note**: `feature('KAIROS_GITHUB_WEBHOOKS')` must sit directly in an if condition and cannot be assigned to a variable (hard rule from CLAUDE.md).

### 6.6 Add the `source` field to `teleport.tsx`

```diff
 export async function teleportToRemote(options: {
   initialMessage: string | null
   branchName?: string
   title?: string
   description?: string
+  /**
+   * Identifies which command/flow originated this teleport. CCR backend
+   * uses this for routing/billing/observability. Known values: 'autofix_pr',
+   * 'ultrareview', 'ultraplan'. Pass-through field — not interpreted client-side.
+   */
+  source?: string
   model?: string
   permissionMode?: PermissionMode
   // ...
 })
```

It should also be passed through to `session_context` when the request is built internally (use the exact field name that matches the existing review/ultraplan call structure).

---

## 7. Feature flag

### 7.1 New flag

Add `AUTOFIX_PR` to the existing flag set in `scripts/defines.ts`.

### 7.2 Enablement matrix

| Environment | On by default | Notes |
|---|---|---|
| dev (`bun run dev`) | Yes | Added to the default list in `scripts/dev.ts` |
| build (production `bun run build`) | No | Gradual rollout; requires an explicit `FEATURE_AUTOFIX_PR=1` |
| Tests | As needed | Test files control it by mocking `bun:bundle` |

### 7.3 Sync strategy with the official upstream

If the official implementation is ever restored, the local implementation wins:
1. Keep the `AUTOFIX_PR` flag name
2. Leave the `RemoteTaskType` field untouched
3. On conflict, merge: absorb upstream changes to the `source` field value and env vars, and keep the local launcher function

---

## 8. Test plan

### 8.1 Test files

| File | Coverage target | Test cases |
|---|---|---|
| `parseArgs.test.ts` | All argument-parsing branches | ~10 |
| `monitorState.test.ts` | Singleton lock correctness | ~6 |
| `launchAutofixPr.test.ts` | Main flow happy path + failure paths | ~12 |
| `index.test.ts` | Bridge invocation error validation | ~5 |

### 8.2 Key assertions

`launchAutofixPr.test.ts`:

```ts
test('start with PR number teleports with correct args', async () => {
  // mock teleportToRemote, registerRemoteAgentTask, detectCurrentRepositoryWithHost
  await callAutofixPr(onDone, context, '386')
  expect(teleportMock).toHaveBeenCalledWith(expect.objectContaining({
    source: 'autofix_pr',
    useDefaultEnvironment: true,
    githubPr: { owner: 'example-owner', repo: 'example-repo', number: 386 },
    branchName: 'refs/pull/386/head',
    reuseOutcomeBranch: 'refs/pull/386/head',
  }))
  expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({
    remoteTaskType: 'autofix-pr',
  }))
})

test('cross-repo syntax owner/repo#n parses correctly', async () => {
  await callAutofixPr(onDone, context, 'anthropics/claude-code#999')
  expect(teleportMock).toHaveBeenCalledWith(expect.objectContaining({
    githubPr: { owner: 'anthropics', repo: 'claude-code', number: 999 },
  }))
})

test('singleton lock blocks second start', async () => {
  await callAutofixPr(onDone, context, '386')
  const result = await callAutofixPr(onDone, context, '999')
  expect(extractError(result)).toMatch(/already monitoring.*386.*Run \/autofix-pr stop first/)
})

test('stop clears active monitor', async () => {
  await callAutofixPr(onDone, context, '386')
  await callAutofixPr(onDone, context, 'stop')
  expect(getActiveMonitor()).toBeNull()
})
```

### 8.3 Mock strategy

Following this repository's shared-mock convention in `tests/mocks/`:
- `tests/mocks/log.ts` and `tests/mocks/debug.ts` — must be mocked
- `bun:bundle` — mock `feature` to return `true`
- `teleportToRemote` — module-level mock; assert on its arguments
- `registerRemoteAgentTask` — module-level mock; assert on its arguments
- `detectCurrentRepositoryWithHost` — mock to return `{ owner, name, host }`

### 8.4 Type checking

```bash
bun run typecheck      # must report zero errors
bun run test:all       # must be all green
```

---

## 9. Implementation steps (12-step checklist)

```
[ ] Step 1   Add the AUTOFIX_PR flag to scripts/defines.ts + scripts/dev.ts
[ ] Step 2   Add a source?: string field to src/utils/teleport.tsx (about 5 lines)
[ ] Step 3   Delete src/commands/autofix-pr/{index.js, index.d.ts}
             Create src/commands/autofix-pr/index.ts (about 50 lines)
[ ] Step 4   Create src/commands/autofix-pr/parseArgs.ts (about 30 lines)
[ ] Step 5   Create src/commands/autofix-pr/monitorState.ts (about 40 lines)
[ ] Step 6   Create src/commands/autofix-pr/inProcessAgent.ts (about 60 lines)
[ ] Step 7   Create src/commands/autofix-pr/skillDetect.ts (about 30 lines)
[ ] Step 8   Create src/commands/autofix-pr/launchAutofixPr.ts (about 250 lines)
             Copy reviewRemote.ts and adapt it per the §2.2 differences table
[ ] Step 9   Create the four test files (about 150 lines)
[ ] Step 10  bun run typecheck && bun run test:all all green
[ ] Step 11  Manual test in dev mode:
              a. /autofix-pr 386 → expect the RemoteSessionProgress panel
              b. /autofix-pr stop → expect a "stopped" message
              c. /autofix-pr anthropics/claude-code#999 → expect cross-repo to work
              d. A second /autofix-pr 386 → expect rejection by the singleton lock
[ ] Step 12  Commit: feat: implement /autofix-pr command (replace stub)
```

Estimated effort: about 600 lines of new code (including 150 lines of tests).

---

## 10. Risks and rollback

| Risk | Trigger | Rollback strategy |
|---|---|---|
| The CCR backend does not recognize the `source` field | Backend accepts only specific enum values | Omit the field and see if it still works; if not, check whether the official cli.js passes a different field |
| The `subscribePR` API is incomplete in this repo's client | KAIROS_GITHUB_WEBHOOKS client code is missing | Tolerate failure with `.catch(() => {})`; the subscription is nice-to-have |
| The user's account has no CCR permission | `checkRemoteAgentEligibility` returns false | The command degrades to an error message and does not break the session |
| The remote starts a session but does not fix the code | Misnamed env vars | Check the container logs on the session page from `getRemoteTaskSessionUrl` and adjust |
| The PR is in a fork and CCR has no access | `git_repository source error` | The command should detect this in its pre-flight checks and tell the user to move the PR to the main repo first |
| Upstream restores the official implementation, causing conflicts | During an upstream sync | The project is a fork, so the local implementation wins; resolve conflicts by hand |

### Rollback commands

```bash
# Fully revert this implementation
git checkout main
git worktree remove <path-to-autofix-pr-worktree>
git branch -D feat/autofix-pr
```

The `AUTOFIX_PR` flag is off by default in production, so even once the code is merged to main it has no effect on users unless `FEATURE_AUTOFIX_PR=1` is set explicitly.

---

## 11. Acceptance checklist

Check each item once implementation is complete:

- [ ] R1: In dev mode, typing `/au` shows the `/autofix-pr` completion
- [ ] R2: `/autofix-pr anthropics/claude-code#999` does not report repo-not-allowed
- [ ] R3: After the remote session finishes, the target PR has a new commit
- [ ] R4: Other stubs (`share`, etc.) remain hidden
- [ ] R5: `bun run typecheck` reports zero errors
- [ ] R6: Triggering `/autofix-pr 386` through the RC bridge works
- [ ] R7: `/autofix-pr stop` ends the current monitor
- [ ] R8: A second `/autofix-pr` for a different PR is rejected by the lock with a message

---

## 12. Appendix

### Appendix A: Quick reference of related paths

| Path | Role |
|---|---|
| `<worktree-path>` | Implementation worktree |
| `<official-claude-binary>` | Decompilation source (~242MB Bun-compiled artifact) |
| `src/commands/review/reviewRemote.ts` | Primary template |
| `src/utils/teleport.tsx:947` | `teleportToRemote` entry point |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:103` | `REMOTE_TASK_TYPES` |
| `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx:526` | `registerRemoteAgentTask` |
| `src/types/command.ts` | `Command` type definition |

### Appendix B: Open questions

| # | Question | Current handling | Follow-up |
|---|---|---|---|
| Q1 | Is the `source` field parsed by the CCR backend? | Pass `'autofix_pr'` for now, as the official client does | Watch the remote logs during end-to-end testing |
| Q2 | Is the `subscribePR` client SDK complete in this repo? | Tolerate failure with `try/catch` | Verify separately during the Step 11 manual test |
| Q3 | Should freeform prompt mode be implemented? | Report "not supported" for now | Add in a second phase |

---

## 13. Changelog

| Date | Change |
|---|---|
| 2026-04-29 | Initial spec created (based on binary decompilation + an inventory of existing repo infrastructure) |
