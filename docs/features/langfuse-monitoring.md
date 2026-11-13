# Langfuse Monitoring Integration

> Status: complete, enabled through environment variables
> Dependencies: `@langfuse/otel`, `@langfuse/tracing`, `@opentelemetry/sdk-trace-base`

## 1. Overview

Langfuse is an open-source LLM observability platform for tracing, monitoring and debugging the request chains of AI applications. CCB integrates Langfuse into the query flow through an OpenTelemetry (OTel) bridge layer, providing:

- **LLM call tracing** — records the model, provider, input/output and token usage of every API request
- **Tool execution tracing** — records the name, input, output, duration and errors of every tool call
- **Multi-agent tracing** — the main agent and each sub-agent get their own independent trace chain
- **Data redaction** — automatically masks sensitive information (API keys, file contents, shell output, etc.)

## 2. Enabling

Langfuse is open source, so you can **self-host** it (Docker / Kubernetes) or try the official **[Langfuse Cloud](https://cloud.langfuse.com)** for free. After signing up, get your keys from Project Settings → API Keys.

Only three environment variables are needed:

| Environment variable | Description |
|----------------------|-------------|
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key (required) |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (required) |
| `LANGFUSE_BASE_URL` | Service URL, default `https://cloud.langfuse.com`; change it to your own address when self-hosting (required) |

When unconfigured, all tracing functions are no-ops with zero overhead.

### Configure Through settings.json (Recommended)

Add these to the `env` field of `.claude/settings.json` so they take effect on every launch:

```json
{
  "env": {
    "LANGFUSE_PUBLIC_KEY": "pk-xxx",
    "LANGFUSE_SECRET_KEY": "sk-xxx",
    "LANGFUSE_BASE_URL": "https://cloud.langfuse.com"
  }
}
```

### Other Optional Parameters

| Environment variable | Default | Description |
|----------------------|---------|-------------|
| `LANGFUSE_TRACING_ENVIRONMENT` | `development` | Environment label, used for filtering in the Langfuse dashboard |
| `LANGFUSE_FLUSH_AT` | `20` | Span count threshold for batched sending |
| `LANGFUSE_FLUSH_INTERVAL` | `10` | Periodic flush interval (seconds) |
| `LANGFUSE_EXPORT_MODE` | `batched` | Export mode: `batched` or `immediate` |
| `LANGFUSE_TIMEOUT` | `5` | Request timeout (seconds) |

## 4. Architecture

### 4.1 Module Structure

```
src/services/langfuse/
├── index.ts          # Unified exports
├── client.ts         # OTel Provider + LangfuseSpanProcessor initialization
├── tracing.ts        # Trace/Span creation, LLM and tool observation recording
├── convert.ts        # Internal Message types → Langfuse OpenAI-compatible format
└── sanitize.ts       # Data redaction (sensitive fields, file paths, tool output)
```

### 4.2 Trace Hierarchy

```
Trace (Agent Span)                    ← createTrace() / createSubagentTrace()
  ├── Generation (LLM call)           ← recordLLMObservation()
  ├── Tool Observation (tool call)    ← recordToolObservation()
  ├── Tool Observation (tool call)    ← recordToolObservation()
  └── ...
```

### 4.3 Data Flow

```
query.ts  ──→  createTrace()           # a root trace per query turn
  │
  ├── claude.ts  ──→  recordLLMObservation()   # record the LLM observation after an API call completes
  │
  ├── toolExecution.ts  ──→  recordToolObservation()  # record each tool execution
  │
  └── query.ts  ──→  endTrace()         # close the trace when the turn ends

runAgent.ts  ──→  createSubagentTrace()  # sub-agents get their own trace
```

## 5. Tracing Details

### 5.1 Main Agent Trace

Each `query()` call (one user conversation turn) creates a root Span of type `agent`:

- **Name**: `agent-run` or `agent-run:<querySource>`
- **Metadata**: `provider`, `model`, `agentType: "main"`
- **Session ID**: linked to Langfuse's Session feature, allowing aggregation by session

### 5.2 Sub-Agent Trace

Sub-agents launched through `AgentTool` create their own Trace:

- **Name**: `agent:<agentType>`
- **Metadata**: `provider`, `model`, `agentType`, `agentId`
- Independent of the main Trace, with its own Session link

### 5.3 LLM Generation

Each API call is recorded as a Span of type `generation`:

- **Name**: mapped by provider (e.g. `ChatAnthropic`, `ChatOpenAI`, `ChatBedrockAnthropic`)
- **Recorded content**: input messages, output messages, token usage (input/output)
- **Timing**: precise `startTime`, `endTime` and `completionStartTime` (the TTFT metric)

Provider name mapping:

| Provider | Generation name |
|----------|-----------------|
| `firstParty` | `ChatAnthropic` |
| `bedrock` | `ChatBedrockAnthropic` |
| `vertex` | `ChatVertexAnthropic` |
| `foundry` | `ChatFoundry` |
| `openai` | `ChatOpenAI` |
| `gemini` | `ChatGoogleGenerativeAI` |
| `grok` | `ChatXAI` |

### 5.4 Tool Execution

Each tool call is recorded as a Span of type `tool`:

- **Name**: the tool name (e.g. `FileEditTool`, `BashTool`)
- **Recorded content**: input (redacted), output (redacted), `toolUseId`
- **Error marking**: `isError` flag + `level: ERROR`

## 6. Data Redaction

All data uploaded to Langfuse passes through redaction (`sanitize.ts`) so sensitive information doesn't leak:

### 6.1 Global Redaction (`sanitizeGlobal`)

- **Home path replacement** — `/Users/xxx` → `~`
- **Sensitive field masking** — values of fields whose names match keywords such as `api_key`, `token`, `secret`, `password`, `credential`, `auth_header` are replaced with `[REDACTED]`

### 6.2 Tool Input Redaction (`sanitizeToolInput`)

- Sensitive field masking (same as global)
- Home directory replacement in `file_path`, `path` and `directory` paths

### 6.3 Tool Output Redaction (`sanitizeToolOutput`)

| Tool | Redaction strategy |
|------|--------------------|
| `FileReadTool`, `FileWriteTool`, `FileEditTool` | Fully masked, only the character count is kept: `[file content redacted, N chars]` |
| `BashTool`, `PowerShellTool` | Truncated to 500 characters |
| `ConfigTool`, `MCPTool` | Fully masked |
| Other tools | Kept as is |

## 7. Message Format Conversion

`convert.ts` converts CCB's internal Message types into the OpenAI-compatible format Langfuse expects:

- **Input**: `UserMessage | AssistantMessage[]` + optional system prompt → `{ role, content }[]`
- **Output**: `AssistantMessage[]` → `{ role: 'assistant', content }`
- **Content block mapping**:
  - `text` → `{ type: 'text', text }`
  - `thinking` / `redacted_thinking` → `{ type: 'thinking', thinking }`
  - `tool_use` → `{ type: 'tool_use', id, name, input }`
  - `tool_result` → `{ type: 'tool_result', tool_use_id, content }`
  - `image` / `document` → placeholder markers `[image]` / `[document: name]`

## 8. Lifecycle

1. **Initialization** — `initLangfuse()` is called at startup in `src/entrypoints/init.ts` and creates the `LangfuseSpanProcessor` and `BasicTracerProvider`
2. **Runtime** — each tracing function checks `isLangfuseEnabled()` and returns `null`/skips when unconfigured
3. **Shutdown** — `shutdownLangfuse()` is called at process exit, forcing a flush and closing the Processor

## 9. Self-Hosting Langfuse

Langfuse is open source and supports Docker / Kubernetes self-hosting:

```bash
docker run -d \
  --name langfuse \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  langfuse/langfuse:latest
```

After self-hosting, point `LANGFUSE_BASE_URL` at your instance. See the [Langfuse self-hosting docs](https://langfuse.com/docs/deployment/self-host) for details.

If you don't need to self-host, you can use [Langfuse Cloud](https://cloud.langfuse.com) directly; it offers a free tier suitable for testing.

## 10. Related Files

| File | Description |
|------|-------------|
| `src/services/langfuse/client.ts` | OTel Provider initialization, lifecycle management |
| `src/services/langfuse/tracing.ts` | Trace/Span creation and observation recording |
| `src/services/langfuse/convert.ts` | Message format conversion |
| `src/services/langfuse/sanitize.ts` | Data redaction |
| `src/services/langfuse/__tests__/langfuse.test.ts` | Tests (568 lines) |
| `src/query.ts` | Trace integration in the main query flow |
| `src/services/tools/toolExecution.ts` | Observation recording during tool execution |
| `packages/builtin-tools/src/tools/AgentTool/runAgent.ts` | Sub-agent trace creation |
