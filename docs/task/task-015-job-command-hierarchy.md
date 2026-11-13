# Task 015: Hierarchical /job command

> Design doc: [daemon-restructure-design.md](../features/daemon-restructure-design.md) § 3.2
> Depends on: none (can run in parallel with Task 013)
> Branch: `feat/integrate-5-branches`

## Goal

Move `claude new/list/reply` under the `/job` namespace, registered in both the CLI and the REPL.

## Background

`new`, `list` and `reply` are currently top-level CLI commands (`cli.tsx:250-261`), which makes them prone to clashing with other commands (especially a generic word like `list`). They should move under `claude job <subcommand>`, with a new REPL `/job` entry.

## Files

### New

| File | Description |
|------|------|
| `src/commands/job/index.ts` | `/job` REPL slash command registration |
| `src/commands/job/job.tsx` | `/job` subcommand routing |

### Modified

| File | Change |
|------|------|
| `src/entrypoints/cli.tsx` | Adds the `job` fast path + a deprecation proxy for the old `new/list/reply` |
| `src/commands.ts` | Registers the `/job` slash command |

### Unchanged

| File | Description |
|------|------|
| `src/cli/handlers/templateJobs.ts` | Internal handlers are unchanged; only how they are called changes |
| `src/jobs/state.ts` | Job state management is unchanged |
| `src/jobs/templates.ts` | Template discovery is unchanged |
| `src/jobs/classifier.ts` | The task classifier is unchanged |

## Implementation

### 1. CLI fast path (`cli.tsx`)

**After**:
```typescript
// New: claude job <subcommand>
if (
  feature('TEMPLATES') &&
  args[0] === 'job'
) {
  profileCheckpoint('cli_templates_path')
  const { templatesMain } = await import('../cli/handlers/templateJobs.js')
  await templatesMain(args.slice(1))
  process.exit(0)
}

// Backward compatibility (deprecated)
if (
  feature('TEMPLATES') &&
  (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')
) {
  console.error(`[deprecated] Use: claude job ${args[0]} ${args.slice(1).join(' ')}`.trim())
  profileCheckpoint('cli_templates_path')
  const { templatesMain } = await import('../cli/handlers/templateJobs.js')
  await templatesMain(args)
  process.exit(0)
}
```

### 2. New status subcommand in templateJobs.ts

Add to the existing `switch`:
```typescript
case 'status':
  handleStatus(args.slice(1))
  break
```

```typescript
function handleStatus(args: string[]): void {
  const jobId = args[0]
  if (!jobId) {
    console.error('Usage: claude job status <job-id>')
    process.exitCode = 1
    return
  }
  const state = readJobState(jobId)
  if (!state) {
    console.error(`Job not found: ${jobId}`)
    process.exitCode = 1
    return
  }
  console.log(`Job: ${state.jobId}`)
  console.log(`  Template: ${state.templateName}`)
  console.log(`  Status: ${state.status}`)
  console.log(`  Created: ${state.createdAt}`)
  console.log(`  Updated: ${state.updatedAt}`)
}
```

### 3. REPL slash command

**`src/commands/job/index.ts`**:
```typescript
import type { Command } from '../../commands.js'
import { feature } from 'bun:bundle'

const job = {
  type: 'local-jsx',
  name: 'job',
  description: 'Manage template jobs',
  argumentHint: '[list|new|reply|status]',
  isEnabled: () => {
    if (feature('TEMPLATES')) return true
    return false
  },
  load: () => import('./job.js'),
} satisfies Command

export default job
```

**`src/commands/job/job.tsx`**:
```typescript
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'list'

  // delegate to templatesMain
  const { templatesMain } = await import('../../cli/handlers/templateJobs.js')

  // capture console.log output and return it to the REPL as the result
  const lines: string[] = []
  const origLog = console.log
  const origError = console.error
  console.log = (...a: unknown[]) => lines.push(a.join(' '))
  console.error = (...a: unknown[]) => lines.push(a.join(' '))

  try {
    await templatesMain([sub, ...parts.slice(1)])
  } finally {
    console.log = origLog
    console.error = origError
  }

  onDone(lines.join('\n') || 'Done.', { display: 'system' })
  return null
}
```

### 4. Register in commands.ts

```typescript
const jobCmd = feature('TEMPLATES')
  ? require('./commands/job/index.js').default
  : null

// in the COMMANDS array:
...(jobCmd ? [jobCmd] : []),
```

## Verification checklist

- [ ] `claude job list` lists templates
- [ ] `claude job new <template>` creates a job
- [ ] `claude job reply <id> <text>` replies to a job
- [ ] `claude job status <id>` shows the job status
- [ ] `claude job` (no arguments) is equivalent to `claude job list`
- [ ] `claude new/list/reply` print a deprecation warning and still work
- [ ] `/job` is available in the REPL
- [ ] `/job list` in the REPL shows the template list
- [ ] tsc --noEmit zero errors
- [ ] bun test passes
