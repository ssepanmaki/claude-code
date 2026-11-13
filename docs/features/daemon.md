# DAEMON — Background daemon process

> Feature Flag: `FEATURE_DAEMON=1`
> Implementation status: the Supervisor and the remoteControl Worker are implemented
> References: 3

## 1. Overview

DAEMON turns Claude Code into a background daemon process. The main process (supervisor) manages the lifecycle of several worker child processes and communicates through filesystem state files. It suits always-on background service scenarios (for example providing a remote-control service together with BRIDGE_MODE).

## 2. Implementation architecture

### 2.1 Module status

| Module | File | Status |
|--------|------|--------|
| Daemon main process | `src/daemon/main.ts` | **Implemented** — Supervisor with subcommands, Worker lifecycle management, exponential-backoff restart |
| Worker registry | `src/daemon/workerRegistry.ts` | **Implemented** — remoteControl Worker (headless bridge) |
| Daemon state | `src/daemon/state.ts` | **Implemented** — read/write/query of the PID/state file |
| CLI routing | `src/entrypoints/cli.tsx` | **Wired** — `--daemon-worker` and the `daemon` subcommand |
| Command registration | `src/commands.ts` | **Wired** — gated by DAEMON + BRIDGE_MODE |

### 2.2 CLI entry points

```
# Start the daemon
claude daemon start

# Show status (default subcommand)
claude daemon status
claude daemon ps

# Stop the daemon
claude daemon stop

# Start as a worker (called automatically by the supervisor)
claude --daemon-worker=remoteControl

# Background session management
claude daemon bg
claude daemon attach <session>
claude daemon logs <session>
claude daemon kill <session>
```

### 2.3 Architecture

```
Supervisor (daemonMain)
      │
      ├── Worker: remoteControl
      │   └── runBridgeHeadless() — remote-control headless mode
      │       receives remote sessions, handles messages, permission approval
      │
      ▼
Filesystem state file (daemon-state.json)
  - PID, CWD, start time, Worker kinds
  - queryDaemonStatus() / stopDaemonByPid()
```

### 2.4 Worker lifecycle management

For each worker the supervisor implements:
- **Exponential-backoff restart**: initial 2s, cap 120s, factor ×2
- **Fast-failure detection**: 5 consecutive crashes within 10s cause parking (no more restarts)
- **Permanent-error exit code**: 78 (EXIT_CODE_PERMANENT) causes immediate parking
- **Graceful shutdown**: SIGTERM/SIGINT → abort signal → forced SIGKILL after 30s

### 2.5 Relation to BRIDGE_MODE

DAEMON and BRIDGE_MODE are often used together:

```ts
// src/commands.ts
if (feature('DAEMON') && feature('BRIDGE_MODE')) {
  // load the remoteControlServer command
}
```

Double gating: both features must be enabled to use the remote-control server.

## 3. Key design decisions

1. **Multi-process architecture**: one supervisor + several workers, with process isolation
2. **Filesystem state communication**: state is shared through the `daemon-state.json` file (not a Unix domain socket)
3. **Tightly bound to BRIDGE_MODE**: the most common use of the daemon is to provide the remote-control service
4. **CLI subcommand routing**: the `daemon` subcommand and the `--daemon-worker` argument are routed in `cli.tsx`
5. **Worker environment variables**: the supervisor passes configuration to workers through environment variables (`DAEMON_WORKER_*`)

## 4. Usage

```bash
# Enable daemon mode
FEATURE_DAEMON=1 FEATURE_BRIDGE_MODE=1 bun run dev

# Start the daemon
claude daemon start

# Show status
claude daemon status

# Stop the daemon
claude daemon stop

# Start as a specific worker (usually called automatically by the supervisor)
claude --daemon-worker=remoteControl
```

## 5. File index

| File | Responsibility |
|------|----------------|
| `src/daemon/main.ts` | Supervisor main process: subcommand dispatch, Worker lifecycle management, backoff restart |
| `src/daemon/workerRegistry.ts` | Worker entry: remoteControl worker implementation |
| `src/daemon/state.ts` | Daemon state management: PID file read/write, status queries |
| `src/entrypoints/cli.tsx` | CLI routing |
| `src/commands.ts` | Command registration (double gating) |
