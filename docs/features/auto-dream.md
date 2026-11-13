# Auto Dream — Automatic Memory Consolidation

## Overview

Auto Dream is Claude Code's background memory consolidation mechanism. Between sessions it automatically reviews, organizes and prunes the persistent memory files so future sessions get accurate context quickly.

The memory system is stored on the filesystem (by default `~/.claude/projects/<project-slug>/memory/`), made up of a `MEMORY.md` index file and several topic files (such as `user_language.md` and `project_overview.md`). As sessions accumulate, memories become stale, redundant or contradictory, and Dream cleans up that buildup.

## Architecture

### Core Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| Scheduler | `src/services/autoDream/autoDream.ts` | Time/session/lock triple gating; triggers the forked agent |
| Config | `src/services/autoDream/config.ts` | Reads the `isAutoDreamEnabled()` switch |
| Prompt | `src/services/autoDream/consolidationPrompt.ts` | Builds the 4-phase consolidation prompt |
| Lock file | `src/services/autoDream/consolidationLock.ts` | PID lock + mtime serving as `lastConsolidatedAt` |
| Task UI | `src/tasks/DreamTask/DreamTask.ts` | Background task registration, visible via the footer pill + Shift+Down |
| Manual entry | `src/skills/bundled/dream.ts` | `/dream` command, always available |

### Memory Path Resolution

