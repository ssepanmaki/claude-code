# Task 013: BgEngine cross-platform background engine abstraction

> Design doc: [daemon-restructure-design.md](../features/daemon-restructure-design.md) § 4
> Depends on: none
> Branch: `feat/integrate-5-branches`

## Goal

Extract the hard-coded tmux logic in `src/cli/bg.ts` into an engine abstraction layer and implement TmuxEngine + DetachedEngine, so background sessions work on Windows, macOS and Linux.

## Background

Today `handleBgFlag()` and `attachHandler()` in `bg.ts` call tmux directly, and `--bg` exits with an error on Windows. An engine abstraction layer should pick the best option automatically based on the platform and available tools.

## Files

### New

| File | Description |
|------|------|
| `src/cli/bg/engine.ts` | BgEngine interface + BgStartOptions/BgStartResult types |
| `src/cli/bg/engines/tmux.ts` | TmuxEngine: tmux logic extracted from `bg.ts` |
| `src/cli/bg/engines/detached.ts` | DetachedEngine: spawn({ detached }) + logFile redirection |
| `src/cli/bg/engines/index.ts` | selectEngine() auto-selection + re-export |
| `src/cli/bg/tail.ts` | Cross-platform log tail: fs.watch + polling fallback |

### Modified

| File | Change |
|------|------|
| `src/cli/bg.ts` | `handleBgFlag()` now calls `selectEngine().start()`; `attachHandler()` now calls `engine.attach()` |

## Implementation

### 1. BgEngine interface (`src/cli/bg/engine.ts`)

```typescript
export interface BgEngine {
  readonly name: string
  available(): Promise<boolean>
  start(opts: BgStartOptions): Promise<BgStartResult>
  attach(session: SessionEntry): Promise<void>
}

export interface BgStartOptions {
  sessionName: string
  args: string[]         // CLI args (without --bg)
  env: Record<string, string | undefined>
  logPath: string
  cwd: string
}

export interface BgStartResult {
  pid: number
  sessionName: string
  logPath: string
  engineUsed: 'tmux' | 'detached'
}
```

### 2. TmuxEngine (`src/cli/bg/engines/tmux.ts`)

Extracted from `bg.ts:handleBgFlag()` and `bg.ts:attachHandler()`:
- `available()`: `execFileNoThrow('tmux', ['-V'])` returns code === 0
- `start()`: `tmux new-session -d -s <name> <cmd>`
- `attach()`: `tmux attach-session -t <session.tmuxSessionName>`

### 3. DetachedEngine (`src/cli/bg/engines/detached.ts`)

```typescript
export class DetachedEngine implements BgEngine {
  readonly name = 'detached'

  async available(): Promise<boolean> {
    return true  // always available
  }

  async start(opts: BgStartOptions): Promise<BgStartResult> {
    const logFd = openSync(opts.logPath, 'a')
    const child = spawn(process.execPath, [process.argv[1]!, ...opts.args], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: opts.env,
      cwd: opts.cwd,
    })
    child.unref()
    closeSync(logFd)

    return {
      pid: child.pid!,
      sessionName: opts.sessionName,
      logPath: opts.logPath,
      engineUsed: 'detached',
    }
  }

  async attach(session: SessionEntry): Promise<void> {
    // delegate to tail.ts
    await tailLog(session.logPath!)
  }
}
```

### 4. Log tail (`src/cli/bg/tail.ts`)

```typescript
/**
 * Cross-platform live log output. Ctrl+C exits without killing the background process.
 *
 * Strategy:
 * 1. Print the existing content
 * 2. Watch the file with fs.watch() (primary)
 * 3. If fs.watch is unreliable (some Windows network drives), fall back to 500ms polling
 */
export async function tailLog(logPath: string): Promise<void>
```

### 5. Engine selection (`src/cli/bg/engines/index.ts`)

```typescript
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

### 6. bg.ts refactor

`handleBgFlag()` is renamed to `handleBgStart()`, with this logic:
```typescript
export async function handleBgStart(args: string[]): Promise<void> {
  const engine = await selectEngine()
  const sessionName = `claude-bg-${randomUUID().slice(0, 8)}`
  const logPath = join(getClaudeConfigHomeDir(), 'sessions', 'logs', `${sessionName}.log`)

  const result = await engine.start({
    sessionName,
    args: filteredArgs,
    env: { ...process.env, CLAUDE_CODE_SESSION_KIND: 'bg', ... },
    logPath,
    cwd: process.cwd(),
  })

  console.log(`Background session started: ${result.sessionName}`)
  console.log(`  Engine: ${result.engineUsed}`)
  console.log(`  Log: ${result.logPath}`)
  console.log(`  Use \`claude daemon attach ${result.sessionName}\` to reconnect.`)
}
```

`attachHandler()` picks the engine from the `session.engine` field:
```typescript
export async function attachHandler(target: string | undefined): Promise<void> {
  // ... find the session
  if (session.engine === 'tmux' && session.tmuxSessionName) {
    const tmux = new TmuxEngine()
    await tmux.attach(session)
  } else {
    const detached = new DetachedEngine()
    await detached.attach(session)
  }
}
```

## SessionEntry extension

`sessions/<PID>.json` gains an `engine` field:

```json
{
  "pid": 12345,
  "engine": "detached",
  "logPath": "~/.claude/sessions/logs/claude-bg-a1b2c3d4.log",
  "sessionId": "...",
  "cwd": "..."
}
```

Backward compatibility: if `engine` is missing, treat the session as `tmux` when `tmuxSessionName` exists, otherwise as `detached`.

## Verification checklist

- [ ] Windows: `claude daemon bg` starts a background session with no tmux dependency
- [ ] Windows: `claude daemon attach <name>` attaches in tail mode; Ctrl+C exits without killing the process
- [ ] macOS/Linux (with tmux): behavior unchanged
- [ ] macOS/Linux (without tmux): automatically falls back to the detached engine
- [ ] `claude daemon status` shows the engine type correctly
- [ ] Old-format session JSON (no engine field) still works
- [ ] tsc --noEmit zero errors
- [ ] bun test passes
