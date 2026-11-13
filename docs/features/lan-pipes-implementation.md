# LAN Pipes — Technical Implementation

Implementation details for developers. For the user guide, see [lan-pipes.md](./lan-pipes.md).

---

## Architecture

```
Machine A (192.168.50.22)                Machine B (192.168.50.27)
┌───────────────────────────┐           ┌───────────────────────────┐
│ PipeServer                │           │ PipeServer                │
│   UDS: ~/.claude/pipes/   │           │   UDS: ~/.claude/pipes/   │
│       cli-abc.sock        │           │       cli-def.sock        │
│   TCP: 0.0.0.0:<random>  │◄──TCP───►│   TCP: 0.0.0.0:<random>  │
├───────────────────────────┤           ├───────────────────────────┤
│ LanBeacon                 │           │ LanBeacon                 │
│   UDP 224.0.71.67:7101    │◄──UDP───►│   UDP 224.0.71.67:7101    │
├───────────────────────────┤           ├───────────────────────────┤
│ usePipeIpc (hook)         │           │ usePipeIpc (hook)         │
│   initPipeServer          │           │   initPipeServer          │
│   registerMessageHandlers │           │   registerMessageHandlers │
│   runMainHeartbeat        │           │   runSubHeartbeat         │
│   cleanupPipeIpc          │           │   cleanupPipeIpc          │
└───────────────────────────┘           └───────────────────────────┘
```

## Feature flag

`LAN_PIPES` — enabled in `DEFAULT_FEATURES` in `scripts/dev.ts` and `build.ts`.

All LAN code paths are gated at compile time through `feature('LAN_PIPES')`. `feature()` can only be used in an `if` or a ternary (a Bun compile-time constant constraint).

---

## Core files

| File | Description |
|------|------|
| `src/utils/pipeTransport.ts` | PipeServer/PipeClient (dual UDS + TCP mode) |
| `src/utils/lanBeacon.ts` | UDP multicast beacon + module singleton |
| `src/utils/ndjsonFramer.ts` | Shared NDJSON socket frame parsing |
| `src/utils/pipeRegistry.ts` | File registry + `mergeWithLanPeers()` |
| `src/utils/peerAddress.ts` | Address resolution (uds/bridge/tcp schemes) |
| `src/utils/pipePermissionRelay.ts` | Permission forwarding + `setPipeRelay`/`getPipeRelay` singleton |
| `src/hooks/usePipeIpc.ts` | Lifecycle hook (extracted from REPL.tsx) |
| `src/hooks/usePipeRelay.ts` | Message relay hook |
| `src/hooks/usePipePermissionForward.ts` | Permission forwarding hook |
| `src/hooks/usePipeRouter.ts` | Input routing hook |
| `src/hooks/useMasterMonitor.ts` | Slave registry + message subscription |

---

## PipeServer TCP extension

`src/utils/pipeTransport.ts`

### Types

```typescript
export type PipeTransportMode = 'uds' | 'tcp'
export type TcpEndpoint = { host: string; port: number }
export type PipeServerOptions = { enableTcp?: boolean; tcpPort?: number }
```

### PipeServer changes

- `setupSocket(socket)` — a shared method extracted from `start()`, used by both UDS and TCP
- `start(options?)` — optionally enables TCP; port=0 lets the OS assign one
- Maintains two `net.Server` instances internally, sharing one `clients: Set<Socket>` and one set of `handlers`
- The `tcpAddress` getter exposes the TCP port
- `close()` closes both servers

Socket frame parsing uses `attachNdjsonFramer()` from `ndjsonFramer.ts` (replacing 3 duplicated copies).

### PipeClient changes

- The constructor takes a new optional `TcpEndpoint` parameter
- `connect()` dispatches to `connectTcp()` or `connectUds()` depending on the tcpEndpoint
- TCP does not need to poll for the file to exist; it connects directly

---

## LAN Beacon

`src/utils/lanBeacon.ts`

### Protocol parameters

