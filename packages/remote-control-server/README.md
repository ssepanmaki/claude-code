# Remote Control Server (RCS)

Remote Control Server is the remote-control backend for Claude Code. It lets you monitor and operate Claude Code sessions remotely from a browser Web UI.

## Features

- **Session management** — create, monitor and archive Claude Code sessions
- **Live message stream** — bidirectional WebSocket / SSE transport; watch conversations and tool calls in real time
- **Permission approval** — approve Claude Code's tool permission requests in the Web UI
- **Multi-environment management** — register several runtime environments, with heartbeat and reconnection
- **Authentication** — two layers: API key + JWT

## Quick start

### Docker deployment (recommended)

Build the image from the repository root, then run it:

```bash
docker build -f packages/remote-control-server/Dockerfile -t remote-control-server .

docker run -d \
  --name rcs \
  -p 3000:3000 \
  -e RCS_API_KEYS=your-api-key-here \
  -v rcs-data:/app/data \
  remote-control-server
```

## Environment variables

### Server configuration

| Variable | Default | Description |
|------|--------|------|
| `RCS_PORT` | `3000` | Listening port |
| `RCS_HOST` | `0.0.0.0` | Listening address |
| `RCS_API_KEYS` | _(empty)_ | Comma-separated list of API keys. Clients and Workers must provide one when connecting |
| `RCS_BASE_URL` | _(auto)_ | External address, e.g. `https://rcs.example.com`. Used to generate WebSocket connection URLs |
| `RCS_VERSION` | `0.1.0` | Service version, shown in the `/health` response |

### Timeouts and heartbeat

| Variable | Default | Description |
|------|--------|------|
| `RCS_POLL_TIMEOUT` | `8` | V1 polling timeout (seconds) |
| `RCS_HEARTBEAT_INTERVAL` | `20` | Heartbeat interval (seconds) |
| `RCS_JWT_EXPIRES_IN` | `3600` | JWT token lifetime (seconds) |
| `RCS_DISCONNECT_TIMEOUT` | `300` | Timeout after which a client is considered disconnected (seconds) |

## Claude Code client configuration

### Connecting to a self-hosted server

Set the following variables in the environment where Claude Code runs:

```bash
# Point at your RCS server address
export CLAUDE_BRIDGE_BASE_URL="https://rcs.example.com"

# Auth token (matches a value in RCS_API_KEYS)
export CLAUDE_BRIDGE_OAUTH_TOKEN="your-api-key-here"
```

Then start remote-control mode:

```bash
ccb --remote-control
```

> **Note**: remote control requires the `BRIDGE_MODE` feature flag. It is enabled by default in dev mode.

### Environment variable reference

| Variable | Description |
|------|------|
| `CLAUDE_BRIDGE_BASE_URL` | RCS server address; overrides the default Anthropic cloud address |
| `CLAUDE_BRIDGE_OAUTH_TOKEN` | Auth token used to connect to the RCS server |
| `CLAUDE_BRIDGE_SESSION_INGRESS_URL` | WebSocket ingress address (same as BASE_URL by default) |
| `CLAUDE_CODE_REMOTE` | When set to `1`, marks remote execution mode |

## Docker Compose example

```yaml
version: "3.8"
services:
  rcs:
    build:
      context: .
      dockerfile: packages/remote-control-server/Dockerfile
      args:
        VERSION: "0.1.0"
    ports:
      - "3000:3000"
    environment:
      - RCS_API_KEYS=sk-rcs-change-me
      - RCS_BASE_URL=https://rcs.example.com
    volumes:
      - rcs-data:/app/data
    restart: unless-stopped

volumes:
  rcs-data:
```

## ACP-compatible remote-control

```sh
ACP_RCS_URL=http://localhost:3000 ACP_RCS_TOKEN=test-my-key acp-link ccb-bun -- --acp
```

## Reverse proxy configuration

When using an Nginx or Caddy reverse proxy, WebSocket upgrades must be supported:

```nginx
server {
    listen 443 ssl;
    server_name rcs.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }
}
```

Caddy is simpler and handles WebSocket automatically:

```
rcs.example.com {
    reverse_proxy localhost:3000
}
```

## Architecture overview

```
┌─────────────┐     WebSocket/SSE      ┌──────────────────┐
│  Claude Code │ ◄──────────────────► │  Remote Control  │
│  (Bridge CLI)│     HTTP API          │     Server       │
└─────────────┘                        │                  │
                                       │  ┌────────────┐  │
┌─────────────┐     HTTP/SSE          │  │ Event Bus   │  │
│  Web UI      │ ◄────────────────── │  └────────────┘  │
│  (/code/*)   │                      │  ┌────────────┐  │
└─────────────┘                       │  │ In-Memory   │  │
                                      │  │ Store       │  │
                                      │  └────────────┘  │
                                      └──────────────────┘
```

- **Transport**: WebSocket (V1) and SSE + HTTP POST (V2)
- **Storage**: pure in-memory storage (Map); data is cleared on restart
- **Authentication**: API key (clients) + JWT (Worker)
- **Frontend**: plain JS SPA, served under the `/code/*` path

## Development

```bash
# Install dependencies
bun install

# Dev mode (hot reload)
bun run dev

# Type check
bun run typecheck

# Run tests
bun test packages/remote-control-server/
```
