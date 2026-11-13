# Slash Command Full Test Checklist

**Date**: 2026-05-06
**Scope**: All restored/new commands accumulated in this session (PR-1 ~ PR-4 + audit-fix + H2 refactor)
**Start commit**: `origin/main` (4f1649e2)
**Latest commit**: `fe99cf0e` (35+ commits ahead)

---

## Before you test

```bash
cd <repo-root>

# 1. Make sure the latest dist contains all commits
bun run build

# 2. Verify dist is not stale
stat -c '%Y %n' dist/cli.js
git log -1 --format=%ct\ %h
# dist mtime must be >= HEAD commit time

# 3. Fully exit the current dev REPL (Ctrl+D or /quit), then restart
bun run dev
```

**Key reminder**: Bun does not reload dist dynamically. Any source change requires `bun run build` + a REPL restart.

---

## Group A — Local only (no network / no key, testable immediately)

**Prerequisites**: none

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| A1 | `/version` | run directly | Shows the version number (e.g. `1.10.10`) | ☐ |
| A2 | `/env` | run directly | Runtime info + env var allowlist (CLAUDE_/FEATURE_/ANTHROPIC_/BUN_/NODE_/...) + secrets masked | ☐ |
| A3 | `/context` | run directly | Native fork command: colored grid (uses the real API view from `analyzeContextUsage()`, including compact boundary + projectView conversion) + token count matches what the API sees | ☐ |
| A4 | `/context` near a compaction boundary | run directly | Shows messages after the compact boundary, without double-counting tokens | ☐ |
| A5 | _(ctx_viz removed; `/context` is the only context visualization command)_ | — | — | — |
| A6 | `/debug-tool-call` | default N=5 | Lists the latest 5 tool_use+tool_result pairs | ☐ |
| A7 | `/debug-tool-call 10` | numeric argument | Lists the latest 10 | ☐ |
| A8 | `/perf-issue` | run directly | Writes `~/.claude/perf-reports/perf-<stamp>.md` (mem+cpu+token+per-tool) | ☐ |
| A9 | `/perf-issue --format=json` | flag | Writes a .json file | ☐ |
| A10 | `/perf-issue --limit 1000` | flag | Reads only the last 1000 log lines | ☐ |
| A11 | `/break-cache` | default once | Writes the `~/.claude/.next-request-no-cache` marker | ☐ |
| A12 | `/break-cache status` | subcommand | Shows marker status + cumulative break count | ☐ |
| A13 | `/break-cache always` | subcommand | Writes the always flag file | ☐ |
| A14 | `/break-cache off` | subcommand | Deletes once + always | ☐ |
| A15 | `/tui` | toggle | Toggles the `~/.claude/.tui-mode` marker | ☐ |
| A16 | `/tui status` | subcommand | Shows the current marker + env var state | ☐ |
| A17 | `/tui on` `/tui off` | subcommand | marker write/unlink | ☐ |
| A18 | `/onboarding status` | subcommand | Shows hasCompletedOnboarding / theme / lastVersion | ☐ |
| A19 | `/onboarding theme` | subcommand | Opens the ThemePicker | ☐ |
| A20 | `/onboarding trust` | subcommand | Clears the trust dialog flag | ☐ |
| A21 | `/onboarding reset` | subcommand | Clears hasCompletedOnboarding; onboarding re-runs on next start | ☐ |
| A22 | `/recap` | run directly | One-line session recap of at most 40 words | ☐ |
| A23 | `/away` `/catchup` | aliases of recap | Same as A22 | ☐ |
| A24 | `/usage` | run directly | Merged cost + stats (Settings/Usage or Stats panel) | ☐ |
| A25 | `/cost` `/stats` | aliases of usage | Same as A24 | ☐ |
| A26 | `/summary` | run directly | Calls manuallyExtractSessionMemory + shows summary.md | ☐ |

**Diagnosing group A failures**:
- Command not found → check dist staleness + restart the REPL
- `feature() unsupported` → the feature flag was not injected during `bun run build`

---

## Group B — GitHub CLI (requires `gh auth login`)

**Prerequisites**: `gh auth status` shows logged in; the fork repository must have issues enabled

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| B1 | `/share` | default secret gist | Calls `gh gist create`, prints the gist URL | ☐ |
| B2 | `/share --public` | flag | Public gist | ☐ |
| B3 | `/share --mask-secrets` | flag | Redacts patterns such as `sk-ant-*` `Bearer *` `ghp_*` | ☐ |
| B4 | `/share --summary-only` | flag | Only the first 200 words per turn | ☐ |
| B5 | `/share --allow-public-fallback` | flag | gh fails → 0x0.st fallback | ☐ |
| B6 | `/issue Fix login bug` | title argument | Calls `gh issue create`; rich body contains the last 5 turns + errors | ☐ |
| B7 | `/issue --label bug --assignee me <title>` | multiple flags | label + assignee take effect | ☐ |
| B8 | `/issue` (repo has issues disabled) | — | Automatically falls back to GitHub Discussions | ☐ |
| B9 | `/commit` | run directly (with staged changes) | Generates a draft commit message | ☐ |
| B10 | `/commit-push-pr` | run directly | commit + push + create PR | ☐ |

