# Agent Communication Fix Jira Tasks

- Version: v1.0
- Generated: 2026-04-25
- Source: consolidated from the per-file execution checklist and cross-validation feedback
- Scope: ACP Agent / Bridge / Remote Control Server / REPL hook lifecycle
- How to use: this is the single execution task document; each `JIRA-*` section can be split directly into one Jira issue, with consistent fields to make copying or re-importing easy.

---

## Nature of the plan

This document is a target-state execution plan, not a list of ad-hoc patches. Every ticket must deliver a clear final code state, test coverage, and a regression boundary; local workarounds must not be used to paper over problems.

---

## General execution rules

1. Boundary safety first, internal optimization later: fix WS inbound size and input validation first, to keep production risk from growing.
2. Each file can be rolled back independently: changes within a file stay cohesive, to ease rollback and bisect.
3. Do not change protocol semantics, only fix implementation defects: apart from unifying the `resource_link` representation, the main-flow contract does not change.
4. Every file must have acceptance output: either test cases or log/metric verification.
5. Before release, confirm no regression in protocol-layer behavior: the `stopReason` decision and the `sessionUpdate` send order stay stable.

---

## Epic

### JIRA-EPIC-001: Improve Agent communication stability and boundary safety

- Issue Type: Epic
- Priority: P0
- Owner: Core communication / backend gateway / QA
- Scope: ACP Agent, ACP Bridge, Remote Control Server, REPL initialization lifecycle
- Goal: fix long-session resource leaks, fill in the WebSocket inbound boundary, unify prompt conversion, narrow type risk, and add key regression tests.

#### Epic acceptance criteria

- `bun run typecheck` has 0 errors.
- The P0 WebSocket oversized-message rejection logic is implemented and covered by tests.
- ACP bridge abort listeners do not accumulate over their lifecycle.
- Prompt conversion has a single source of implementation.
- settings/defaultMode actually influences the ACP permission mode, and `_meta.permissionMode` keeps the highest priority.
- The target REPL hook suppress cleanup is done, and timer cleanup is complete.

---

## P0 Tickets

### JIRA-001: Add a message size limit to the session ingress WebSocket

- Issue Type: Bug
- Priority: P0
- Story Points: 3
- Owner: Backend/gateway
- Files:
  - `packages/remote-control-server/src/routes/v1/session-ingress.ts`
- Follow-up ticket: JIRA-008 (P1 type and decode path cleanup in the same file)

#### Reference code location

- `packages/remote-control-server/src/routes/v1/session-ingress.ts:100-106`

#### Background

`session-ingress` currently lacks a WebSocket message size limit. The ACP route already has a similar limit, so the two entry points are inconsistent at the boundary, which could let large packets consume memory or bypass entry protection.

#### Implementation requirements

- Add `MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024`, matching the ACP route's 10MB limit.
- In `onMessage`, check the payload size first, right after decoding.
- On overflow, run `ws.close(1009, "message too large")`.
- Log `sessionId`, payload size, and the limit.
- Decode `string`, `ArrayBuffer`, and `Uint8Array` through a unified branch.
- Unsupported types are rejected and logged directly, without entering the business handler.

#### Acceptance criteria

- An 11MB payload is closed with 1009.
- A valid 1KB payload still enters the handler normally.
- Unsupported-type payloads do not enter the handler.
- The URL, auth, and session parsing logic is unchanged.

#### Regression scope

- Remote Control Server session ingress WebSocket.
- Normal session message forwarding.
- WebSocket close code behavior.

#### Risk level

- Medium. Changing the entry logic may affect special client payload types.

#### Must verify

- Add session-ingress WebSocket cases for large packets, small packets, and bad-type payloads in `packages/remote-control-server/src/__tests__/routes.test.ts`.
- Run `bun run typecheck`.

---

### JIRA-002: Fix the ACP bridge abort listener lifecycle leak

- Issue Type: Bug
- Priority: P0
- Story Points: 3
- Owner: Core communication
- Files:
  - `src/services/acp/bridge.ts`

#### Reference code location

- `src/services/acp/bridge.ts:576-585`

#### Background

The abort branch of the ACP bridge's `Promise.race` registers a listener but lacks complete cleanup. In long sessions or high-frequency next scenarios, listeners may accumulate.

