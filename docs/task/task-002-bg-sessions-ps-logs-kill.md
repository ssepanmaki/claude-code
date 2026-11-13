# Task 002: BG_SESSIONS — ps / logs / kill

> Source: item 2 of [stub-recovery-design-1-4.md](../features/stub-recovery-design-1-4.md)
> Priority: P1
> Effort: medium
> Status: DONE
> Phase: Phase 2A (MVP)

## Goal

Turn `ps` / `logs` / `kill` into genuinely useful session-management commands. `attach` / `--bg` are not completed in the first phase.

## Background

- The fast path is already wired (`src/entrypoints/cli.tsx:218`)
- The session registry has a real implementation (`src/utils/concurrentSessions.ts`)
- `exit` inside a bg session already does `tmux detach-client` (`src/commands/exit/exit.tsx:20`)
- The CLI handler is still empty (`src/cli/bg.ts`)
- The task summary is still a stub (`src/utils/taskSummary.ts`)

## Implementation plan

### Modified files

| File | Change |
|------|--------|
| `src/cli/bg.ts` | Implement the `ps` / `logs` / `kill` handlers |
| `src/utils/concurrentSessions.ts` | Extend so that attach/--bg can use it later |
| `src/utils/taskSummary.ts` | Add a basic implementation |

### Reused modules

- `src/utils/sessionStorage.ts` — session storage
- `src/utils/udsClient.ts` — UDS communication

### ps command

- Read live sessions from the registry
- Show: pid, kind, sessionId, cwd, name, startedAt, bridgeSessionId
- If there is activity/status, show it as well

### logs command

- Support lookup by `sessionId` / `pid` / `name`
- Prefer reusing the local transcript/log reading capability
- If the registry has a `logPath`, support tailing the file

### kill command

- Resolve the target session
- Send an exit signal
- Clean up the stale registry entry

## Verification steps

- [ ] `ps` lists the current live sessions
- [ ] `logs <sessionId|pid|name>` prints the matching log
- [ ] `kill <sessionId|pid|name>` ends the target session and cleans up the registry
- [ ] Each command gives a clear message when there is no live session

## Phase 2B (later)

- [ ] Implement `attach`
- [ ] Implement `--bg`
- [ ] Implement mid-run status updates for `taskSummary`

### Why it is split

- The existing registry records `pid / sessionId / name / logPath`
- But there is no reliable tmux attach target
- `attach` and `--bg` need a design for launch/attach metadata; they are not a simple handler fill-in

## Risks

- Phase 2 `attach` / `--bg` needs a tmux metadata design
- On Windows the tmux path needs an explicit degradation strategy

## Dependencies

- Task 001 (the daemon state-management pattern can be reused, but it is not a hard dependency)
