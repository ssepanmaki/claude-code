# Daemon Restructure Design

> Branch: `feat/integrate-5-branches`
> Based on: `f41745cb` (= main `11bb3f62` content)
> Date: 2026-04-13

## 1. Problem overview

### 1.1 Scattered command structure

Today the commands for background processes are spread across three places, with no unified namespace:

| Command | Registered in | Entry |
|------|---------|------|
| `claude daemon start/status/stop` | `cli.tsx` fast path L203 | `daemon/main.ts` |
| `claude ps` | `cli.tsx` fast path L220 | `cli/bg.ts` |
| `claude logs <x>` | `cli.tsx` fast path L232 | `cli/bg.ts` |
| `claude attach <x>` | `cli.tsx` fast path L236 | `cli/bg.ts` |
| `claude kill <x>` | `cli.tsx` fast path L238 | `cli/bg.ts` |
| `claude --bg` | `cli.tsx` fast path L244 | `cli/bg.ts` |
| `claude new/list/reply` | `cli.tsx` fast path L250 | `cli/handlers/templateJobs.ts` |
| `claude rollback` | `main.tsx` Commander.js L6525 | `cli/rollback.ts` |
| `claude up` | `main.tsx` Commander.js L6511 | `cli/up.ts` |

**Problems**:
- `ps/logs/attach/kill` and `daemon` are all background-process management, yet they are unrelated to each other
- These commands have **only a CLI entry**; typing `/daemon` or `/ps` in the REPL does not work
- `new/list/reply` are top-level commands of the template job system, which easily collide with other commands (especially `list`)

### 1.2 No Windows support

`--bg` and `attach` hard-depend on tmux:
- `bg.ts:handleBgFlag()` checks for tmux as its first step and exits with an error if it is unavailable
- `bg.ts:attachHandler()` uses `tmux attach-session`, with no tmux alternative
- Windows (including the VS Code terminal) cannot use background sessions at all

### 1.3 No REPL entry

Compare the dual-registration pattern of `/mcp`:
- **CLI**: `claude mcp serve/add/remove/list` (Commander.js, `main.tsx:5760`)
- **REPL**: `/mcp enable/disable/reconnect` (slash command, `commands/mcp/index.ts`)

The `daemon`/`bg`/`job` family has only a CLI fast path and is entirely unavailable in the REPL.

## 2. Goals

1. **Hierarchical command structure**: following the `/mcp` pattern, consolidate background management under `/daemon` and template jobs under `/job`
2. **Cross-platform background sessions**: Windows / macOS / Linux can all start, attach to, and terminate background sessions
3. **Dual registration**: both the CLI (`claude daemon ...`) and the REPL (`/daemon ...`) work
4. **Backward compatibility**: old commands are kept but print a deprecation notice

## 3. Command structure design

### 3.1 `/daemon` — background process management

Merges the daemon supervisor and bg sessions into one namespace:

```
claude daemon <subcommand>     ← CLI entry (cli.tsx fast path)
/daemon <subcommand>           ← REPL entry (slash command, local-jsx)

Subcommands:
  status                       Combined status panel (daemon + all sessions)
  start [--dir <path>]         Start the daemon supervisor
  stop                         Stop the daemon
  bg [args...]                 Start a background session
  attach [target]              Attach to a background session
  logs [target]                View session logs
  kill [target]                Terminate a session
  (no arguments)               Same as status
```

**CLI fast-path routing** (`cli.tsx`):
```typescript
// New: unified entry
if (feature('DAEMON') && args[0] === 'daemon') {
  const sub = args[1] || 'status'
  switch (sub) {
    case 'start': case 'stop': case 'status':
      await daemonMain([sub, ...args.slice(2)])
      break
    case 'bg':
      await bg.handleBgStart(args.slice(2))
      break
    case 'attach': case 'logs': case 'kill':
      await bg[`${sub}Handler`](args[2])
      break
  }
}

// Backward compatibility (deprecated)
if (feature('BG_SESSIONS') && ['ps','logs','attach','kill'].includes(args[0])) {
  console.warn(`[deprecated] Use: claude daemon ${args[0] === 'ps' ? 'status' : args[0]}`)
  // ... delegate to daemon subcommand
}
```

