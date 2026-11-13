# Task 014: Hierarchical /daemon command

> Design doc: [daemon-restructure-design.md](../features/daemon-restructure-design.md) § 3.1
> Depends on: Task 013 (BgEngine abstraction)
> Branch: `feat/integrate-5-branches`

## Goal

Bring the scattered `daemon start/stop/status`, `ps/logs/attach/kill` and `--bg` under one `/daemon` namespace, registered in both the CLI and the REPL.

## Background

These commands are currently registered in two unrelated places:
- `cli.tsx:203-212`: `daemon [start|status|stop]` → `daemon/main.ts`
- `cli.tsx:217-246`: `ps|logs|attach|kill|--bg` → `cli/bg.ts`

They should be merged into a single `claude daemon <subcommand>` entry point, plus a new REPL `/daemon` slash command.

## Files

### New

| File | Description |
|------|------|
| `src/commands/daemon/index.ts` | `/daemon` REPL slash command registration (type: local-jsx) |
| `src/commands/daemon/daemon.tsx` | `/daemon` subcommand routing + status UI component |

### Modified

| File | Change |
|------|------|
| `src/entrypoints/cli.tsx` | Unified daemon fast path: `daemon <sub>` routes to the matching handler. The old `ps/logs/attach/kill` commands stay but print a deprecation warning and then proxy |
| `src/commands.ts` | Registers the `/daemon` slash command (feature-gated: DAEMON \|\| BG_SESSIONS) |
| `src/daemon/main.ts` | `daemonMain()` extended to support the `bg/attach/logs/kill/ps` subcommands (delegating to the bg.ts handlers) |

## Implementation

### 1. Unify the CLI fast path (`cli.tsx`)

**Before** (two independent routes):
```typescript
// Block 1: daemon
if (feature('DAEMON') && args[0] === 'daemon') {
  await daemonMain(args.slice(1))
}
// Block 2: bg sessions
if (feature('BG_SESSIONS') && ['ps','logs','attach','kill'].includes(args[0])) {
  // ...switch/case
}
```

**After** (single entry point):
```typescript
// Unified daemon entry — merges the daemon supervisor and bg sessions
if (
  (feature('DAEMON') || feature('BG_SESSIONS')) &&
  args[0] === 'daemon'
) {
  profileCheckpoint('cli_daemon_path')
  const { enableConfigs } = await import('../utils/config.js')
  enableConfigs()
  const { initSinks } = await import('../utils/sinks.js')
  initSinks()
  const { daemonMain } = await import('../daemon/main.js')
  await daemonMain(args.slice(1))
  return
}

// --bg shortcut → daemon bg
if (
  feature('BG_SESSIONS') &&
  (args.includes('--bg') || args.includes('--background'))
) {
  profileCheckpoint('cli_daemon_path')
  const { enableConfigs } = await import('../utils/config.js')
  enableConfigs()
  const bg = await import('../cli/bg.js')
  await bg.handleBgStart(args.filter(a => a !== '--bg' && a !== '--background'))
  return
}

// Backward compatibility: ps/logs/attach/kill → daemon <sub> (deprecated)
if (
  feature('BG_SESSIONS') &&
  ['ps', 'logs', 'attach', 'kill'].includes(args[0] ?? '')
) {
  const mapped = args[0] === 'ps' ? 'status' : args[0]
  console.error(`[deprecated] Use: claude daemon ${mapped} ${args.slice(1).join(' ')}`.trim())
  const { enableConfigs } = await import('../utils/config.js')
  enableConfigs()
  const { daemonMain } = await import('../daemon/main.js')
  await daemonMain([args[0]!, ...args.slice(1)])
  return
}
```

### 2. daemonMain extension (`daemon/main.ts`)

