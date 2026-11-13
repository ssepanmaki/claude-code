# Stub Recovery Design 1-4

> Date: 2026-04-12
> Goal: based on the current code boundaries, give implementable designs for the next four stub/half-stub command surfaces.
> Ordering principle: sorted by suggested implementation order, not by severity.

## Design Principles

- Start with items that close on their own, have clear payoff and well-bounded changes.
- Split large items into `MVP` and `Phase 2+` to avoid falling into a broad recovery all at once.
- Prefer reusing existing state, transport, logging and configuration capabilities instead of reinventing protocols.
- Base the design on the actual code in this repository, not on the idealized state of older docs.

## 1. `claude daemon status` / `claude daemon stop`

### Current State

- The `start` path already has a full supervisor + worker lifecycle:
  `src/daemon/main.ts`
  `src/daemon/workerRegistry.ts`
- `status` / `stop` are currently placeholder output only:
  `src/daemon/main.ts`
- `/remote-control-server` has its own in-command UI state, but it only tracks the in-process `daemonProcess`, which is not a suitable basis for cross-process CLI management:
  `src/commands/remoteControlServer/remoteControlServer.tsx`

### Goal

- Make `claude daemon status` and `claude daemon stop` work correctly from another CLI process.
- Don't depend on TUI in-memory state, and don't require the current command process to be the one that started the daemon.

### MVP Approach

- Add a daemon state file, for example:
  `~/.claude/daemon/remote-control.json`
- On `start`, write:
  - supervisor pid
  - cwd
  - startedAt
  - worker kinds
  - latest status
- `status`:
  - read the state file
  - verify the pid is alive with the existing process-probing capability
  - print `running / stopped / stale`
  - when stale, clean up the state file automatically
- `stop`:
  - read the pid
  - send `SIGTERM`
  - wait for exit
  - `SIGKILL` after a timeout
  - clean up the state file

### Code Scope

- Add `src/daemon/state.ts`
- Modify `src/daemon/main.ts`
- Lightly modify `src/commands/remoteControlServer/remoteControlServer.tsx` so the UI reads the same state file where possible

### Verification

1. `claude daemon start`
2. Run `claude daemon status` in a new terminal
3. Run `claude daemon stop`
4. Run `claude daemon status` again and confirm it returns `stopped` or a clear `stale cleaned`

### Risks

- The Windows signal model differs from Unix, so `stop` needs a timeout fallback.
- The current design assumes a single supervisor and does not handle concurrent multiple instances.

### Effort Estimate

- Small
- A good first item to implement next

## 2. `BG_SESSIONS`

### Current State

- The fast path is already wired:
  `src/entrypoints/cli.tsx`
- The session registry has a real implementation:
  `src/utils/concurrentSessions.ts`
- `exit` inside a bg session already runs `tmux detach-client`:
  `src/commands/exit/exit.tsx`
- But the CLI handlers are still entirely empty:
  `src/cli/bg.ts`
- The task summary is still a stub:
  `src/utils/taskSummary.ts`

### Goal

- First make `ps` / `logs` / `kill` genuinely useful session management commands.
- Don't force `attach` / `--bg` to be completed in the first phase.

### Phase 2A: MVP

- Implement `ps`
  - read live sessions from the registry
  - show pid, kind, sessionId, cwd, name, startedAt, bridgeSessionId
  - also show activity/status if available
- Implement `logs`
  - support lookup by `sessionId / pid / name`
  - prefer reusing the local transcript/log reading capability
  - if the registry has a `logPath`, support tailing the file
- Implement `kill`
  - resolve the target session
  - send the exit signal
  - clean up the stale registry

### Phase 2B: Later

- Implement `attach`
- Implement `--bg`
- Implement mid-run status updates in `taskSummary`

### Why Split

- The existing registry records `pid / sessionId / name / logPath`
- But there is no reliable tmux attach target
- So `attach` and `--bg` are not just a matter of filling in handlers; they need a design for launch/attach metadata

### Code Scope

- Modify `src/cli/bg.ts`
- Modify `src/utils/concurrentSessions.ts` to allow later attach/--bg extension
- Modify `src/utils/taskSummary.ts`
- Reuse:
  `src/utils/sessionStorage.ts`
  `src/utils/udsClient.ts`

### Verification

1. `ps` lists live sessions
2. `logs <sessionId|pid|name>` prints the matching logs
3. `kill <sessionId|pid|name>` ends the target session

### Risks

- Phase 2 `attach` / `--bg` need a tmux metadata design
- The tmux path on Windows needs an explicit degradation strategy

### Effort Estimate

- `ps/logs/kill`: medium
- `attach/--bg`: clearly larger, should be phased

## 3. `TEMPLATES`

### Current State

- The command entry is only a fast path:
  `src/entrypoints/cli.tsx`
- The handler is empty:
  `src/cli/handlers/templateJobs.ts`
- `markdownConfigLoader` already includes `templates` in the config directories:
  `src/utils/markdownConfigLoader.ts`
