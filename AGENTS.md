# AGENTS.md

Guidance for AI coding agents working in this repository.

The single source of truth is [`CLAUDE.md`](./CLAUDE.md) — read it first. It covers the project overview, commands, architecture, testing conventions and the owner's commit/branch rules. This file used to duplicate it and drifted out of date, so it now just points there.

Quick reminders:

- Runtime is Bun; run `bun run precheck` (typecheck + lint fix + tests) before committing — it must pass with zero errors.
- Commits are a single short Conventional Commits line (`fix: handle empty config`) with no trailers or generated-by lines.
- Branch names follow `<type>/<short-kebab-topic>`.
