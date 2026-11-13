# acp-link — ACP Proxy Server

> Source directory: `packages/acp-link/`
> PR: #292
> Added: 2026-04-18

## 1. Overview

`acp-link` is an ACP (Agent Client Protocol) proxy server that bridges WebSocket clients to an ACP agent's stdio interface. It makes ACP agents such as Claude Code reachable remotely over WebSocket instead of only through local stdio.

### Key Features

- **WebSocket → stdio bridge**: converts browser/remote WebSocket connections into the ACP agent's stdin/stdout NDJSON stream
- **Session management**: create, load, resume, list and close sessions
- **Permission approval flow**: clients can approve the agent's tool permission requests remotely
- **RCS integration**: can connect to a Remote Control Server (RCS), registering the ACP agent there so it can be driven from the Web UI
- **HTTPS support**: built-in self-signed certificate generation for secure connections
- **Token authentication**: the auth token is generated automatically or configured through an environment variable

## 2. Architecture

### Standalone Mode

```
┌──────────────────┐    WebSocket     ┌──────────────────┐    stdio/NDJSON    ┌──────────────┐
│  Browser/Client  │ ◄──────────────►│  acp-link        │ ◄────────────────►│  ACP Agent   │
│  (WS Client)     │  ws://host:port  │  (Proxy Server)  │  spawn subprocess │  (Claude etc)│
└──────────────────┘                  └──────────────────┘                    └──────────────┘
```

### RCS Integration Mode

```
┌──────────────┐    WebSocket     ┌──────────────────┐    stdio/NDJSON    ┌──────────────┐
│  RCS Web UI  │ ◄──────────────►│  Remote Control  │ ◄─────────────────►│  acp-link    │
│  (/code/*)   │  ACP Relay WS   │  Server (RCS)    │  ACP events        │  + Agent     │
└──────────────┘                  └──────────────────┘                    └──────────────┘
```

### File Structure

```
packages/acp-link/
├── src/
│   ├── server.ts        # Main server: WS connection management, sessions, permission handling, message bridging
│   ├── rcs-upstream.ts  # RCS upstream client: REST registration + WS identify two-step flow
│   ├── cert.ts          # TLS certificate generation (self-signed)
│   ├── logger.ts        # Logging module
│   ├── types.ts         # JSON-RPC and ACP protocol type definitions
│   ├── cli/
│   │   ├── bin.ts       # CLI entry
│   │   ├── command.ts   # Command-line argument parsing
│   │   ├── app.ts       # App startup
│   │   └── context.ts   # Context configuration
│   └── __tests__/       # Tests (cert, server, types)
├── package.json
└── tsconfig.json
```

## 3. Installation and Usage

### Basic Usage

```bash
# Run directly (inside the monorepo)
# Note: claude itself does not support ACP; launch the ACP agent with ccb-bun --acp
bun packages/acp-link/src/cli/bin.ts ccb-bun -- --acp

# Specify port and host
acp-link --port 9000 --host 0.0.0.0 ccb-bun -- --acp

# Enable HTTPS (self-signed certificate)
acp-link --https ccb-bun -- --acp

# Debug mode
acp-link --debug ccb-bun -- --acp
```

### CLI Reference

```
USAGE
  acp-link [--port value] [--host value] [--debug] [--no-auth] [--https] <command>...
  acp-link --help
  acp-link --version

FLAGS
       [--port]     Port to listen on                  [default = 9315]
       [--host]     Host to bind to                    [default = localhost]
       [--debug]    Enable debug logging to file
       [--no-auth]  Disable authentication (dangerous)
       [--https]    Enable HTTPS with self-signed cert
    -h  --help      Print help information and exit
    -v  --version   Print version information and exit

ARGUMENTS
  command...  Agent command followed by its arguments (e.g. "ccb-bun -- --acp")
```

## 4. Authentication

A random token is generated automatically at startup. Clients should not put the token in the URL when connecting:

```
ws://localhost:9315/ws
```

WebSocket clients that cannot send an `Authorization` header must pass the token
through the `rcs.auth.<base64url-token>` subprotocol.

Configure a fixed token:

```bash
ACP_AUTH_TOKEN=my-fixed-token acp-link ccb-bun -- --acp
```

Disable authentication (not recommended; development only):

```bash
acp-link --no-auth ccb-bun -- --acp
```

## 5. RCS Integration

acp-link can register an ACP agent with a Remote Control Server so it can be driven remotely from the Web UI.

### Connecting

```bash
# Configure the RCS connection through environment variables
ACP_RCS_URL=http://localhost:3000 \
ACP_RCS_TOKEN=sk-rcs-your-key \
acp-link ccb-bun -- --acp
```

### Registration Flow (Two Steps)

1. **REST registration**: registers the environment with RCS via `POST /v1/environments/bridge`
2. **WS identify**: after the WebSocket connection is established, sends an `identify` message (carrying the agentId) in place of a full `register`

RCS's ACP WebSocket connection does not accept a URL query token. acp-link sends `ACP_RCS_TOKEN`
through the `rcs.auth.<base64url-token>` WebSocket subprotocol.

```
acp-link                          RCS
   │                                │
   │── POST /v1/environments/bridge ──►│  (REST registration)
   │◄── { agentId, sessionId } ───────│
   │                                │
   │── WS connect ─────────────────►│  (WebSocket)
   │── identify { agentId } ────────►│  (WS identification)
   │◄── identified ─────────────────│
   │                                │
   │── ACP events ─────────────────►│  (bidirectional forwarding)
   │◄── user prompts/permissions ───│
```

## 6. Permission Modes

### permissionMode Propagation

The permission mode is passed along the whole chain: Web UI → RCS → acp-link → ACP agent.

Supported permission modes:
- `default` — ask for confirmation on every request
- `auto` — decide automatically
- `acceptEdits` — accept edits automatically
- `plan` — plan mode
- `dontAsk` — never ask
- `bypassPermissions` — bypass permissions (requires a sandbox environment)

### Fallback Chain

When the client does not pass permissionMode explicitly, the following fallback chain applies:

```
client value > config.permissionMode > ACP_PERMISSION_MODE environment variable
```

Example:

```bash
ACP_PERMISSION_MODE=auto acp-link ccb-bun -- --acp
```

## 7. Permission Pipeline (Improved 2026-04-18)

### Mode Sync

`applySessionMode` syncs `appState.toolPermissionContext.mode` when the agent switches permission mode, keeping the internal permission context consistent with the ACP client's state.

### Unified Permission Pipeline

`createAcpCanUseTool` plugs into the unified `hasPermissionsToUseTool` pipeline, replacing the previously scattered handling. It supports an `onModeChange` callback so mode changes sync in real time.

### Bypass Detection

`bypassPermissions` mode now has an availability check: it can only be enabled for non-root users or in a sandbox environment, preventing a permission-bypass security risk.

## 8. Environment Variables

| Variable | Description |
|----------|-------------|
| `ACP_AUTH_TOKEN` | Fixed authentication token (generated automatically by default) |
| `ACP_PERMISSION_MODE` | Default permission mode fallback |
| `ACP_RCS_URL` | RCS server address (enables RCS integration) |
| `ACP_RCS_TOKEN` | RCS API token |