- `query / stopHooks` already reserve the job classifier chain:
  `src/query/stopHooks.ts`
- `jobs/classifier.ts` is still a stub:
  `src/jobs/classifier.ts`

### Goal

- Turn `new / list / reply` into a working template job system.
- Don't touch complex automatic classification and automatic execution in the first phase.

### MVP Approach

- Template source:
  `.claude/templates/*.md`
- Template format:
  reuse the existing markdown + frontmatter parsing instead of designing a separate DSL
- `list`
  - list all templates
  - show the template name, description and path
- `new <template> [args...]`
  - parse the template
  - create a job directory under `~/.claude/jobs/<job-id>/`
  - write `template.md`, `input.txt` and `state.json`
  - return the job id and directory
- `reply <job-id> <text>`
  - write the reply to `replies.jsonl` or `input.txt`
  - update `state.json`

### Phase 2

- Restore `src/jobs/classifier.ts`
- Let job sessions with `CLAUDE_JOB_DIR` update `state.json` automatically after a turn completes
- Then decide whether to add an automatic job runner

### Why Split

- The current evidence shows these are "template job commands", not just a template list
- But there isn't enough existing implementation for an automatic job run chain, so building the filesystem job lifecycle first is safer

### Code Scope

- Modify `src/cli/handlers/templateJobs.ts`
- Add `src/jobs/state.ts`
- Add `src/jobs/templates.ts`
- Change `src/jobs/classifier.ts` in Phase 2

### Verification

1. `list` lists `.claude/templates`
2. `new` creates the job directory and state file
3. `reply` updates the job content and state
4. Verify the classifier writing state in Phase 2

### Risks

- The frontmatter schema needs a minimal field set defined first
- Once it expands to "automatically running jobs", the scope grows considerably

### Effort Estimate

- MVP: medium
- Full job system: large

## 4. `assistant [sessionId]`

### Current State

- The main attach flow actually already exists:
  `src/main.tsx` (around line 4708)
- The base modules needed by the remote viewer exist:
  `src/remote/RemoteSessionManager.ts`
  `src/hooks/useAssistantHistory.ts`
  `src/assistant/sessionHistory.ts`
- What is really stubbed is mainly:
  `src/assistant/sessionDiscovery.ts`
  `src/assistant/AssistantSessionChooser.ts`
  `src/commands/assistant/assistant.ts`
  `src/assistant/index.ts`

### Goal

- Don't restore the entire KAIROS assistant system in one go.
- First make viewer attach work for an explicit sessionId, then gradually add discovery / chooser / install.

### Phase 4A: MVP

- Support only `claude assistant <sessionId>`
- For the no-argument `claude assistant` mode, first return a clear message:
  - the current version requires an explicit `sessionId`
  - discovery is not yet enabled
- This reuses the existing attach branch directly, without first restoring the chooser/install wizard

### Phase 4B

- Restore `discoverAssistantSessions()`
- Prefer reusing the existing sessions / bridge / teleport APIs as the data source, rather than a new protocol
- Let the no-argument `claude assistant` obtain a candidate session list

### Phase 4C

- Restore `AssistantSessionChooser`
- Allow interactive selection when there are multiple sessions

### Phase 4D

- Finally, consider the install wizard helper functions
- This part is about "how to guide the user when there is no session", not the core attach path

### Why Split

- Most of the attach rendering layer and the remote message channel are already there
- What is really missing is "how to discover the target session" and "how to select interactively"
- Pulling in the whole KAIROS normal mode in `src/assistant/index.ts` would let the scope get out of control

### Code Scope

- Phase 4A:
  - `src/main.tsx` (around line 4708)
  - `src/commands/assistant/index.ts`
- Phase 4B:
  - `src/assistant/sessionDiscovery.ts`
- Phase 4C:
  - `src/assistant/AssistantSessionChooser.ts`
- Phase 4D:
  - `src/commands/assistant/assistant.ts`

### Verification

1. `claude assistant <sessionId>` enters the remote viewer
2. Lazy history loading works
3. The no-argument mode first gives a clear message
4. Verify discovery / chooser / install separately in later phases

### Risks

- This is the largest of the four items
- Pulling in the whole KAIROS normal mode would balloon it from "viewer attach" into "full assistant mode recovery"

### Effort Estimate

- Phase 4A: medium
- All of 4A-4D: very large

## Suggested Execution Order

1. `claude daemon status` / `claude daemon stop`
2. `BG_SESSIONS`, starting with `ps/logs/kill`
3. `TEMPLATES`, starting with the job filesystem MVP
4. `assistant [sessionId]`, starting with explicit sessionId attach, then discovery/chooser/install

## Short Conclusion

Of these four, the best one to implement right away is `daemon status/stop`. `BG_SESSIONS` and `TEMPLATES` suit an MVP that first fills in the handlers and the filesystem loop. `assistant [sessionId]` can't be pushed in as one block; it should be restored in the order "attach → discovery → chooser → install".