#### Implementation requirements

- Rewrite the abort race so the listener can be cleaned up.
- Keep a handler reference after registering the listener.
- When `sdkMessages.next()` returns first, `removeEventListener` must run.
- Clean up in `finally` on the abort, throw, and return paths.
- Do not change the `stopReason` decision logic.
- Do not change the `sessionUpdate` send order.

#### Acceptance criteria

- Simulating 10k next calls without abort, the listener count does not grow.
- The abort scenario still returns `cancelled`.
- No regression in the existing streaming/session update behavior.

#### Regression scope

- ACP bridge streaming loop.
- User cancel requests.
- SDK generator exception paths.

#### Risk level

- Medium. The async control-flow change needs coverage of the cancel and exception paths.

#### Must verify

- Add a listener cleanup unit test.
- Run `bun run typecheck`.

---

## P1 Tickets

### JIRA-003: Optimize the ACP agent pending prompt queue to O(1) dequeue

- Issue Type: Task
- Priority: P1
- Story Points: 5
- Owner: Core communication
- Files:
  - `src/services/acp/agent.ts`

#### Reference code location

- `src/services/acp/agent.ts:332-339`

#### Background

The current pending prompt queue uses `Map + sort` to get the next item, which adds unnecessary sorting cost as the queue grows.

#### Implementation requirements

- Change to a combination of `queue: string[]` + `pendingMap: Map<string, PendingPrompt>`.
- Enqueue runs `queue.push(id)` and `pendingMap.set(id, prompt)`.
- Dequeue lazily skips cancelled items from the head of the queue.
- Cancel only deletes from `pendingMap`, without deleting from the middle of the array.
- Keep the existing cancel semantics and dequeue order.

#### Acceptance criteria

- Dequeue order is correct with 1000 pending prompts.
- A cancelled prompt is never resolved.
- Dequeue no longer depends on a full sort.
- With 1000 queued prompts, dequeue time is lower than the old implementation; the test records the old implementation's complexity risk and the new implementation's O(1) dequeue path.
- Behavior is compatible with the old implementation.

#### Regression scope

- ACP prompt queue.
- Concurrent prompt requests.
- Prompt cancel / resolve boundaries.

#### Risk level

- Medium. The queue structure change may introduce cancel-boundary issues.

#### Must verify

- Add queue order and cancel tests.
- Add a performance assertion or log record for the 1000-prompt scenario.

---

### JIRA-004: Wire up real settings reading and validate the ACP permission mode

- Issue Type: Bug
- Priority: P1
- Story Points: 3
- Owner: Core communication
- Files:
  - `src/services/acp/agent.ts`

#### Reference code location

- `src/services/acp/agent.ts:465-467`

#### Background

`getSetting()` is not actually wired into the project configuration yet, so the default permission mode setting does not take effect as expected.

#### Implementation requirements

- Wire in the project's existing settings/config reading logic.
- Accept only valid permission mode enum values.
- Invalid values fall back to `default`.
- `_meta.permissionMode` keeps the highest priority.
- Do not change external protocol fields.

#### Acceptance criteria

- settings/defaultMode can influence the default permission mode.
- `_meta.permissionMode` can override settings.
- Invalid settings values do not propagate to runtime.
- Type checking passes.

#### Regression scope

- ACP agent session initialization.
- Permission mode sync.
- Client `_meta` override logic.

#### Risk level

- Medium. A configuration priority mistake would affect permission behavior.

#### Must verify

- Add defaultMode / `_meta.permissionMode` priority tests.
- Run `bun run typecheck`.

---

### JIRA-005: Single-source the ACP prompt conversion logic

- Issue Type: Refactor
- Priority: P1
- Story Points: 5
- Owner: Core communication
- Files:
  - `src/services/acp/agent.ts`
  - `src/services/acp/bridge.ts`
  - `src/services/acp/promptConversion.ts` (new)

#### Reference code locations

- `src/services/acp/agent.ts:754-758`
- `src/services/acp/agent.ts:764-785`
- `src/services/acp/bridge.ts:522-537`

#### Background

The ACP agent and bridge duplicate prompt conversion logic, so output strategies for blocks such as `resource_link` can easily diverge.

