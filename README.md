# Claude Code (personal fork)

A personal fork of a reverse-engineered / decompiled build of Anthropic's [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI. Many modules are stubbed or feature-flagged. Anthropic retains all rights to Claude Code; this repository is for study and research only.

## Requirements

- [Bun](https://bun.sh/) >= 1.3.11 (run `bun upgrade` if you hit odd errors)

## Quick start

```bash
bun install
bun run dev        # dev mode (all feature flags on)
bun run build      # outputs dist/cli.js plus chunk files; runs on Bun or Node
```

Run the checks before committing:

```bash
bun run precheck   # typecheck + lint fix + tests
```

## Configuration

Start the REPL and run `/login` to configure a provider: Anthropic-compatible, OpenAI-compatible, Gemini or Grok endpoints are supported. For an Anthropic-compatible endpoint, fill in the base URL, API key and the Haiku/Sonnet/Opus model IDs.

Feature flags are enabled with `FEATURE_<FLAG_NAME>=1`, for example:

```bash
FEATURE_BUDDY=1 bun run dev
```

## Debugging

The TUI needs a real terminal, so attach a debugger instead of launching one:

1. Run `bun run dev:inspect` and note the printed `ws://` address.
2. In VS Code, set breakpoints in `src/` and pick **Attach to Bun (TUI debug)** (F5).

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — architecture and contributor guide
- [`docs/`](./docs/) — feature and internals documentation