**REPL slash command** (`commands/daemon/index.ts`):
```typescript
const daemon = {
  type: 'local-jsx',
  name: 'daemon',
  description: 'Manage background sessions and daemon',
  argumentHint: '[status|start|stop|bg|attach|logs|kill]',
  isEnabled: () => feature('DAEMON') || feature('BG_SESSIONS'),
  load: () => import('./daemon.js'),
} satisfies Command
```

### 3.2 `/job` — template job management

```
claude job <subcommand>        ← CLI entry
/job <subcommand>              ← REPL entry

Subcommands:
  list                         List templates and active jobs
  new <template> [args]        Create a job from a template
  reply <id> <text>            Reply to a job
  status <id>                  View job status
  (no arguments)               Same as list
```

### 3.3 Standalone commands (unchanged)

```
claude up                      Stays top-level (a short bootstrap command)
claude rollback [target]       Stays top-level (a low-frequency ops command)
```

## 4. Cross-platform background engine

### 4.1 Engine abstraction

```typescript
// src/cli/bg/engine.ts
export interface BgEngine {
  readonly name: string

  /** Whether this engine is available on the current platform */
  available(): Promise<boolean>

  /** Start a background session */
  start(opts: BgStartOptions): Promise<BgStartResult>

  /** Attach to a background session (blocking) */
  attach(session: SessionEntry): Promise<void>
}

export interface BgStartOptions {
  sessionName: string
  args: string[]
  env: Record<string, string | undefined>
  logPath: string
  cwd: string
}

export interface BgStartResult {
  pid: number
  sessionName: string
  logPath: string
  engineUsed: string
}
```

### 4.2 Two engine implementations

| Engine | Platform | How it starts | How it attaches |
|------|------|---------|------------|
| TmuxEngine | macOS/Linux (with tmux) | `tmux new-session -d` | `tmux attach-session` |
| DetachedEngine | Windows / macOS/Linux without tmux | `spawn({ detached, stdio→logFile })` | `tail -f` on the log file |

#### DetachedEngine in detail

**Start (`start`)**:
```typescript
// 1. Open a file descriptor for the log file
const logFd = fs.openSync(logPath, 'a')
// 2. Detached spawn, with stdout/stderr redirected to the log
const child = spawn(process.execPath, execArgs, {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env,
  cwd,
})
child.unref()
fs.closeSync(logFd)
// 3. Write sessions/<PID>.json
```

**Attach (`attach`)**:
```typescript
// Cross-platform tail -f implementation
// 1. Read the existing log content and print it to stdout
// 2. Watch for changes with fs.watch(logPath)
// 3. Read the newly appended content on each change
// 4. Ctrl+C exits the tail (does not kill the background process)
```

#### Engine selection logic

```typescript
// src/cli/bg/engines/index.ts
export async function selectEngine(): Promise<BgEngine> {
  if (process.platform === 'win32') {
    return new DetachedEngine()
  }

  const tmux = new TmuxEngine()
  if (await tmux.available()) {
    return tmux
  }

  return new DetachedEngine()
}
```

### 4.3 SessionEntry extension

```typescript
interface SessionEntry {
  // ... existing fields
  engine: 'tmux' | 'detached'   // New: records which engine was used
  tmuxSessionName?: string       // Only for the tmux engine
  logPath?: string               // Both engines have it
}
```

On `attach`, the matching attach strategy is chosen based on `session.engine`.

## 5. File change list

### New files (10)

