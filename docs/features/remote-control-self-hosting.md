# Remote Control Server Self-Hosting Guide

This guide explains how to deploy the Remote Control Server (RCS) to a private environment and connect to it with the Claude Code CLI.

## Architecture overview

```
┌──────────────────┐                    ┌──────────────────────┐
│  Claude Code CLI  │ ◄── HTTP/SSE/WS ─►│  Remote Control      │
│  (Bridge Worker)  │  long poll + heartbeat│  Server (RCS)      │
└──────────────────┘                    │                      │
                                        │  ┌──────────────┐    │
┌──────────────────┐   HTTP/SSE        │  │ In-Memory    │    │
│  Web UI dashboard │ ◄─────────────── │  │ Store        │    │
│  (/code/*)       │                   │  └──────────────┘    │
│  (React + Vite)  │                   │  ┌──────────────┐    │
└──────────────────┘                   │  │ JWT Auth     │    │
                                       │  └──────────────┘    │
┌──────────────────┐                   │  ┌──────────────┐    │
│  acp-link        │ ◄── ACP Relay ─── │  │ ACP Handler  │    │
│  + ACP Agent     │     WebSocket      │  └──────────────┘    │
└──────────────────┘                   └──────────────────────┘
```

**RCS is a purely in-memory intermediary service.** Its responsibilities are:
- Accept environment registration and work polling from the Claude Code CLI
- Accept ACP agent registration from acp-link, with WebSocket relay bridging
- Provide a Web UI for operators to monitor and approve remotely
- Carry messages in both directions over WebSocket/SSE
- Manage sessions, environments, and permission requests
- Provide an ACP SSE event stream so external consumers can subscribe to channel group events

## Prerequisites

