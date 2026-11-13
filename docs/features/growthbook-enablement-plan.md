# GrowthBook Feature Enablement Plan

> Written: 2026-04-06
> Based on: feature-flags-codex-review.md + in-depth analysis by 4 parallel research agents
> Premise: we are a paying subscriber with a valid Anthropic API key

---

## Background

Claude Code uses a three-layer gating system:
1. **Compile-time feature flags**: `feature('FLAG_NAME')` from `bun:bundle`
2. **GrowthBook remote switches**: the `tengu_*` prefix, connected to Anthropic's servers through the SDK
3. **Runtime environment variables**: `USER_TYPE`, `CLAUDE_CODE_*`, and so on

In our decompiled build GrowthBook does not start (the analytics chain is an empty implementation), so every `tengu_*` check returns `false` by default.

**Key finding: all of the code gated by GrowthBook is real implementation, not stubs.**

---

## How to enable

### Option 1: hardcoded bypass (recommended first)
Add a default-value mapping inside `getFeatureValueInternal()` in `src/services/analytics/growthbook.ts`.

### Option 2: self-hosted GrowthBook server
```bash
docker run -p 3100:3100 growthbook/growthbook
# set environment variables
CLAUDE_GB_ADAPTER_URL=http://localhost:3100
CLAUDE_GB_ADAPTER_KEY=sdk-xxx
```

### Option 3: restore the native 1P connection
Make `is1PEventLoggingEnabled()` return `true` to connect to Anthropic's GrowthBook server.
Note: this sends usage statistics (not code or conversation content).

---

## Priority P0: purely local features (zero external dependencies, usable immediately)

These need no API calls. Turning on the gate is enough.

### P0-1. Custom keybindings
- **Gate**: `tengu_keybinding_customization_release` → `true`
- **Compile flag**: none (built in)
- **Size**: 473 lines, complete implementation
- **What it does**: loads `~/.claude/keybindings.json`, with hot reload, duplicate-key detection, and structure validation
- **Effect**: users can customize all keybindings
- **Risk**: none

### P0-2. Streaming tool execution
- **Gate**: `tengu_streaming_tool_execution2` → `true`
- **Compile flag**: none (built in)
- **Size**: 577 lines (StreamingToolExecutor), complete implementation
- **What it does**: starts executing tools while the API response is still streaming back, reducing wait time
- **Effect**: noticeably faster interaction
- **Risk**: low (production-grade code with error handling)

### P0-3. Scheduled task system
- **Gate**: `tengu_kairos_cron` → `true` (plus `tengu_kairos_cron_durable`, which defaults to `true`)
- **Compile flag**: `AGENT_TRIGGERS` (needs to be added) or `AGENT_TRIGGERS_REMOTE` (already enabled)
- **Size**: 1025 lines (cronTasks + cronScheduler), complete implementation
- **What it does**: local cron scheduling with one-off and recurring tasks, thundering-herd jitter, and automatic expiry
- **Effect**: Claude tasks can be scheduled to run at set times
- **Risk**: low

### P0-4. Agent teams / Swarm
- **Gate**: `tengu_amber_flint` → `true` (this is a kill switch and already defaults to `true`)
- **Compile flag**: none (built in)
- **Size**: 45 lines (gate layer); the actual swarm implementation is in the teammate tools
- **What it does**: multi-agent collaboration; also requires `--agent-teams` or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **Effect**: allows creating and managing agent teams
- **Risk**: none (the kill switch already defaults to true)

### P0-5. Token-efficient JSON tool format
- **Gate**: `tengu_amber_json_tools` → `true`
- **Compile flag**: none (built in)
- **Size**: a few gate-check lines in betas.ts
- **What it does**: enables the FC v3 format, cutting output tokens by about 4.5%
- **Effect**: saves money
- **Risk**: low (the model must support the beta header)

### P0-6. Ultrathink extended thinking
- **Gate**: `tengu_turtle_carbon` → `true` (already defaults to `true`; kill switch)
- **Compile flag**: none
- **What it does**: triggers extended thinking mode through a keyword
- **Effect**: already on by default; just make sure it is not turned off remotely
- **Risk**: none

### P0-7. Immediate model switching
- **Gate**: `tengu_immediate_model_command` → `true`
- **Compile flag**: none
- **What it does**: runs the `/model`, `/fast`, and `/effort` commands immediately while a query is in progress
- **Effect**: switch without waiting for the current task to finish
- **Risk**: low

---

## Priority P1: features that need the Claude API (usable with an API key)

These call the Claude API (through a forked subagent or queryModel). A subscription is enough.

### P1-1. Session memory
- **Gate**: `tengu_session_memory` → `true` (config: `tengu_sm_config` → `{}`)
- **Compile flag**: none (built in)
- **Size**: 1127 lines, complete implementation
- **What it does**: persists context across sessions; a forked agent periodically extracts session notes into a markdown file
- **Effect**: Claude remembers working context across sessions
- **Depends on**: Claude API (forked subagent)
- **Risk**: low (extra API token usage)

