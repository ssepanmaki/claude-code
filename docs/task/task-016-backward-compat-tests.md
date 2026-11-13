# Task 016: Backward compatibility + tests

> Design doc: [daemon-restructure-design.md](../features/daemon-restructure-design.md) § 5
> Depends on: Task 014, Task 015
> Branch: `feat/integrate-5-branches`

## Goal

Make sure the old commands stay backward compatible (deprecation warning + normal proxying), and write tests for the restructured command layout.

## File list

### New

| File | Description |
|------|-------------|
| `src/daemon/__tests__/daemonMain.test.ts` | daemonMain subcommand routing tests |
| `src/cli/bg/__tests__/engine.test.ts` | BgEngine selection logic tests |
| `src/cli/bg/__tests__/detached.test.ts` | DetachedEngine start/stop tests |
| `src/cli/bg/__tests__/tail.test.ts` | Log tail feature tests |

### Modified

| File | Change |
|------|--------|
| `src/entrypoints/cli.tsx` | Confirm the deprecation path proxies correctly |

## Implementation plan

### 1. Backward compatibility matrix

| Old command | New command | Handling |
|-------------|-------------|----------|
| `claude ps` | `claude daemon status` | Print `[deprecated] Use: claude daemon status` to stderr, then run it |
| `claude logs <x>` | `claude daemon logs <x>` | Same as above |
| `claude attach <x>` | `claude daemon attach <x>` | Same as above |
| `claude kill <x>` | `claude daemon kill <x>` | Same as above |
| `claude --bg` | `claude daemon bg` | Kept as a shortcut and **not** deprecated (too commonly used) |
| `claude new <t>` | `claude job new <t>` | stderr deprecation + run |
| `claude list` | `claude job list` | stderr deprecation + run |
| `claude reply <id>` | `claude job reply <id>` | stderr deprecation + run |

**Key point**: the deprecation notice goes to stderr rather than stdout so script pipelines are unaffected.

### 2. Test plan

#### 2.1 daemonMain routing tests

```typescript
describe('daemonMain', () => {
  test('defaults to status with no arguments', async () => { ... })
  test('start calls runSupervisor', async () => { ... })
  test('stop calls handleDaemonStop', async () => { ... })
  test('bg delegates to bg.handleBgStart', async () => { ... })
  test('attach delegates to bg.attachHandler', async () => { ... })
  test('logs delegates to bg.logsHandler', async () => { ... })
  test('kill delegates to bg.killHandler', async () => { ... })
  test('an unknown subcommand sets exitCode=1', async () => { ... })
})
```

#### 2.2 Engine selection tests

```typescript
describe('selectEngine', () => {
  test('win32 returns DetachedEngine', async () => { ... })
  test('darwin + tmux available returns TmuxEngine', async () => { ... })
  test('darwin + tmux unavailable returns DetachedEngine', async () => { ... })
  test('linux + tmux available returns TmuxEngine', async () => { ... })
})
```

#### 2.3 DetachedEngine tests

```typescript
describe('DetachedEngine', () => {
  test('available always returns true', async () => { ... })
  test('start creates a detached child process and writes the log', async () => { ... })
  test('the PID file returned by start exists', async () => { ... })
})
```

#### 2.4 Tail tests

```typescript
describe('tailLog', () => {
  test('prints existing log content', async () => { ... })
  test('prints appended content in real time', async () => { ... })
  test('SIGINT exits the tail', async () => { ... })
})
```

### 3. Integration verification script

Optional: add a manual verification script under `scripts/`:

```bash
#!/bin/bash
# scripts/verify-daemon-restructure.sh
echo "=== 1. claude daemon status ==="
bun run dev -- daemon status

echo "=== 2. claude daemon bg (should start) ==="
bun run dev -- daemon bg --help

echo "=== 3. claude ps (deprecated) ==="
bun run dev -- ps 2>&1 | head -1

echo "=== 4. claude job list ==="
bun run dev -- job list

echo "=== 5. claude list (deprecated) ==="
bun run dev -- list 2>&1 | head -1
```

## Verification checklist

- [ ] All old commands still work (only one extra stderr warning line)
- [ ] `--bg` stays warning-free
- [ ] All new tests pass
- [ ] No regressions in the existing 2695 tests
- [ ] tsc --noEmit reports zero errors
- [ ] Manually verify the key paths on Windows + macOS/Linux