- A server reachable by both the Claude Code CLI and a web browser (physical machine, VM, or container)
- [Docker](https://www.docker.com/)
- A Claude Code build with the `BRIDGE_MODE` feature flag enabled

## Deployment

### Build the Docker image

From the project root:

```bash
docker build -t rcs:latest -f packages/remote-control-server/Dockerfile .
```

### Start the container

```bash
docker run -d \
  --name rcs \
  -p 3000:3000 \
  -e RCS_API_KEYS=sk-rcs-your-secret-key-here \
  -e RCS_BASE_URL=https://rcs.example.com \
  -v rcs-data:/app/data \
  --restart unless-stopped \
  rcs:latest
```

### Docker Compose

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
      - RCS_API_KEYS=sk-rcs-your-secret-key-here
      - RCS_BASE_URL=https://rcs.example.com
    volumes:
      - rcs-data:/app/data
    restart: unless-stopped

volumes:
  rcs-data:
```

Start it:

```bash
docker compose up -d
```

## Environment variable reference

### Server side

| Variable | Required | Default | Description |
|------|------|--------|------|
| `RCS_API_KEYS` | **Yes** | _(empty)_ | Comma-separated list of API keys. Used for client authentication and JWT signing. **Be sure to set a strong key** |
| `RCS_PORT` | No | `3000` | Port the service listens on |
| `RCS_HOST` | No | `0.0.0.0` | Address the service listens on |
| `RCS_BASE_URL` | No | `http://localhost:3000` | External access URL. Used to generate WebSocket connection addresses and must match the address clients actually use |
| `RCS_VERSION` | No | `0.1.0` | Version number, shown in the `/health` response |
| `RCS_POLL_TIMEOUT` | No | `8` | V1 work poll timeout (seconds) |
| `RCS_HEARTBEAT_INTERVAL` | No | `20` | Heartbeat interval (seconds) |
| `RCS_JWT_EXPIRES_IN` | No | `3600` | JWT token lifetime (seconds) |
| `RCS_DISCONNECT_TIMEOUT` | No | `300` | Timeout for deciding a client has disconnected (seconds) |
| `RCS_WS_IDLE_TIMEOUT` | No | `30` | WebSocket idle timeout (seconds); Bun sends protocol-level pings |
| `RCS_WS_KEEPALIVE_INTERVAL` | No | `20` | Interval of server→client keep_alive frames (seconds), preventing reverse proxies from closing idle connections |

### Client side (Claude Code CLI)

| Variable | Required | Description |
|------|------|------|
| `CLAUDE_BRIDGE_BASE_URL` | **Yes** | RCS server address, e.g. `https://rcs.example.com`. Setting this variable enables self-hosted mode and skips the GrowthBook gate |
| `CLAUDE_BRIDGE_OAUTH_TOKEN` | **Yes** | Authentication token; must match one of the values in the server's `RCS_API_KEYS` |
| `CLAUDE_BRIDGE_SESSION_INGRESS_URL` | No | WebSocket ingress address (defaults to the same as `CLAUDE_BRIDGE_BASE_URL`) |
| `CLAUDE_CODE_REMOTE` | No | When set to `1`, marks remote execution mode |

## Connecting the Claude Code client

### 1. Set the environment variables

On the machine running Claude Code:

```bash
export CLAUDE_BRIDGE_BASE_URL="https://rcs.example.com"
export CLAUDE_BRIDGE_OAUTH_TOKEN="sk-rcs-your-secret-key-here"
```

### 2. Start Claude Code

```bash
# Use dev mode (BRIDGE_MODE is enabled by default)
bun run dev

# Or use the build output
bun run dist/cli.js
```

### 3. Run the /remote-control command

In the Claude Code REPL, type:

```
/remote-control
```

Environment-style Remote Control (for example the `claude remote-control` subcommand) registers an environment with RCS, and on success the terminal shows a connection URL:

```
https://rcs.example.com/code?bridge=<environmentId>
```

The interactive REPL approach (`--remote-control` or `/remote-control`) may also give a session URL directly in some bridge modes:

```
https://rcs.example.com/code/session_<id>
```

Either URL can be opened directly in a browser to remotely control the current session; only environment mode appears in the Web UI's environment list.

If already connected, running `/remote-control` again shows a dialog with these options:
- **Disconnect this session** — disconnect the remote connection
- **Show QR code** — show/hide the QR code
- **Continue** — stay connected and keep working

You can also start it directly with CLI arguments:

```bash
claude remote-control
# or the short form
claude rc
# or
claude bridge
```

## Web UI dashboard

After getting the URL from the `/remote-control` command, open it in a browser to use it.

### Tech stack (v2, refactored 2026-04-18)

The Web UI was refactored from vanilla JS to **React + Vite + Radix UI**:

- **Framework**: React 19 + Vite build, TypeScript
- **UI components**: Radix UI primitives (Dialog, Tabs, Select, Popover, etc.)
- **Chat components**: a complete ACP chat interface supporting Plan visualization, tool call display, and permission approval
- **AI Elements**: a standalone AI interaction component library (message, reasoning, tool, code-block, prompt-input, etc.)
- **Direct ACP connection**: scanning a QR code automatically jumps to the direct ACP view (`ACPDirectView`)
- **Theme system**: dark/light theme switching, following the Impeccable design system

### Features

- View registered runtime environments (environment mode), distinguishing ACP Agent and Claude Code types
- Create and manage sessions
- View conversation messages and tool calls in real time
- View Autopilot state (`standby` / `sleeping`) and auto-run indicators
- View the Tasks panel driven by authoritative task snapshots
- Approve Claude Code's tool permission requests
- Permission mode selector (6 modes: default / auto-accept edits / bypass permissions / plan / don't ask / auto)
- Model selector (choose from available models)
- Plan visualization (progress bar, status icons, priority tags)
- ACP QR scan automatically jumps to the ACP chat interface

The Web UI uses UUID authentication (no user accounts), which suits trusted network environments.

## ACP support

RCS supports ACP (Agent Client Protocol) agents connecting through the `acp-link` package.

### Architecture

```
acp-link ──REST register──► RCS POST /v1/environments/bridge
acp-link ──WS identify──► RCS WebSocket (carrying agentId)
acp-link ◄──ACP relay──► RCS ◄──Web UI WS──► browser
```

### Backend components

| File | Responsibility |
|------|------|
| `src/routes/acp/index.ts` | ACP REST routes: agent list, channel groups, relay |
| `src/transport/acp-ws-handler.ts` | ACP WebSocket handling: agent registration, heartbeat, message forwarding |
| `src/transport/acp-relay-handler.ts` | Frontend WS → acp-link passthrough + EventBus inbound forwarding |
| `src/transport/acp-sse-writer.ts` | SSE event stream for external consumers to subscribe to |

The ACP agents, channel groups, relay, and channel-group SSE endpoints all require a valid
API key. A browser `EventSource` cannot send an `Authorization` header, so external subscribers to
`/acp/channel-groups/:id/events` need to use `fetch` + `ReadableStream` with
`Authorization: Bearer <api-key>`.

### Connecting acp-link

See the [acp-link documentation](./acp-link.md) for details.

```bash
# Start acp-link in the RCS environment
# Note: claude itself does not support ACP; use ccb-bun --acp
ACP_RCS_URL=http://localhost:3000 \
ACP_RCS_TOKEN=sk-rcs-your-key \
acp-link ccb-bun -- --acp
```

ACP sessions show a brand-colored tag in the Web UI to distinguish them from ordinary Claude Code sessions.

## Workflow in detail

```
┌──────────────────────────────────────────────────────────┐
│                    Complete workflow                      │
└──────────────────────────────────────────────────────────┘

 1. The Claude Code CLI starts, with environment variables pointing at the self-hosted RCS

 2. The user runs the /remote-control command

 3. Register the environment
    CLI ──POST /v1/environments/bridge──► RCS
    CLI ◄── { environment_id, environment_secret } ── RCS

 4. The terminal shows the connection URL
    https://rcs.example.com/code?bridge=<environmentId>

 5. Start work polling (loop)
    CLI ──GET /v1/environments/:id/work/poll──► RCS
         (long poll, waiting for task assignment, retry after an 8 second timeout)

 6. Open the URL in a browser → the Web UI creates a task
    Browser ──POST /web/sessions──► RCS
    RCS assigns the work to the polling CLI

 7. The CLI receives the task and acknowledges it
    CLI ◄── { id, data: { type, sessionId } } ── RCS
    CLI ──POST /v1/environments/:id/work/:workId/ack──► RCS

 8. Establish the session connection
    CLI ──WebSocket /v1/session_ingress──► RCS
         (or use V2's SSE + HTTP POST)

 9. Two-way communication
    CLI ──messages/tool call results──► RCS ──► Browser
    CLI ◄──permission approvals/instructions───── RCS ◄──── Browser
    CLI ──automation_state / task_state──► RCS ──► Browser

10. Heartbeat keep-alive (every 20 seconds)
    CLI ──POST /v1/environments/:id/work/:workId/heartbeat──► RCS

11. Task completes → archive session → deregister environment
```

## Troubleshooting

### The Web UI doesn't show the current Autopilot state

- `standby`: proactive is on and waiting for the next tick
- `sleeping`: the model is in a `SleepTool` wait window

These two states are reported through the worker's `external_metadata.automation_state`. If the page only shows an ordinary working spinner, first check whether the worker metadata PUT between the CLI and RCS succeeds.

### The CLI cannot connect

```
Error: Remote Control is not available in this build.
```

**Cause**: the `BRIDGE_MODE` feature flag is not enabled.

**Fix**: use dev mode (enabled by default) or make sure the build includes the `BRIDGE_MODE` flag.

### Authentication failure (401)

```
Error: Unauthorized
```

**Things to check**:
1. Whether `CLAUDE_BRIDGE_OAUTH_TOKEN` matches a value in `RCS_API_KEYS`
2. Whether the API key contains extra spaces or newlines
3. Whether both environment variables are set correctly

### WebSocket connection drops

**Things to check**:
1. If you use a reverse proxy, confirm WebSocket upgrade is configured correctly (`Upgrade` / `Connection` headers)
2. Whether the proxy's `proxy_read_timeout` is large enough (86400 seconds recommended)
3. Whether the network firewall allows WebSocket traffic

### Health check

```bash
curl https://rcs.example.com/health
# Expected: {"status":"ok","version":"0.1.0"}
```

## Limitations and notes

| Item | Description |
|------|------|
| Storage | Purely in-memory storage (Map); all session and environment data is lost when the server restarts |
| Scaling | Horizontal scaling is not supported (no shared state); single-instance deployment |
| Concurrency | Suited to small and medium scale; a large number of concurrent sessions may need performance tuning |
| Data persistence | The `/app/data` volume is reserved but currently unused; it may be used for persistence in the future |
| Web UI authentication | UUID-based, with no user account system, suited to trusted network environments |

## Comparison with cloud mode

| Feature | Cloud (Anthropic CCR) | Self-hosted (RCS) |
|------|---------------------|--------------|
| Authentication | claude.ai OAuth subscription | API key |
| GrowthBook gate | Requires `tengu_ccr_bridge` to pass | Skipped automatically |
| Feature flag | Requires `BRIDGE_MODE=1` | Also required |
| Deployment location | Anthropic cloud | The user's own server |
| Data flows through | Anthropic infrastructure | The user's private network |
| Dependencies | claude.ai subscription + OAuth | Only an API key |

The core advantage of self-hosted mode is that once `CLAUDE_BRIDGE_BASE_URL` is set, the code automatically makes `isSelfHostedBridge()` return `true`, skipping all GrowthBook and subscription checks, so it can be used without a claude.ai account.
