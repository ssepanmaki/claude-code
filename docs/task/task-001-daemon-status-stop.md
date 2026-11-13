# Task 001: daemon status / stop

> Source: item 1 of [stub-recovery-design-1-4.md](../features/stub-recovery-design-1-4.md)
> Priority: P0 (first item to implement)
> Effort: small
> Status: DONE

## Goal

Make `claude daemon status` and `claude daemon stop` work correctly from any CLI process, without depending on in-memory TUI state.

## Background

- The `start` path already has a complete supervisor + worker lifecycle (`src/daemon/main.ts`, `src/daemon/workerRegistry.ts`)
- `status` / `stop` are currently only placeholder output (`src/daemon/main.ts:49`)
- `/remote-control-server` has its own in-command UI state, but it only tracks the `daemonProcess` inside the current process, which is unsuitable for cross-process management

## Implementation plan

### New files

| File | Description |
|------|-------------|
| `src/daemon/state.ts` | Read/write module for the daemon state file |

### Modified files

| File | Change |
|------|--------|
| `src/daemon/main.ts` | `start` writes the state file; `status`/`stop` call the state module |
| `src/commands/remoteControlServer/remoteControlServer.tsx` | Reads the same state file (light change) |

### State file

Path: `~/.claude/daemon/remote-control.json`

```json
{
  "pid": 12345,
  "cwd": "/path/to/project",
  "startedAt": "2026-04-12T10:00:00Z",
  "workerKinds": ["bridge", "rcs"],
  "lastStatus": "running"
}
```

### status logic

1. Read the state file
2. Verify with a process probe that the pid is alive
3. Print `running` / `stopped` / `stale`
4. When stale, clean up the state file automatically

### stop logic

1. Read the pid
2. Send `SIGTERM`
3. Wait for exit (with a timeout fallback)
4. After the timeout, `SIGKILL`
5. Clean up the state file

## Verification steps

- [ ] `claude daemon start` starts normally and writes the state file
- [ ] Running `claude daemon status` in a new terminal shows `running`
- [ ] Running `claude daemon stop` makes the daemon exit normally
- [ ] Running `claude daemon status` again returns `stopped` or `stale cleaned`
- [ ] The stop timeout fallback works on Windows

## Risks

- The Windows signal model differs from Unix, so `stop` needs a timeout fallback
- The current design assumes a single supervisor and does not handle concurrent multiple instances

## Dependencies

No external dependencies; can be implemented independently.