| Parameter | Value |
|------|-----|
| Multicast group | `224.0.71.67` |
| Port | `7101` |
| Broadcast interval | `3000ms` |
| Peer timeout | `15000ms` |
| TTL | `1` |

### Announce packet

```typescript
type LanAnnounce = {
  proto: 'claude-pipe-v1'
  pipeName: string
  machineId: string
  hostname: string
  ip: string
  tcpPort: number
  role: 'main' | 'sub'
  ts: number
}
```

### API

```typescript
class LanBeacon extends EventEmitter {
  constructor(announce: Omit<LanAnnounce, 'proto' | 'ts'>)
  start(): void
  stop(): void
  getPeers(): Map<string, LanAnnounce>  // defensive copy
  updateAnnounce(partial): void         // uses spread (immutable update)

  on('peer-discovered', (peer: LanAnnounce) => void)
  on('peer-lost', (pipeName: string) => void)
}
```

### Storage

A module-level singleton: `getLanBeacon()` / `setLanBeacon()`. It is not attached to the Zustand state (to avoid losing the reference when `setState` spreads).

### NIC binding

`addMembership(group, localIp)` + `setMulticastInterface(localIp)` pin the LAN network card. This fixes the problem on Windows where WSL/Docker virtual adapters hijack multicast.

---

## Hook architecture

About 830 lines of Pipe IPC code extracted from REPL.tsx:

### usePipeIpc (lifecycle)

`src/hooks/usePipeIpc.ts` (623 lines)

Loaded at the top of REPL.tsx through a feature-gated require:

```typescript
const usePipeIpc = feature('UDS_INBOX')
  ? require('../hooks/usePipeIpc.js').usePipeIpc
  : () => undefined;

// Inside the component
usePipeIpc({ store, handleIncomingPrompt });
```

Internally it loads dependencies through **lazy getter** functions (to avoid circular dependencies that crash the Bun runtime):

```typescript
const pt = () => require('../utils/pipeTransport.js')
const pr = () => require('../utils/pipeRegistry.js')
const mm = () => require('./useMasterMonitor.js')
// ...
```

`import type` is used for static types (it does not trigger module loading).

### Four phase functions

| Function | Responsibility |
|------|------|
| `initPipeServer` | Role determination + server creation + beacon startup |
| `registerMessageHandlers` | Five handlers: ping, attach, prompt, permission, detach |
| `runMainHeartbeat` | Cleanup + discovery + auto-attach + dead-connection cleanup |
| `runSubHeartbeat` | Detects whether the main is alive; on death, takes over or goes standalone |

### usePipeRelay (message relay)

`src/hooks/usePipeRelay.ts` (38 lines)

Provides `relayPipeMessage()` and `pipeReturnHadErrorRef`. The relay function is read through the `getPipeRelay()` module singleton (replacing `globalThis.__pipeSendToMaster`).

### usePipePermissionForward (permission forwarding)

`src/hooks/usePipePermissionForward.ts` (159 lines)

Subscribes to `subscribePipeEntries()` and handles:
- `permission_request` → parse the payload → look up the tool → add to the confirmation queue
- `permission_cancel` → remove from the queue
- `stream/error/done` → shown as system messages (with role + IP label)

### usePipeRouter (input routing)

`src/hooks/usePipeRouter.ts` (130 lines)

Provides `routeToSelectedPipes(input): boolean`. It reads `selectedPipes` + `routeMode` and sends to each connected target in turn. Notifications show `[role] hostname/ip` (LAN peer) or `[role]` (local machine).

---

## Registry parallel probing

`src/utils/pipeRegistry.ts`

### getAliveSubs()

```typescript
export async function getAliveSubs(): Promise<PipeRegistrySub[]> {
  const registry = await readRegistry()
  const results = await Promise.all(
    registry.subs.map(sub =>
      isPipeAlive(sub.pipeName, 1000).then(alive => alive ? sub : null)
    )
  )
  return results.filter(Boolean)
}
```

### cleanupStaleEntries()

