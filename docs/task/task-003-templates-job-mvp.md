# Task 003: TEMPLATES — job filesystem MVP

> Source: item 3 of [stub-recovery-design-1-4.md](../features/stub-recovery-design-1-4.md)
> Priority: P2
> Effort: medium
> Status: DONE
> Phase: MVP

## Goal

Turn `new` / `list` / `reply` into a usable template-task system. The first phase does not touch complex auto-classification or auto-execution.

## Background

- The command entry is only a fast path (`src/entrypoints/cli.tsx:272`)
- The handler is empty (`src/cli/handlers/templateJobs.ts`)
- `markdownConfigLoader` already includes `templates` in the config directories (`src/utils/markdownConfigLoader.ts:35`)
- `query/stopHooks` already reserves a job classifier hook (`src/query/stopHooks.ts:103`)
- `jobs/classifier.ts` is still a stub (`src/jobs/classifier.ts`)

## Implementation plan

### New files

| File | Description |
|------|-------------|
| `src/jobs/state.ts` | Job state management |
| `src/jobs/templates.ts` | Template parsing and listing |

### Modified files

| File | Change |
|------|--------|
| `src/cli/handlers/templateJobs.ts` | Implement the `new` / `list` / `reply` handlers |

### Template source

`.claude/templates/*.md`

### Template format

Reuse the existing markdown + frontmatter parsing; do not design a separate DSL.

### list command

- List all templates
- Show: template name, description, path

### new command

- Parse the template
- Create a job directory under `~/.claude/jobs/<job-id>/`
- Write `template.md`, `input.txt`, `state.json`
- Return the job id and directory path

### reply command

- Write the reply to `replies.jsonl` or `input.txt`
- Update `state.json`

## Verification steps

- [ ] `list` lists all templates under `.claude/templates`
- [ ] `new <template> [args...]` creates the job directory and state file
- [ ] `reply <job-id> <text>` updates the job content and state
- [ ] The minimal frontmatter schema field set is defined

## Phase 2 (later)

- [ ] Restore `src/jobs/classifier.ts`
- [ ] Make a job session with `CLAUDE_JOB_DIR` automatically update `state.json` after a turn completes
- [ ] Then decide whether to add an automatic job runner

### Why it is split

- This is "template job commands", not just a template list
- There is not enough ready-made implementation for the automatic job-running chain
- Building the filesystem job lifecycle first is more stable

## Risks

- The frontmatter schema needs a minimal field set defined first
- Once it grows into "run jobs automatically", the scope will expand noticeably

## Dependencies

No hard dependencies; can be implemented independently.