#### Implementation requirements

- Add a shared conversion module `src/services/acp/promptConversion.ts`.
- `agent.ts` and `bridge.ts` are changed to call the shared conversion function.
- Delete the real implementation of `promptToQueryContent` in `bridge.ts`; if the export must remain, only a wrapper that calls the shared function may stay.
- `resource_link` output changes to stable plain-text metadata; markdown links are forbidden.
- Keep the conversion semantics of the other blocks unchanged.

#### Acceptance criteria

- Only one real prompt conversion implementation remains in the whole repository.
- The same input block produces identical output in agent and bridge.
- `resource_link` no longer outputs the `[name](uri)` form.
- Related tests cover conversion consistency.

#### Regression scope

- ACP prompt input.
- Bridge query content.
- Resource link prompt representation.

#### Risk level

- Medium. The text format change may affect downstream prompt snapshots or assertions.

#### Must verify

- Add shared conversion unit tests.
- Search the whole repository for duplicate conversion functions.
- Run `bun run typecheck`.

---

### JIRA-006: Clean up REPL onInit effect dependencies and complete timer cleanup

- Issue Type: Task
- Priority: P1
- Story Points: 3
- Owner: Terminal UI
- Files:
  - `src/screens/REPL.tsx`

#### Reference code locations

- `src/screens/REPL.tsx:654-662`
- `src/screens/REPL.tsx:4996-5005`

#### Background

The target initialization effect in REPL has a hook dependency suppress, and the warm-up timer also needs explicit cleanup, so frequent mounting/unmounting does not leave dangling tasks.

#### Implementation requirements

- Tidy the `onInit` lifecycle, using a stable reference or inlining the effect.
- Remove the `exhaustive-deps` suppress in the target section.
- Keep the unmount cleanup behavior unchanged.
- Record the timeout id in the warm-up effect.
- Run `clearTimeout(timeoutId)` in cleanup.
- Keep the `alive` check as concurrency protection.

#### Acceptance criteria

- The target section no longer needs a hooks lint suppress.
- Frequently opening/closing the search bar does not grow dangling timers.
- No regression in REPL initialization behavior.

#### Regression scope

- REPL initialization.
- Search bar warm-up.
- Component unmount cleanup.

#### Risk level

- Medium. Cleaning up React effect dependencies may change initialization timing.

#### Must verify

- Run lint/typecheck.
- Cover REPL mount/unmount manually or with tests.

---

### JIRA-007: Narrow the `any` types of ACP route WebSocket events

- Issue Type: Task
- Priority: P1
- Story Points: 2
- Owner: Backend/gateway
- Files:
  - `packages/remote-control-server/src/routes/acp/index.ts`

#### Reference code location

- `packages/remote-control-server/src/routes/acp/index.ts:108-146`

#### Background

The WebSocket events and socket parameters in the ACP route use `any`, which weakens compile-time protection.

#### Implementation requirements

- Define minimal WebSocket event types: open/message/close/error.
- Replace `_evt: any`, `evt: any`, and `ws: any` with narrow types.
- Do not change the payload decode and size check strategy.
- Do not change existing handler behavior.

#### Acceptance criteria

- Compile time can catch erroneous event field access.
- Existing WebSocket behavior is unchanged.
- `bun run typecheck` passes.

#### Regression scope

- ACP WebSocket route.
- Message decode.
- Close/error handlers.

#### Risk level

- Low. Mainly a type-narrowing change.

#### Must verify

- Run `bun run typecheck`.
- Existing tests keep passing.

---

### JIRA-008: Narrow the session ingress WebSocket event types and decode path

- Issue Type: Task
- Priority: P1
- Story Points: 3
- Owner: Backend/gateway
- Files:
  - `packages/remote-control-server/src/routes/v1/session-ingress.ts`
- Prerequisite: JIRA-001 merged

#### Reference code location

- `packages/remote-control-server/src/routes/v1/session-ingress.ts:100-106`

#### Background

After the P0 size guard is done, session ingress still needs its event types and decode path narrowed further, to reduce implicit type risk.

#### Implementation requirements