Two phases:
1. **Lock-free parallel probing**: `Promise.all` probes the main and all subs
2. **Brief locked write**: `acquireLock()` → re-read → apply changes → write → `releaseLock()`

Lock hold time drops from N seconds to about 10ms.

### getMachineId()

Windows/macOS use `execFile` (asynchronous), which does not block the main thread. The result is cached, so only the first call executes.

---

## NDJSON protocol

### Message types

| Type | Direction | Data |
|------|------|------|
| `ping` / `pong` | Both | None |
| `attach_request` | M→S | `meta: { machineId }` |
| `attach_accept` / `attach_reject` | S→M | `data: reason` |
| `detach` | M→S | None |
| `prompt` | M→S | `data: prompt_text` |
| `prompt_ack` | S→M | `data: 'accepted'` |
| `stream` | S→M | `data: partial_text` |
| `done` | S→M | None |
| `error` | Both | `data: error_message` |
| `permission_request` | S→M | `data: JSON(PipePermissionRequestPayload)` |
| `permission_response` | M→S | `data: JSON(PipePermissionResponsePayload)` |
| `permission_cancel` | M→S | `data: JSON({ requestId, reason })` |

### Frame format

One JSON object per line, separated by `\n`:
```
{"type":"ping","from":"cli-abc","ts":"2026-04-11T00:00:00.000Z"}\n
{"type":"prompt","data":"check git status","from":"cli-abc"}\n
```

---

## Cross-machine attach flow

```
CLI-B (192.168.50.27) heartbeat loop
  → beacon.getPeers() discovers CLI-A (192.168.50.22)
  → connectToPipe(pName, myName, 3000, { host: '192.168.50.22', port: 58853 })
  → PipeClient.connectTcp() → net.createConnection({ host, port })
  → client.send({ type: 'attach_request', meta: { machineId } })
  → CLI-A receives it:
      isLanPeer = (msg.meta.machineId !== myMachineId) → true
      → skips the role check and replies directly with { type: 'attach_accept' }
      → setPipeRelay(socket.write)
  → CLI-B receives attach_accept
  → addSlaveClient(pName, client)
  → store.setState: role='master', slaves[pName] = { status: 'idle' }
```

Key point: a cross-machine attach does not require the other side to be in the sub role. LAN peers are distinguished by `machineId`.

---

## SendMessageTool TCP support

`packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts`

- The `to` field supports the `tcp:host:port` format
- `checkPermissions`: the `tcp:` scheme returns `behavior: 'ask'` with `classifierApprovable: false`
- `call()`: creates a temporary `PipeClient` → connect → send → disconnect

---

## Tests

| File | Tests | Coverage |
|------|--------|------|
| `lanBeacon.test.ts` | 7 | Socket initialization, announce, peer discovery/filtering/cleanup |
| `peerAddress.test.ts` | 8 | Scheme parsing, parseTcpTarget, port range validation |
| `pipePermissionRelay.test.ts` | 2 | setPipeRelay singleton, permission request/response |
| `pipeTransport.test.ts` | 2 | Basic UDS behavior |
| `useMasterMonitor.test.ts` | 5 | Slave registration/removal, event emission |

Full suite: 2190 pass / 0 fail

---

## Known limitations

1. **No TCP authentication**: anyone on the same LAN who knows the port number can connect
2. **Beacon broadcasts in plaintext**: IP/hostname/machineId are not hashed
3. **Single NIC selection**: `getLocalIp()` returns the first non-internal IPv4 address, which may pick a VPN
4. **Random ports**: the port differs on every start, so discovery relies on the beacon
5. **SendMessageTool creates a new connection every time**: it does not reuse an existing slave client

## Future improvements

1. HMAC-SHA256 TCP handshake authentication
2. Hash the machineId before broadcasting
3. Multi-NIC selection (prefer RFC 1918 addresses)
4. Configurable fixed port range
5. TLS-encrypted transport
6. Have SendMessageTool reuse connected slave clients
