# ACP (Agent Client Protocol) — Zed / IDE Integration

> Feature Flag: `FEATURE_ACP=1` (enabled by default in build and dev modes)
> Status: working (supports ACP clients such as Zed and Cursor)
> Source directory: `src/services/acp/`

## 1. Overview

ACP (Agent Client Protocol) is a standardized stdio protocol that lets IDEs and editors drive an AI agent over an NDJSON stream on stdin/stdout. CCB implements the full agent side of ACP and can be invoked directly by ACP-capable clients such as Zed and Cursor.

### Key Features

- **Session management**: create / resume / load / fork / close sessions
- **History replay**: conversation history is loaded and replayed automatically when a session is resumed
- **Permission bridging**: permission decisions from the ACP client map onto CCB's tool permission system
- **Slash commands & skills**: loads the real command list and supports prompt-type skills such as `/commit` and `/review`
- **Context window tracking**: accurate usage_update, including model prefix matching
- **Prompt queueing**: multiple prompts can be sent back to back and are queued automatically
- **Mode switching**: auto / default / acceptEdits / plan / dontAsk / bypassPermissions
- **Model switching**: switch the AI model at runtime

## 2. Architecture

```
┌──────────────┐    NDJSON/stdio    ┌──────────────────┐
│  Zed / IDE   │ ◄────────────────► │  CCB ACP Agent   │
│  (Client)    │   stdin / stdout   │  (Agent)         │
└──────────────┘                    │                  │
                                    │  entry.ts        │ ← stdio → NDJSON stream
                                    │  agent.ts        │ ← ACP protocol handler
                                    │  bridge.ts       │ ← SDKMessage → ACP SessionUpdate
                                    │  permissions.ts  │ ← permission bridge
                                    │  utils.ts        │ ← shared helpers
                                    │                  │
                                    │  QueryEngine     │ ← internal query engine
                                    └──────────────────┘
```

### File Responsibilities

| File | Responsibility |
|------|----------------|
| `entry.ts` | Entry point; creates the stdio → NDJSON stream and starts `AgentSideConnection` |
| `agent.ts` | Implements the ACP `Agent` interface: session CRUD, prompt, cancel, mode/model switching |
| `bridge.ts` | Converts `SDKMessage` → ACP `SessionUpdate`: text/thinking/tools/usage/edit diffs |
| `permissions.ts` | Bridges ACP `requestPermission()` → CCB `CanUseToolFn` |
| `utils.ts` | Pushable, stream conversion, permission-mode parsing, session fingerprint, path display |

## 3. Configuring the Zed Editor

### 3.1 Zed settings.json

Open Zed's `settings.json` (`Cmd+,` → Open Settings) and add an `agent_servers` entry:

```json
{
  "agent_servers": {
    "ccb": {
      "type": "custom",
      "command": "ccb",
      "args": ["--acp"]
    }
  }
}
```

### 3.3 API Authentication

At startup, CCB's ACP agent automatically loads the environment variables from `settings.json` (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, etc.). Make sure an API provider has been configured through `/login`.

They can also be passed as environment variables:

```json
{
  "agent_servers": {
    "claude-code": {
      "command": "ccb",
      "args": ["--acp"],
      "env": {
        "ANTHROPIC_BASE_URL": "https://api.example.com/v1",
        "ANTHROPIC_AUTH_TOKEN": "sk-xxx"
      }
    }
  }
}
```

### 3.4 Using It in Zed

1. Restart Zed after configuring
2. Open any project directory
3. Press `Cmd+'` (macOS) or `Ctrl+'` (Linux) to open the Agent Panel
4. Choose **claude-code** from the dropdown at the top of the Agent Panel
5. Start chatting

### 3.5 Features

| Feature | How |
|---------|-----|
| Chat | Type a message directly in the Agent Panel |
| Slash commands | Type `/` to see the available skills (e.g. `/commit`, `/review`) |
| Tool permissions | Choose Allow / Reject / Always Allow when a permission request appears |
| Mode switching | Switch between auto/default/plan etc. from the Agent Panel settings menu |
| Model switching | Switch the AI model from the Agent Panel settings menu |
| Session resume | After closing and reopening Zed, earlier sessions resume automatically (with history) |

## 4. Configuring Other ACP Clients

ACP is an open protocol, so any ACP-capable client can connect to CCB. The general configuration pattern:

```
Command: ccb --acp
Args: ["--acp"]
Transport: stdin/stdout NDJSON
Protocol version: ACP v1
```

### 4.1 Cursor

In Cursor's settings, configure an MCP / Agent Server using the same `ccb --acp` command.

### 4.2 Custom Clients

`@agentclientprotocol/sdk` makes it quick to build an ACP client:

```typescript
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'

// Create the connection (launch ccb --acp as a child process)
const child = spawn('ccb', ['--acp'])
const stream = ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
)

const client = new ClientSideConnection(stream)

// Initialize
await client.initialize({ clientCapabilities: {} })

// Create a session
const { sessionId } = await client.newSession({
  cwd: '/path/to/project',
})

// Send a prompt
const response = await client.prompt({
  sessionId,
  prompt: [{ type: 'text', text: 'Hello, explain this project' }],
})

// Listen for session updates
client.on('sessionUpdate', (update) => {
  console.log('Update:', update)
})
```

## 5. ACP Protocol Support Matrix

| Method | Status | Notes |
|--------|--------|-------|
| `initialize` | ✅ | Returns agent info and capabilities |
| `authenticate` | ✅ | No authentication needed (self-hosted) |
| `newSession` | ✅ | Creates a new session |
| `resumeSession` | ✅ | Resumes an existing session (with history replay) |
| `loadSession` | ✅ | Loads a specific session (with history replay) |
| `listSessions` | ✅ | Lists available sessions |
| `forkSession` | ✅ | Forks a session |
| `closeSession` | ✅ | Closes a session |
| `prompt` | ✅ | Sends a message; supports queueing |
| `cancel` | ✅ | Cancels the current/queued prompt |
| `setSessionMode` | ✅ | Switches the permission mode |
| `setSessionModel` | ✅ | Switches the AI model |
| `setSessionConfigOption` | ✅ | Changes configuration dynamically |

### SessionUpdate Types

| Type | Status | Notes |
|------|--------|-------|
| `agent_message_chunk` | ✅ | Assistant text message |
| `agent_thought_chunk` | ✅ | Thinking/reasoning content |
| `user_message_chunk` | ✅ | User message (history replay) |
| `tool_call` | ✅ | Tool call start |
| `tool_call_update` | ✅ | Tool call result/status update |
| `usage_update` | ✅ | Token usage + context window |
| `plan` | ✅ | TodoWrite → plan entries |
| `available_commands_update` | ✅ | Slash command & skill list |
| `current_mode_update` | ✅ | Mode change notification |
| `config_option_update` | ✅ | Configuration update notification |
