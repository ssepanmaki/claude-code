# Task 004: assistant [sessionId] — phased recovery

> Source: item 4 of [stub-recovery-design-1-4.md](../features/stub-recovery-design-1-4.md)
> Priority: P3
> Effort: Phase 4A is medium; doing 4A-4D in full is large
> Status: Phase 4A DONE, 4B-4D TODO

## Goal

Do not restore the whole KAIROS assistant system at once. First make "viewer attach with an explicit sessionId" work, then add discovery / chooser / install step by step.

## Background

- The main attach flow already exists (`src/main.tsx:4708`)
- The base modules the remote viewer needs already exist:
  - `src/remote/RemoteSessionManager.ts`
  - `src/hooks/useAssistantHistory.ts`
  - `src/assistant/sessionHistory.ts`
- What is really still a stub is mainly:
  - `src/assistant/sessionDiscovery.ts`
  - `src/assistant/AssistantSessionChooser.tsx`
  - `src/commands/assistant/assistant.tsx:7`
  - `src/assistant/index.ts`

## Phased implementation

### Phase 4A: MVP — attach with an explicit sessionId

**Modified files:**

| File | Change |
|------|--------|
| `src/main.tsx` | Make sure the attach branch works |
| `src/commands/assistant/index.ts` | Implement the explicit sessionId argument entry |

**Behavior:**
- `claude assistant <sessionId>` — enter the remote viewer
- `claude assistant` (no arguments) — return a clear message: this version needs an explicit sessionId; discovery is not enabled yet

**Verification:**
- [ ] `claude assistant <sessionId>` enters the remote viewer
- [ ] Lazy loading of history works
- [ ] The no-argument mode gives a clear message

### Phase 4B: session discovery

**Modified files:**

| File | Change |
|------|--------|
| `src/assistant/sessionDiscovery.ts` | Restore `discoverAssistantSessions()` |

**Behavior:**
- Prefer reusing the existing sessions / bridge / teleport APIs as the data source; add no new protocol
- `claude assistant` with no arguments can obtain a list of candidate sessions

**Verification:**
- [ ] A no-argument call lists the available sessions
- [ ] The data source reuses existing channels

### Phase 4C: session chooser

**Modified files:**

| File | Change |
|------|--------|
| `src/assistant/AssistantSessionChooser.ts` | Restore the interactive chooser |

**Behavior:**
- With several sessions, the user can choose interactively

**Verification:**
- [ ] The chooser appears when there are multiple sessions
- [ ] Attach works correctly after choosing

### Phase 4D: install wizard

**Modified files:**

| File | Change |
|------|--------|
| `src/commands/assistant/assistant.ts` | Restore the install wizard helper functions |

**Behavior:**
- How to guide the user when there is no session

**Verification:**
- [ ] When no session is available, the user is guided to create/connect one

## Why it is split

- Most of the attach render layer and the remote message channel are already in place
- What is really missing is "how to discover the target session" and "how to choose interactively"
- Pulling in the whole normal KAIROS mode of `src/assistant/index.ts` as well would make the scope run away

## Risks

- This is the largest of the four items
- Once the whole normal KAIROS mode is pulled in, it grows from "viewer attach" into "full assistant mode recovery"

## Dependencies

- The session registry pattern of Task 002 can be reused