Priority order (`src/memdir/paths.ts`):

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` environment variable (full path override)
2. `autoMemoryDirectory` setting (`settings.json`, supports `~/` expansion)
3. Default: `<memoryBase>/projects/<sanitized-git-root>/memory/`

where `memoryBase` = `CLAUDE_CODE_REMOTE_MEMORY_DIR` or `~/.claude`.

## Triggering

### Automatic Trigger (Auto Dream)

After each conversation turn ends, `executeAutoDream()` checks the three gates in order:

```
┌─────────────────────────────────────────────────────┐
│  Gate 1: Global switch                               │
│  isAutoMemoryEnabled() && isAutoDreamEnabled()       │
│  Excluded: KAIROS mode / Remote mode                 │
├─────────────────────────────────────────────────────┤
│  Gate 2: Time gate                                   │
│  hoursSince(lastConsolidatedAt) >= minHours          │
│  Default: 24 hours                                   │
├─────────────────────────────────────────────────────┤
│  Gate 3: Session gate                                │
│  sessionsTouchedSince(lastConsolidatedAt) >= minSessions │
│  Default: 5 sessions (excluding the current one)     │
├─────────────────────────────────────────────────────┤
│  Lock: PID lock file                                 │
│  .consolidate-lock (mtime = lastConsolidatedAt)      │
│  Dead-process detection + 1 hour expiry              │
└─────────────────────────────────────────────────────┘
```

Once all pass, the consolidation task runs as a **forked agent** (a restricted sub-agent):

- The Bash tool is limited to read-only commands (`ls`, `grep`, `cat`, etc.)
- It can only read and write files inside the memory directory
- The user can watch progress or stop it in the Shift+Down background task panel

### Manual Trigger (`/dream` Command)

Triggered at any time with the `/dream` command, with no gating:

- Runs in the main loop (not a forked agent) with full tool permissions
- The user can watch the operations in real time
- The lock file mtime is updated before execution

### Configuration Switches

| Switch | Location | Effect |
|--------|----------|--------|
| `autoDreamEnabled` | `settings.json` | Explicit `true`/`false` switch |
| `autoMemoryEnabled` | `settings.json` | Master switch; when off, all memory features are disabled |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Environment variable | `1`/`true` disables all memory features |
| `tengu_onyx_plover` | GrowthBook | Official remote config controlling `enabled`/`minHours`/`minSessions` |

Defaults (without a GrowthBook connection):

```typescript
minHours: 24      // at least 24 hours since the last consolidation
minSessions: 5    // at least 5 new sessions
```

## Consolidation Flow (4 Phases)

The prompt the Dream agent runs contains 4 phases:

### Phase 1 — Orient

- `ls` the memory directory to see the existing files
- Read the `MEMORY.md` index
- Skim the existing topic files to avoid creating duplicates

### Phase 2 — Gather

Collect new information in priority order:

1. **Log files** (`logs/YYYY/MM/YYYY-MM-DD.md`, append-only logs in KAIROS mode)
2. **Stale memories** — facts that contradict the current state of the codebase
3. **Session transcripts** — narrow keyword greps over the JSONL files (no full reads)

### Phase 3 — Consolidate

- Merge new signals into existing topic files instead of creating near-duplicates
- Convert relative dates ("yesterday", "last week") to absolute dates
- Delete facts that have been overturned

### Phase 4 — Prune and Index

- Keep `MEMORY.md` under 200 lines and 25KB
- One line per index entry, at most 150 characters
- Remove stale/wrong/superseded pointers

## Memory Types

The memory system uses 4 types (`src/memdir/memoryTypes.ts`):

| Type | Purpose | Example |
|------|---------|---------|
| `user` | The user's role, preferences, knowledge | The user is a senior backend engineer who prefers communicating in Chinese |
| `feedback` | Guidance on how to work | Don't mock the database in tests; use one bundled PR for code review |
| `project` | Project context (not derivable from code) | Merge freeze starts March 5; the auth rewrite is a compliance requirement |
| `reference` | Pointers to external systems | The Linear INGEST project tracks pipeline bugs |

**Not saved**: code patterns, architecture, file paths (derivable from code); Git history (`git log` is authoritative); debugging solutions (already in the code).

## Lock File Mechanism

The `.consolidate-lock` file lives inside the memory directory:

- **Contents**: the holder's PID
- **mtime**: serves as the `lastConsolidatedAt` timestamp
- **Expiry**: 1 hour (guards against PID reuse)
- **Race handling**: when two processes write at the same time, each re-reads and verifies the PID afterwards, and the loser exits
- **Rollback**: if the forked agent fails or is stopped by the user, the mtime reverts to its value before acquisition

## Use Cases

### Scenario 1: Automatic consolidation during daily development

A developer uses Claude Code for different tasks over several days. Auto Dream triggers automatically after 5+ sessions have accumulated and 24 hours have passed since the last consolidation, merging user preferences and project decisions scattered across many sessions.

### Scenario 2: Manual consolidation

The user notices Claude repeating the same mistakes or forgetting earlier decisions. Typing `/dream` triggers consolidation immediately, without waiting for the automatic cycle.

### Scenario 3: Fast context in a new session

When a new session starts, `MEMORY.md` is loaded into context. Memory files tidied by Dream are well structured and accurate, so Claude quickly learns about the user and the project.

### Scenario 4: Log distillation in KAIROS mode

In KAIROS (always-on assistant mode), the agent appends to dated log files. Dream distills those logs into topic files and the `MEMORY.md` index.

## Relationship to Other Systems

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│ Session      │────▶│ Memory write │────▶│ MEMORY.md     │
│ (main agent) │     │ (immediate)  │     │ + topic files │
└─────────────┘     └──────────────┘     └───────┬───────┘
                                               │
       ┌───────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ Auto Dream   │────▶│ Consolidate/ │
│ (background) │     │ prune/dedupe │
└──────────────┘     │ /correct     │
       ▲             └──────────────┘
┌──────────────┐
│ /dream       │
│ (manual)     │
└──────────────┘
```

- **extractMemories** (`src/services/extractMemories/`): at the end of each turn, extracts new memories from the conversation and writes them. Dream does not extract; it only consolidates.
- **CLAUDE.md**: project-level instruction files, loaded into context but not part of the memory system.
- **Team Memory** (`TEAMMEM` feature): a shared team memory directory that uses the same Dream mechanism as personal memory.
