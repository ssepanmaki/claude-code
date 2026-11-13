# BRIDGE_MODE — remote control

> Feature Flag: `FEATURE_BRIDGE_MODE=1`
> Implementation status: fully usable (v1 + v2 implementations)
> References: 28

## 1. Overview

BRIDGE_MODE registers the local CLI as a "bridge environment" that can be driven remotely from claude.ai or another control plane. The local terminal becomes an "executor" that accepts and carries out remote instructions.

### Core features

- **Environment registration**: the local CLI registers with Anthropic's servers as an available bridge environment
- **Work polling**: long-polls for remote task assignments
- **Session management**: create, resume and archive remote sessions
- **Permission passthrough**: remote permission requests go to the control plane, and the user approves or denies them on claude.ai
- **Heartbeat keepalive**: periodic heartbeats extend the task lease
- **Trusted device**: v2 supports trusted device tokens for stronger security

## 2. Implementation architecture

### 2.1 Version history

| Version | Implementation | Characteristics |
|------|------|------|
| v1 (env-based) | `src/bridge/replBridge.ts` | The traditional bridge based on environment variables |
| v2 (env-less) | `src/bridge/remoteBridgeCore.ts` | No environment variables needed; a more secure bridge |

### 2.2 API protocol

File: `src/bridge/bridgeApi.ts`

The Bridge API Client provides 9 core operations:

| Operation | HTTP | Description |
|------|------|------|
| `registerBridgeEnvironment` | POST `/v1/environments/bridge` | Registers the local environment and returns `environment_id` + `environment_secret` |
| `pollForWork` | GET `/v1/environments/{id}/work/poll` | Long-polls for a task (10s timeout) |
| `acknowledgeWork` | POST `/v1/environments/{id}/work/{workId}/ack` | Acknowledges receipt of a task |
| `stopWork` | POST `/v1/environments/{id}/work/{workId}/stop` | Stops a task |
| `heartbeatWork` | POST `/v1/environments/{id}/work/{workId}/heartbeat` | Renews the task lease |
| `deregisterEnvironment` | DELETE `/v1/environments/bridge/{id}` | Deregisters the environment |
| `archiveSession` | POST `/v1/sessions/{id}/archive` | Archives a session (409 = already archived, idempotent) |
| `sendPermissionResponseEvent` | POST `/v1/sessions/{id}/events` | Sends a permission approval result |
| `reconnectSession` | POST `/v1/environments/{id}/bridge/reconnect` | Reconnects an existing session |

### 2.3 Authentication flow

```
Register: OAuth Bearer Token → obtain environment_secret
Poll: environment_secret as Authorization
  ├── 401 → try an OAuth token refresh (onAuth401)
  └── refresh succeeded → retry once
```

**OAuth refresh**: the API client has a built-in `withOAuthRetry` mechanism. On 401 it calls `handleOAuth401Error` (the same pattern as v1/messages in withRetry.ts) and retries once after the refresh.

### 2.4 Security design

- **Path traversal protection**: `validateBridgeId()` validates every server-side ID against the `/^[a-zA-Z0-9_-]+$/` allowlist
- **BridgeFatalError**: non-retryable errors (401/403/404/410) are thrown directly to stop the retry loop
- **Trusted device token**: v2 raises the security level through the `X-Trusted-Device-Token` header
- **Idempotent registration**: supports `reuseEnvironmentId` for session resume, avoiding duplicate environments

### 2.5 Data flow

```
The claude.ai user picks a remote environment
         │
         ▼
POST /v1/environments/bridge (register)
         │
         ◀── environment_id + environment_secret
         │
         ▼
GET .../work/poll (long poll)
         │
         ◀── WorkResponse { id, data: { type, sessionId } }
         │
         ▼
POST .../work/{id}/ack (acknowledge)
         │
         ▼
sessionRunner creates a REPL session
         │
         ├── permission request → sendPermissionResponseEvent
         ├── heartbeat → heartbeatWork (renew)
         └── task done → archived automatically
```

### 2.6 Module structure

| Module | File | Responsibility |
|------|------|------|
| API Client | `bridgeApi.ts` | HTTP communication (register/poll/ack/heartbeat/deregister) |
| Session Runner | `sessionRunner.ts` | Creates/resumes REPL sessions |
| Bridge Config | `bridgeConfig.ts` | Configuration management (machine name, max sessions, etc.) |
| Transport | `replBridgeTransport.ts` | Bridge transport layer |
| Permission Callbacks | `bridgePermissionCallbacks.ts` | Permission request handling |
| Pointer | `bridgePointer.ts` | Pointer to the currently active bridge state |
| Flush Gate | `flushGate.ts` | Flush control |
| JWT Utils | `jwtUtils.ts` | JWT token utilities |
| Trusted Device | `trustedDevice.ts` | Trusted device management |
| Debug Utils | `debugUtils.ts` | Debug logging |
| Types | `types.ts` | Type definitions |

## 3. Key design decisions

1. **Long polling rather than WebSocket**: `pollForWork` uses an HTTP GET with a 10s timeout. Simple and reliable, with no WebSocket connection to maintain
2. **OAuth refresh built in**: the API client has its own `withOAuthRetry`, so no outer retry logic is needed
3. **Conditional requests**: registration supports `reuseEnvironmentId` for idempotent session resume
4. **v1/v2 coexist**: both implementations are in the code, with v2 the more secure upgrade
5. **Permissions flow both ways**: local permission requests go to claude.ai and the user approves them on the web

## 4. Usage

```bash
# Enable bridge mode
FEATURE_BRIDGE_MODE=1 bun run dev

# Connect remotely from claude.ai/code
# Pick the registered environment in the web UI

# Use with DAEMON (background supervisor)
FEATURE_BRIDGE_MODE=1 FEATURE_DAEMON=1 bun run dev
```

## 5. External dependencies

| Dependency | Notes |
|------|------|
| Anthropic OAuth | claude.ai subscription login |
| GrowthBook | The `tengu_ccr_bridge` gate |
| Bridge API | The `/v1/environments/bridge` family of endpoints |

## 6. File index

| File | Lines | Responsibility |
|------|------|------|
| `src/bridge/bridgeApi.ts` | 541 | API Client (core) |
| `src/bridge/sessionRunner.ts` | — | Session runner |
| `src/bridge/bridgeConfig.ts` | — | Configuration management |
| `src/bridge/replBridgeTransport.ts` | — | Transport layer |
| `src/bridge/bridgePermissionCallbacks.ts` | — | Permission callbacks |
| `src/bridge/bridgePointer.ts` | — | State pointer |
| `src/bridge/flushGate.ts` | — | Flush control |
| `src/bridge/jwtUtils.ts` | — | JWT utilities |
| `src/bridge/trustedDevice.ts` | — | Trusted device |
| `src/bridge/remoteBridgeCore.ts` | — | v2 core implementation |
| `src/bridge/types.ts` | — | Type definitions |
| `src/bridge/debugUtils.ts` | — | Debug tools |
| `src/bridge/pollConfigDefaults.ts` | — | Polling config defaults |
| `src/bridge/bridgeUI.ts` | — | UI components |
| `src/bridge/codeSessionApi.ts` | — | Code session API |
| `src/bridge/peerSessions.ts` | — | Peer session management |
| `src/bridge/sessionIdCompat.ts` | — | Session ID compatibility layer |
| `src/bridge/createSession.ts` | — | Session creation |
| `src/bridge/replBridgeHandle.ts` | — | Bridge handle |