```
src/cli/bg/engine.ts                   BgEngine interface definition
src/cli/bg/engines/tmux.ts             TmuxEngine (extracted from bg.ts)
src/cli/bg/engines/detached.ts         DetachedEngine (new implementation)
src/cli/bg/engines/index.ts            Engine selection + re-exports
src/cli/bg/tail.ts                     Cross-platform log tail (used by detached attach)
src/commands/daemon/index.ts           /daemon REPL slash command registration
src/commands/daemon/daemon.tsx         /daemon subcommand routing + status UI
src/commands/job/index.ts              /job REPL slash command registration
src/commands/job/job.tsx               /job subcommand routing + UI
docs/features/daemon-restructure-design.md  This design document
```

### Modified files (6)

```
src/cli/bg.ts                          Refactor: handler functions call BgEngine
src/entrypoints/cli.tsx                Fast path: unified daemon entry + backward compatibility
src/commands.ts                        Register the /daemon and /job slash commands
src/daemon/main.ts                     daemonMain() gains bg/ps/logs subcommand dispatch
src/main.tsx                           Commander.js: optionally register daemon/job subcommands
src/cli/handlers/templateJobs.ts       Adapt to the /job entry (may need no change)
```

### Files left untouched

```
src/daemon/state.ts                    Daemon PID state management (no change needed)
src/jobs/state.ts                      Job state management (no change needed)
src/jobs/templates.ts                  Template discovery (no change needed)
src/jobs/classifier.ts                 Job classifier (no change needed)
src/cli/rollback.ts                    Stays a top-level command (no change needed)
src/cli/up.ts                          Stays a top-level command (no change needed)
```

## 6. Feasibility analysis

### 6.1 Risk assessment

| Risk | Level | Mitigation |
|------|------|---------|
| Changing the cli.tsx fast path affects startup performance | Low | Only the routing logic changes; imports stay lazy |
| fs.watch is unreliable for DetachedEngine's attach on Windows | Medium | Use a polling fallback (setInterval + fs.stat) |
| Backward-compat deprecation may break scripts | Low | Old commands stay available and only print a stderr warning |
| `/daemon bg` in the REPL needs to spawn a child process | Medium | Follow /assistant's NewInstallWizard (an existing spawn precedent) |
| tsc type compatibility | Low | Clear interface definitions, no `any` introduced |

### 6.2 Effort estimate

| Task | Files | Complexity |
|------|--------|--------|
| Task 013: BgEngine abstraction + engine implementations | 5 new + 1 modified | Medium |
| Task 014: Hierarchical /daemon command | 3 new + 3 modified | Medium |
| Task 015: Hierarchical /job command | 2 new + 2 modified | Low |
| Task 016: Backward compatibility + tests | 0 new + 2 modified | Low |

### 6.3 Dependencies

```
Task 013 (BgEngine) ← no dependencies, can be developed independently
Task 014 (/daemon)  ← depends on Task 013 (engine selection)
Task 015 (/job)     ← no dependencies, can run in parallel with 013
Task 016 (compat)   ← depends on Task 014 + 015
```

## 7. Design decision record

### D1: Why merge the daemon and bg sessions into one namespace?

From the user's perspective, both are "things running in the background". Keeping them apart means `claude daemon status` shows the supervisor while `claude ps` shows the sessions, which feels disjointed. Once merged, `claude daemon status` shows the supervisor state and all sessions at once.

### D2: Why are rollback/up not folded into daemon?

They are fundamentally **version management / environment initialization**, not background process management. `claude up` is a synchronous, blocking setup script and involves neither the daemon nor background sessions. Keeping them top-level is more intuitive.

### D3: Why does DetachedEngine's attach use tail instead of IPC?

1. A log file is the simplest cross-platform approach and needs no extra dependencies
2. The UDS Pipe IPC system (usePipeIpc) is designed for communication between instances, not for terminal attachment
3. The experience of tmux attach (a full PTY) cannot be reproduced in pure detached mode, and tail is the most honest substitute

### D4: Why not use the Windows Terminal tab/pane API?

The new window/tab features of Windows Terminal's `wt.exe` are not general enough: users may be in VS Code, ConEmu, cmder, or other terminals. Detached + log is the only approach that works across terminals.