```typescript
export async function daemonMain(args: string[]): Promise<void> {
  const subcommand = args[0] || 'status'

  switch (subcommand) {
    // --- Supervisor management ---
    case 'start':
      await runSupervisor(args.slice(1))
      break
    case 'stop':
      await handleDaemonStop()
      break

    // --- Session management (delegated to bg.ts) ---
    case 'status':
    case 'ps':
      await showUnifiedStatus()  // new: daemon status + session list
      break
    case 'bg':
      const bg = await import('../cli/bg.js')
      await bg.handleBgStart(args.slice(1))
      break
    case 'attach':
      const bg2 = await import('../cli/bg.js')
      await bg2.attachHandler(args[1])
      break
    case 'logs':
      const bg3 = await import('../cli/bg.js')
      await bg3.logsHandler(args[1])
      break
    case 'kill':
      const bg4 = await import('../cli/bg.js')
      await bg4.killHandler(args[1])
      break

    case '--help': case '-h': case 'help':
      printHelp()
      break
    default:
      console.error(`Unknown daemon subcommand: ${subcommand}`)
      printHelp()
      process.exitCode = 1
  }
}
```

### 3. Unified status panel (`showUnifiedStatus`)

```typescript
async function showUnifiedStatus(): Promise<void> {
  // 1. Daemon supervisor status
  const daemonResult = queryDaemonStatus()
  console.log('=== Daemon Supervisor ===')
  switch (daemonResult.status) {
    case 'running':
      console.log(`  Status: running (PID: ${daemonResult.state!.pid})`)
      console.log(`  Workers: ${daemonResult.state!.workerKinds.join(', ')}`)
      break
    case 'stopped':
      console.log('  Status: stopped')
      break
    case 'stale':
      console.log('  Status: stale (cleaned up)')
      break
  }

  // 2. Background session list
  console.log('\n=== Background Sessions ===')
  const bg = await import('../cli/bg.js')
  await bg.psHandler([])
}
```

### 4. REPL slash command registration

**`src/commands/daemon/index.ts`**:
```typescript
import type { Command } from '../../commands.js'
import { feature } from 'bun:bundle'

const daemon = {
  type: 'local-jsx',
  name: 'daemon',
  description: 'Manage background sessions and daemon',
  argumentHint: '[status|start|stop|bg|attach|logs|kill]',
  isEnabled: () => {
    if (feature('DAEMON')) return true
    if (feature('BG_SESSIONS')) return true
    return false
  },
  load: () => import('./daemon.js'),
} satisfies Command

export default daemon
```

**`src/commands/daemon/daemon.tsx`**:
```typescript
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'status'

  switch (sub) {
    case 'status':
    case 'ps':
      // call showUnifiedStatus and capture its output
      // return the text result
      break
    case 'bg':
      // start a background session from the REPL
      break
    case 'start':
    case 'stop':
    case 'attach':
    case 'logs':
    case 'kill':
      // delegate to the matching handler
      break
    default:
      onDone(`Unknown: ${sub}. Use: status|start|stop|bg|attach|logs|kill`)
      return null
  }
}
```

**`src/commands.ts`** adds:
```typescript
// conditional import
const daemonCmd =
  feature('DAEMON') || feature('BG_SESSIONS')
    ? require('./commands/daemon/index.js').default
    : null

// add to the COMMANDS array
...(daemonCmd ? [daemonCmd] : []),
```

### 5. Update the help text (`daemon/main.ts`)

```
Claude Code Daemon — background process management

USAGE
  claude daemon [subcommand]

SUBCOMMANDS
  status      Show daemon and session status (default)
  start       Start the daemon supervisor
  stop        Stop the daemon
  bg          Start a background session
  attach      Attach to a background session
  logs        Show session logs
  kill        Kill a session
  help        Show this help

REPL
  /daemon [subcommand]    Same commands available in interactive mode
```

## Verification checklist

- [ ] `claude daemon` (no arguments) shows the unified status panel
- [ ] `claude daemon status` shows the supervisor and the session list
- [ ] `claude daemon start/stop` behaves as it does today
- [ ] `claude daemon bg` starts a background session (via BgEngine)
- [ ] `claude daemon attach/logs/kill <target>` work
- [ ] `claude ps` prints a deprecation warning and still works
- [ ] `claude logs/attach/kill` same as above
- [ ] `claude --bg` shortcut works
- [ ] `/daemon` is available in the REPL and shows in tab completion
- [ ] `/daemon status` in the REPL shows status information
- [ ] tsc --noEmit zero errors
- [ ] bun test passes