### P1-2. Automatic memory extraction
- **Gate**: `tengu_passport_quail` → `true` (related: `tengu_moth_copse`, `tengu_coral_fern`)
- **Compile flag**: `EXTRACT_MEMORIES` (needs to be added)
- **Size**: 616 lines, complete implementation
- **What it does**: automatically extracts persistent memories from the conversation into `~/.claude/projects/<path>/memory/`
- **Effect**: builds a project knowledge base automatically
- **Depends on**: Claude API (forked subagent)
- **Risk**: low

### P1-3. Prompt suggestions
- **Gate**: `tengu_chomp_inflection` → `true`
- **Compile flag**: none (built in)
- **Size**: 525 lines, complete implementation
- **What it does**: automatically generates next-step suggestions, with speculation prefetch
- **Effect**: smoother interaction
- **Depends on**: Claude API (forked subagent)
- **Risk**: low (extra API usage, but cache-aware)

### P1-4. Verification agent
- **Gate**: `tengu_hive_evidence` → `true`
- **Compile flag**: `VERIFICATION_AGENT` (needs to be added)
- **Size**: 153 lines (agent definition), complete implementation
- **What it does**: an adversarial verification agent that actively tries to break your implementation (read-only mode)
- **Effect**: automated code verification
- **Depends on**: Claude API (subagent)
- **Risk**: low (read-only, does not modify code)

### P1-5. Brief mode
- **Gate**: `tengu_kairos_brief` → `true`
- **Compile flag**: `KAIROS` or `KAIROS_BRIEF` (needs to be added)
- **Size**: 335 lines, complete implementation
- **What it does**: the `/brief` command toggles a concise output mode
- **Effect**: less redundant output
- **Depends on**: Claude API
- **Risk**: low

### P1-6. Away summary
- **Gate**: `tengu_sedge_lantern` → `true`
- **Compile flag**: `AWAY_SUMMARY` (needs to be added)
- **Size**: 176 lines, complete implementation
- **What it does**: when you return after being away from the terminal for 5 minutes, it summarizes what happened in the meantime
- **Effect**: quickly restores context
- **Depends on**: Claude API + terminal focus event support
- **Risk**: low

### P1-7. Auto dream
- **Gate**: `tengu_onyx_plover` → `{"enabled": true}`
- **Compile flag**: none (built in, but it checks whether auto-memory is enabled)
- **Size**: 349 lines, complete implementation
- **What it does**: tidies and consolidates memory in the background (equivalent to running `/dream` automatically)
- **Effect**: memory stays tidy and organized automatically
- **Depends on**: Claude API (forked subagent) + auto-memory enabled
- **Risk**: low

### P1-8. Idle-return prompt
- **Gate**: `tengu_willow_mode` → `"dialog"` or `"hint"`
- **Compile flag**: none
- **What it does**: when the conversation is large and the cache has expired, suggests starting a new session
- **Effect**: avoids wasting tokens on an expired cache
- **Risk**: none

---

## Priority P2: enhancements (better experience but not required)

### P2-1. Incremental MCP instruction delivery
- **Gate**: `tengu_basalt_3kr` → `true`
- **What it does**: sends only the changed MCP instructions instead of all of them
- **Effect**: lower token usage
- **Risk**: low

### P2-2. Leaf pruning
- **Gate**: `tengu_pebble_leaf_prune` → `true`
- **What it does**: removes dead-end message branches from session storage
- **Effect**: less storage and faster loading
- **Risk**: low

### P2-3. Message merging
- **Gate**: `tengu_chair_sermon` → `true`
- **What it does**: merges adjacent tool_result + text blocks
- **Effect**: lower token usage
- **Risk**: low

### P2-4. Deep links
- **Gate**: `tengu_lodestone_enabled` → `true`
- **What it does**: registers a `claude://` URL protocol handler
- **Effect**: Claude Code can be opened directly from a browser
- **Risk**: low

### P2-5. Automatically background agents
- **Gate**: `tengu_auto_background_agents` → `true`
- **What it does**: an agent task is moved to the background after running for 120s
- **Effect**: no longer blocks the main interaction
- **Risk**: low

### P2-6. Fine-grained tool status
- **Gate**: `tengu_fgts` → `true`
- **What it does**: includes fine-grained tool status information in the system prompt
- **Effect**: the model understands tool availability better
- **Risk**: low

### P2-7. Git diff for file operations
- **Gate**: `tengu_quartz_lantern` → `true`
- **What it does**: computes a git diff on file writes/edits (remote sessions only)
- **Effect**: better change tracking
- **Risk**: low

---

## Priority P3: needs a self-hosted service or Anthropic OAuth