- Define or reuse a minimal WebSocket message event type.
- Consolidate the message decode branches into one small function.
- Keep the P0 size guard and close code semantics.
- Do not change auth/session parsing.

#### Acceptance criteria

- The decode path is single and clear.
- Unsupported payload types have an explicit rejection path.
- `bun run typecheck` passes.

#### Regression scope

- Session ingress WebSocket message handling.
- The P0 large-packet rejection logic.

#### Risk level

- Low to medium. Same file as P0, so take care to avoid duplicated-change conflicts.

#### Must verify

- Same batch of tests as JIRA-001.
- Run `bun run typecheck`.

---

## QA Tickets

### JIRA-009: Add ACP communication regression tests

- Issue Type: Test
- Priority: P1
- Story Points: 5
- Owner: QA/core communication
- Files:
  - `src/services/acp/agent.ts`
  - `src/services/acp/bridge.ts`
  - `src/services/acp/promptConversion.ts`
  - `src/services/acp/__tests__/agent.test.ts`
  - `src/services/acp/__tests__/bridge.test.ts`
  - `src/services/acp/__tests__/promptConversion.test.ts`

#### Coverage scenarios

- A long session of 10k turns, with no abort listener accumulation.
- Prompt queue with 1000 concurrent queued prompts, with correct cancel/dequeue order.
- settings/defaultMode and `_meta.permissionMode` priority is correct.
- `resource_link` conversion output is consistent between agent and bridge.

#### Acceptance criteria

- The new tests pass stably locally.
- They do not depend on a real network or external services.
- Test mocks follow the repository conventions, mocking only side-effect chains.

#### Regression scope

- ACP bridge.
- ACP agent.
- Prompt conversion.
- Permission mode resolution.

#### Risk level

- Medium. Async tests may be unstable, so time-sensitive assertions must be avoided.

#### Must verify

- Run the related `bun test`.
- Run `bun run typecheck`.

---

### JIRA-010: Add Remote Control Server WebSocket inbound regression tests

- Issue Type: Test
- Priority: P1
- Story Points: 3
- Owner: QA/backend
- Files:
  - `packages/remote-control-server/src/__tests__/routes.test.ts`
  - `packages/remote-control-server/src/routes/v1/session-ingress.ts`

#### Coverage scenarios

- An 11MB session ingress payload is closed with 1009 (aligned with the 10MB limit).
- A valid small payload enters the handler normally.
- An unsupported payload type is rejected.
- Logs or observable output include sessionId, payload size, and the limit.

#### Acceptance criteria

- An 11MB payload is closed with 1009 (aligned with the 10MB limit).
- The new tests pass stably.
- No real external services are started.
- The existing route public contract is unchanged.

#### Regression scope

- RCS session ingress route.
- WebSocket message handling.
- Close code behavior.

#### Risk level

- Medium. The tests must adapt to the existing WebSocket/mock infrastructure.

#### Must verify

- Run the RCS package's related tests.
- Run `bun run typecheck`.

---

## Recommended execution order

The pace matches the original plan: finish all P0 changes and smoke verification first, then start the P1 work; test tickets can be interleaved but must not bypass the P0 gate.

1. JIRA-001: close the entry large-packet risk first.
2. JIRA-002: fix the long-session listener lifecycle.
3. JIRA-010: add RCS inbound tests to lock in the P0 behavior.
4. JIRA-003: optimize the pending prompt queue.
5. JIRA-004: wire up settings/defaultMode.
6. JIRA-005: single-source prompt conversion.
7. JIRA-009: add ACP regression tests.
8. JIRA-006: clean up the REPL effect/timer.
9. JIRA-007: narrow the ACP route types.
10. JIRA-008: narrow the session ingress types and decode path.

---

## Release Checklist

- [ ] `bun run typecheck` has 0 errors
- [ ] P0 tickets merged and tests passing
- [ ] ACP regression tests passing
- [ ] RCS WebSocket inbound tests passing
- [ ] Prompt conversion single-sourcing confirmed by code search
- [ ] Permission mode priority tests passing
- [ ] No regression in protocol-layer behavior (stopReason decision, sessionUpdate send order)
- [ ] REPL hook/timer changes pass lint/typecheck
- [ ] The final change notes include risks and uncovered items
