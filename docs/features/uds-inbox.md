# UDS_INBOX / pipes

## Overview

`UDS_INBOX` is no longer an "empty-shell flag"; it is a local IPC capability that has landed. It carries two layers with different goals, which must be understood separately:

1. **UDS peer messaging**
   - Targets any Claude Code process.
   - Uses `src/utils/udsMessaging.ts` and `src/utils/udsClient.ts`.
   - Exposed through `/peers` and the `uds:<socket-path>` address of `SendMessageTool`.
2. **pipes control plane**
   - Targets master/slave collaboration between interactive REPL sessions.
   - Uses `src/utils/pipeTransport.ts`, `src/utils/pipeRegistry.ts` and the inline bootstrap in `src/screens/REPL.tsx`.
   - Exposed through `/pipes`, `/attach`, `/detach`, `/send`, `/pipe-status`, `/history` and `/claim-main`.

Both layers depend on a local socket, but their responsibilities differ. `/peers` solves "find other sessions and send them messages"; `/pipes` solves "turn one REPL into a controlled worker of another REPL".

## Why a separate `pipes` layer

There are three practical reasons for a separate `pipes` layer:

1. **Different naming and role model**
   - The UDS peer layer addresses by `messagingSocketPath`.
   - The pipes layer works with `cli-xxxxxxxx` session names, `main/sub/master/slave` roles and a `machineId` registry.
2. **Different interaction semantics**
   - The peer layer is general message delivery.
   - The pipes layer needs attach, detach, history collection, selective broadcast, a status bar and REPL shortcuts.
3. **Different UI integration**
   - The peer layer mainly serves tool calls.
   - The pipes layer directly affects the REPL submit path and the PromptInput footer.

If the two were merged by force, the generic addressing of `SendMessageTool` and the REPL's master/slave control would contaminate each other, and the command semantics would become confusing.

## Current communication model

### 1. UDS peer messaging

- Server: `src/utils/udsMessaging.ts`
- Client: `src/utils/udsClient.ts`
- Discovery: read `~/.claude/sessions/*.json`
- Addressing: `uds:<socket-path>`
- Transport: **local Unix socket / Windows named pipe**

This layer is the real "general inbox".

### 2. pipes control plane

- Server/client: `src/utils/pipeTransport.ts`
- Registry: `src/utils/pipeRegistry.ts`
- Entry that takes effect: `src/screens/REPL.tsx`
- Discovery: scan `~/.claude/pipes/` + `registry.json`
- Session name: `cli-${sessionId.slice(0, 8)}`
- Transport: **local Unix socket / Windows named pipe**

This layer is the real "master/slave REPL coordination plane".

## Facts about "LAN communication"

The current implementation is **not** a real LAN transport.

The code does store these fields:

- `localIp`
- `hostname`
- `machineId`
- `mac`

but for now they are only used for:

1. Registry display
2. main/sub identity decisions
3. Machine-level ownership switching in `claim-main`
4. Status output and troubleshooting information

They are **not** used to create TCP/WebSocket connections. The real transport is still the local socket path returned by `getPipePath(name)`.

So a more accurate description right now is:

- `pipes` supports **local multi-instance collaboration**
- The `registry` carries **machine identity metadata**
- But a **cross-machine LAN transport is not implemented yet**

A real LAN version in the future would need at least:

1. A TCP/WebSocket transport
2. Authentication and session authorization
3. Discovery and address exchange
4. Timeouts, reconnection and security boundaries

## Current REPL behavior

The behavior currently in production is handled by the inline implementation in `src/screens/REPL.tsx`:

1. At startup, create the pipe server of the current REPL
2. Decide `main` / `sub` through `pipeRegistry`
3. Handle `attach_request` / `detach` / `prompt`
4. The main instance probes heartbeats and maintains `slaves`
5. `/pipes` opens the status bar and maintains the selector
6. When a normal message is submitted, it is broadcast only to the **connected** selected pipes

Latest convergence points:

- There used to be a leftover hook-based scheme that was never wired up
- It is now explicit that the inline bootstrap in `REPL.tsx` is the only implementation in effect
- A selected-but-not-connected pipe no longer causes local handling to be skipped by mistake

## Doc/code alignment conventions

Future descriptions of `UDS_INBOX` / `pipes` should follow these statements:

1. Call it "local IPC / local multi-instance collaboration" by default
2. Do not describe the `localIp` / `hostname` metadata as a finished LAN transport
3. Clearly distinguish the two responsibilities of `/peers` and `/pipes`
4. Treat `src/screens/REPL.tsx`, `src/utils/pipeTransport.ts` and `src/utils/pipeRegistry.ts` as the source of truth