**Diagnosing group B failures**:
- `gh: command not found` → install https://cli.github.com/
- `gh auth status` not logged in → `gh auth login`
- issues disabled → check whether it fell back to a discussion

---

## Group C — Subscription OAuth (already `/login`ed to claude.ai)

**Prerequisites**: `/login` completed with claude.ai OAuth; `/login` shows `☑ Subscription`

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| C1 | `/login` | no arguments | **3-plane summary**: ☑ Subscription, ☐/☑ Workspace API key, 4 third-party providers (new in PR-4) | ☐ |
| C2 | `/teleport` | no arguments | Lists recent sessions (list-style picker) | ☐ |
| C3 | `/teleport <session-uuid>` | argument | Resume from claude.ai | ☐ |
| C4 | `/tp <session-uuid>` | alias | Same as C3 | ☐ |
| C5 | `/teleport <session-uuid> --print` | flag | Print mode outputs the session URL directly | ☐ |
| C6 | `/autofix-pr 386` | PR# | Dispatched to CCR, prints sessionUrl | ☐ |
| C7 | `/autofix-pr stop` | subcommand | Stops the active monitor | ☐ |
| C8 | `/autofix-pr anthropics/claude-code#999` | cwd mismatch | Rejected with `repo_mismatch` (no session is actually created) | ☐ |
| C9 | `/schedule list` | subcommand | `/v1/code/triggers` GET, returns `data:[]` or a trigger list | ☐ |
| C10 | `/schedule create <cron> <prompt>` | subcommand | POST, cron expr validated as UTC | ☐ |
| C11 | `/schedule run <id>` | subcommand | POST /run triggers immediately | ☐ |
| C12 | `/schedule update <id> <field> <value>` | subcommand | **POST** (not PATCH) | ☐ |
| C13 | `/cron list` `/triggers list` | aliases | Same as C9 | ☐ |
| C14 | `/init-verifiers` | no arguments | Creates project verifier skills | ☐ |
| C15 | `/bridge-kick` | no arguments | Bridge fault-injection test | ☐ |
| C16 | `/subscribe-pr` | no arguments | Lists the local `~/.claude/pr-subscriptions.json` | ☐ |
| C17 | `/ultrareview <PR#>` | argument | Preflight gate (already in v1) | ☐ |

**Diagnosing group C failures**:
- 401 → re-run `/login`
- 401 on `/v1/agents`-style endpoints → these are workspace endpoints and **are expected to fail**; move them to group F
- `/schedule` 401 → check that dist contains the `ccr-triggers-2026-01-30` beta header

---

## Group D — _(removed 2026-05-06)_

The `/providers` command was removed on 2026-05-06. Reason: it overlapped with the "Anthropic Compatible Setup" form in the native fork `/login` (which also configures an OpenAI-compat Base URL + API Key); keeping a single entry point avoids confusing double UIs.

**To configure a third-party provider, use the form inside** `/login`: pick a provider, then fill in the Base URL + API Key + Haiku/Sonnet/Opus category buttons.

The `src/services/providerRegistry/*` utility modules are **kept** (metadata for the 4 built-in providers cerebras/groq/qwen/deepseek + the DeepSeek three-mode compatMatrix), so a future "Quick Select" enhancement of the fork form can reuse them.

---


## Group E — Local fallbacks (new in PR-3; usable by subscription users without a key)

**Prerequisites**: none

### E.1 `/local-vault` (OS keychain + AES fallback)

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| E1 | `/local-vault list` | no arguments | Empty list (first time) | ☐ |
| E2 | `/local-vault set test-key foo-secret-value` | write a secret | onDone shows `[REDACTED]` and does **not** show the original value | ☐ |
| E3 | `/local-vault list` | run again | Shows `test-key` (without the value) | ☐ |
| E4 | `/local-vault get test-key` | default mask | Something like `foo-...e (16 chars)` | ☐ |
| E5 | `/local-vault get test-key --reveal` | plaintext + warning | `foo-secret-value` + warning "secret revealed in terminal" | ☐ |
| E6 | `/local-vault set bad-key C:hack` | path traversal | Rejected (CRITICAL E1 fix) | ☐ |
| E7 | `/local-vault set ../traverse foo` | path traversal | Rejected | ☐ |
| E8 | `/local-vault delete test-key` | delete | OK | ☐ |
| E9 | `/lv list` | alias | Same as E1 | ☐ |

**Security verification**:
```bash
# E1 the encrypted file exists and the value is not in plaintext
ls ~/.claude/local-vault.enc.json
cat ~/.claude/local-vault.enc.json | grep -c "foo-secret-value"  # must be 0
# a 16-byte salt exists
cat ~/.claude/local-vault.enc.json | grep "_salt"
```