### P3-1. Team memory
- **Gate**: `tengu_herring_clock` → `true`
- **Compile flag**: `TEAMMEM` (needs to be added)
- **Size**: 1180+ lines, complete implementation
- **What it does**: shares memory across agents, synced to the Anthropic API
- **Depends on**: Anthropic OAuth + a GitHub remote
- **Status**: needs Anthropic's `/api/claude_code/team_memory` endpoint
- **Feasibility**: unusable unless you host a compatible API

### P3-2. Settings sync
- **Gate**: `tengu_enable_settings_sync_push` + `tengu_strap_foyer` → `true`
- **Compile flag**: `UPLOAD_USER_SETTINGS` / `DOWNLOAD_USER_SETTINGS` (need to be added)
- **Size**: 582 lines, complete implementation
- **What it does**: syncs settings across devices
- **Depends on**: Anthropic OAuth + `/api/claude_code/user_settings`
- **Feasibility**: same as above

### P3-3. Bridge remote control
- **Gate**: `tengu_ccr_bridge` → `true` (the compile flag `BRIDGE_MODE` is already enabled in dev mode)
- **Size**: 12,619 lines, complete implementation
- **What it does**: controls the CLI remotely from the claude.ai web app
- **Depends on**: a claude.ai subscription + a WebSocket backend
- **Feasibility**: needs Anthropic's CCR backend

### P3-4. Remote scheduled agents
- **Gate**: `tengu_surreal_dali` → `true`
- **What it does**: creates scheduled agents that run remotely
- **Depends on**: Anthropic CCR infrastructure
- **Feasibility**: needs a remote service

---

## Kill switch list (make sure they are not turned off remotely)

These gates default to `true` and are kill switches. Make sure they stay `true`:

| Gate | Default | What it controls |
|---|---|---|
| `tengu_turtle_carbon` | `true` | Ultrathink extended thinking |
| `tengu_amber_stoat` | `true` | Built-in Explore/Plan agents |
| `tengu_amber_flint` | `true` | Agent teams / Swarm |
| `tengu_slim_subagent_claudemd` | `true` | Slimmed-down CLAUDE.md for subagents |
| `tengu_birch_trellis` | `true` | tree-sitter bash security analysis |
| `tengu_collage_kaleidoscope` | `true` | macOS clipboard image reading |
| `tengu_compact_cache_prefix` | `true` | Reuse the prompt cache during compaction |
| `tengu_kairos_cron_durable` | `true` | Durable cron tasks |
| `tengu_attribution_header` | `true` | API request attribution |
| `tengu_slate_prism` | `true` | Agent progress summaries |

---

## Compile flags that need to be added

These compile-time flags are not yet enabled in `build.ts` / `scripts/dev.ts`, but the feature code is complete:

| Flag | Used for | Priority |
|---|---|---|
| `AGENT_TRIGGERS` | Scheduled task system (P0-3) | P0 |
| `EXTRACT_MEMORIES` | Automatic memory extraction (P1-2) | P1 |
| `VERIFICATION_AGENT` | Verification agent (P1-4) | P1 |
| `KAIROS` or `KAIROS_BRIEF` | Brief mode (P1-5) | P1 |
| `AWAY_SUMMARY` | Away summary (P1-6) | P1 |
| `TEAMMEM` | Team memory (P3-1) | P3 |

---

## Implementation roadmap

### Phase 1: hardcode the P0 local-only gates (fastest payoff)
1. Add a default-value mapping in growthbook.ts
2. Add the `AGENT_TRIGGERS` compile flag in build.ts / dev.ts
3. Verify that the 7 P0 features work
4. Estimated effort: 1-2 hours

### Phase 2: enable the P1 API-dependent features
1. Add compile flags: `EXTRACT_MEMORIES`, `VERIFICATION_AGENT`, `KAIROS_BRIEF`, `AWAY_SUMMARY`
2. Add default values for the P1 gates
3. Verify that the 8 P1 features work
4. Estimated effort: 2-3 hours

### Phase 3: evaluate a self-hosted GrowthBook (optional)
1. Deploy a GrowthBook server with Docker
2. Move the hardcoded values into the GrowthBook admin
3. Gain the ability to manage all flags from a web UI
4. Estimated effort: half a day

### Phase 4: evaluate the remote features (optional)
1. Research whether Anthropic OAuth can be used
2. Evaluate whether self-hosting team memory and settings sync is feasible
3. Estimated effort: to be determined

---

## Privacy notes

### Hardcoded bypass (option A)
- **No data leaves the machine**
- The GrowthBook SDK does not start
- Runs fully offline

### Self-hosted GrowthBook (option B)
- Data goes only to your own server
- Anthropic cannot obtain any data
- All flags can be managed live through the web UI

### Restore native 1P (option C)
- Sends usage statistics to `api.anthropic.com`
- **Not sent**: code, conversation content, API key
- **Sent**: email, device ID, machine fingerprint, repository hash, subscription type
- `DISABLE_TELEMETRY=1` turns telemetry off (but also turns off GrowthBook)