### E.2 `/local-memory` (multi-store persistence)

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| E10 | `/local-memory list` | no arguments | Empty | ☐ |
| E11 | `/local-memory create my-store` | create | `~/.claude/local-memory/my-store/` is created | ☐ |
| E12 | `/local-memory store my-store key1 value1` | write an entry | OK | ☐ |
| E13 | `/local-memory fetch my-store key1` | read | `value1` | ☐ |
| E14 | `/local-memory entries my-store` | list | `[key1]` | ☐ |
| E15 | `/local-memory store my-store ../escape foo` | path traversal | Rejected | ☐ |
| E16 | `/local-memory archive my-store` | rename | The dir is renamed to `my-store.archived` | ☐ |
| E17 | `/lm list` | alias | Same as E10 | ☐ |

**Diagnosing group E failures**:
- AES wrong passphrase → prompts to run setSecret again
- keychain unavailable → falls back to a file automatically (warns once)
- path traversal accepted → the audit-fix-all-40 fix did not take effect; rebuild

---

## Group F — Workspace API key (requires `ANTHROPIC_API_KEY=sk-ant-api03-*`)

**Prerequisites**:
1. Create an API key (`sk-ant-api03-*`) at https://console.anthropic.com/settings/keys
2. Windows: persist it with `setx ANTHROPIC_API_KEY "sk-ant-api03-..."`
3. **Fully exit the dev REPL** (Ctrl+D / `/quit`) + start a new shell (so setx takes effect) + `bun run dev`
4. Verify: `/login` should show `☑ Workspace API key  ANTHROPIC_API_KEY set`

| # | Command | Input | Expected output | Pass |
|---|---|---|---|---|
| F1 | `/help` (with the key configured) | — | The 4 commands `/agents-platform` `/vault` `/memory-stores` `/skill-store` appear (previously isHidden:true) | ☐ |
| F2 | `/help` (without the key) | — | The 4 commands do **not** appear (dynamic isHidden) | ☐ |
| F3 | `/agents-platform list` | no arguments | `/v1/agents` GET 200, returns an agents array | ☐ |
| F4 | `/vault list` | no arguments | `/v1/vaults` GET 200 | ☐ |
| F5 | `/vault create test-vault` | subcommand | Creates a vault | ☐ |
| F6 | `/vault add-credential <vault_id> api-key sk-secret` | subcommand | onDone shows `[REDACTED]`; grepping stdout does not find `sk-secret` | ☐ |
| F7 | `/memory-stores list` | no arguments | `/v1/memory_stores` GET, beta `managed-agents-2026-04-01` | ☐ |
| F8 | `/memory-stores create test-store` | subcommand | POST | ☐ |
| F9 | `/memory-stores update-memory <id> <mid> "new"` | subcommand | **PATCH** (not POST) | ☐ |
| F10 | `/skill-store list` | no arguments | `/v1/skills?beta=true` GET | ☐ |
| F11 | `/skill-store install <id>` | subcommand | Writes `~/.claude/skills/<name>/SKILL.md` | ☐ |
| F12 | Wrong key (API key without the `sk-ant-api03-*` prefix) | misconfigured key | Friendly error (not a 401) | ☐ |
| F13 | Call `/vault list` without the key (not found in `/help`, but typed directly) | — | 501 + message "ANTHROPIC_API_KEY required" | ☐ |

**Diagnosing group F failures**:
- 401 with a workspace key → the key did not take effect (restart the REPL + check `echo $ANTHROPIC_API_KEY`)
- Command still isHidden → dist staleness (rebuild + restart)
- Credential value appears in stdout → the audit fix did not take effect

---

## Acceptance criteria for a full pass

- [ ] Group A 26/26 pass
- [ ] Group B ≥8/10 pass (with gh + repo permissions)
- [ ] Group C ≥10/17 pass (full subscription environment)
- [ ] Group D 8/8 pass
- [ ] Group E 17/17 pass (path traversal must be rejected)
- [ ] Group F ≥10/13 pass (depends on whether a workspace key is configured)

Report any failure immediately: the command + actual output + expected output.

---

## Known limitations

| Command | Limitation |
|---|---|
| `/teleport` picker with no arguments | Uses a list-style picker rather than the Ink `<SelectInput>` (a LocalJSXCommandCall cannot suspend mid-call) |
| `/autofix-pr` cross-repo | Metadata only; the git source still comes from cwd (`repo_mismatch` explicitly rejects a cwd mismatch) |
| `/skill-store install` | Writes to `~/.claude/skills/`; the fork's main flow does not automatically load markdown skills from that directory (users use them manually) |
| `/providers use <id>` | Prints a shell export command and does **not** mutate the runtime automatically (takes effect after restart) |

---

## Test report template

```markdown
## Test report - 2026-05-XX

### Environment
- OS: Windows 11
- Bun: <version>
- dist mtime: <date>
- HEAD: <commit-hash>
- ANTHROPIC_API_KEY: set/unset
- gh CLI: installed/not installed

### Results
- A: 26/26 ✅
- B: 8/10 (B5/B8 fail)
- C: 12/17 (C5/C13/C14/C15/C16 fail)
- D: 8/8 ✅
- E: 17/17 ✅
- F: 12/13 (F12 edge case)

### Failure details
B5: <command> → actual <output>, expected <expected>
...
```
