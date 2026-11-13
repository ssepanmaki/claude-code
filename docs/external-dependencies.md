# Claude Code Remote Server Dependencies

> Lists only the remote services the code actually makes network requests to. Local services, npm package dependencies, and display-only URLs are not included.

## Overview

| # | Service | Remote endpoint | Protocol | Status |
|---|---|---|---|---|
| 1 | Anthropic API | `api.anthropic.com` | HTTPS | Enabled by default |
| 2 | AWS Bedrock | `bedrock-runtime.*.amazonaws.com` | HTTPS | Requires `CLAUDE_CODE_USE_BEDROCK=1` |
| 3 | Google Vertex AI | `{region}-aiplatform.googleapis.com` | HTTPS | Requires `CLAUDE_CODE_USE_VERTEX=1` |
| 4 | Azure Foundry | `{resource}.services.ai.azure.com` | HTTPS | Requires `CLAUDE_CODE_USE_FOUNDRY=1` |
| 5 | OAuth (Anthropic) | `platform.claude.com`, `claude.com`, `claude.ai` | HTTPS | On user login |
| 6 | GrowthBook | `api.anthropic.com` (remoteEval) | HTTPS | Enabled by default |
| 7 | Sentry | Configurable (`SENTRY_DSN`) | HTTPS | Requires environment variable |
| 8 | Datadog | Configurable (`DATADOG_LOGS_ENDPOINT`) | HTTPS | Requires environment variable |
| 9 | OpenTelemetry Collector | Configurable (`OTEL_EXPORTER_OTLP_ENDPOINT`) | gRPC/HTTP | Requires environment variable |
| 10 | 1P Event Logging | `api.anthropic.com/api/event_logging/batch` | HTTPS | Enabled by default |
| 11 | BigQuery Metrics | `api.anthropic.com/api/claude_code/metrics` | HTTPS | Enabled by default |
| 12 | MCP Proxy | `mcp-proxy.anthropic.com` | HTTPS+WS | When using MCP tools |
| 13 | MCP Registry | `api.anthropic.com/mcp-registry` | HTTPS | When querying MCP servers |
| 14 | Web Search Pages | `www.bing.com`, `search.brave.com` | HTTPS | WebSearch tool; switch with `WEB_SEARCH_ADAPTER=bing|brave` |
| 15 | Google Cloud Storage (updates) | `storage.googleapis.com` | HTTPS | Version check |
| 16 | GitHub Raw (Changelog/Stats) | `raw.githubusercontent.com` | HTTPS | Update notices |
| 17 | Claude in Chrome Bridge | `bridge.claudeusercontent.com` | WSS | Chrome integration |
| 18 | CCR Upstream Proxy | `api.anthropic.com` | WS | CCR remote sessions |
| 19 | Voice STT | `api.anthropic.com/api/ws/...` | WSS | Voice Mode |
| 20 | Desktop App Download | `claude.ai/api/desktop/...` | HTTPS | Download onboarding |

---

## Details

### 1. Anthropic Messages API

The core LLM inference service: sends conversation messages and receives streamed responses.

- **Endpoint**: `https://api.anthropic.com` (production) / `https://api-staging.anthropic.com` (staging)
- **Override**: the `ANTHROPIC_BASE_URL` environment variable
- **Auth**: API key / OAuth token
- **Files**: `src/services/api/client.ts`, `src/services/api/claude.ts`

### 2. AWS Bedrock

- **Endpoint**: `bedrock-runtime.{region}.amazonaws.com`
- **Auth**: AWS credential chain / `AWS_BEARER_TOKEN_BEDROCK`
- **Files**: `src/services/api/client.ts:153-190`, `src/utils/aws.ts`

### 3. Google Vertex AI

- **Endpoint**: `{region}-aiplatform.googleapis.com`
- **Auth**: `GoogleAuth` + `cloud-platform` scope
- **Files**: `src/services/api/client.ts:221-298`

### 4. Azure Foundry

- **Endpoint**: `https://{resource}.services.ai.azure.com/anthropic/v1/messages`
- **Auth**: API key or Azure AD `DefaultAzureCredential`
- **Files**: `src/services/api/client.ts:191-220`

### 5. OAuth

OAuth 2.0 + PKCE authorization code flow.

- **Endpoints**:
  - `https://platform.claude.com/oauth/authorize` — authorization page
  - `https://claude.com/cai/oauth/authorize` — Claude.ai authorization
  - `https://platform.claude.com/v1/oauth/token` — token exchange
  - `https://api.anthropic.com/api/oauth/claude_cli/create_api_key` — create an API key
  - `https://api.anthropic.com/api/oauth/claude_cli/roles` — fetch roles
  - `https://claude.ai/oauth/claude-code-client-metadata` — MCP client metadata
  - `https://claude.fedstart.com` — FedStart government deployment
- **Files**: `src/constants/oauth.ts`, `src/services/oauth/`

### 6. GrowthBook (feature flags)

- **Endpoint**: `https://api.anthropic.com/` (remoteEval mode) or `CLAUDE_GB_ADAPTER_URL`
- **SDK keys**: `sdk-zAZezfDKGoZuXXKe` (external), `sdk-xRVcrliHIlrg4og4` (ant prod), `sdk-yZQvlplybuXjYh6L` (ant dev)
- **Files**: `src/services/analytics/growthbook.ts`, `src/constants/keys.ts`

### 7. Sentry (error tracking)

- **Activation**: set `SENTRY_DSN` (not configured by default)
- **Behavior**: error reporting only, with sensitive headers filtered automatically
- **Files**: `src/utils/sentry.ts`

### 8. Datadog (logs)

- **Activation**: set both `DATADOG_LOGS_ENDPOINT` and `DATADOG_API_KEY` (not configured by default)
- **Files**: `src/services/analytics/datadog.ts`

### 9. OpenTelemetry Collector

- **Activation**: `CLAUDE_CODE_ENABLE_TELEMETRY=1` or `OTEL_*` environment variables
- **Protocol**: gRPC / HTTP / Protobuf, with OTLP and Prometheus export
- **Files**: `src/utils/telemetry/instrumentation.ts`

### 10. 1P Event Logging (internal events)

- **Endpoint**: `https://api.anthropic.com/api/event_logging/batch`
- **Protocol**: batch export (10s interval, 200 events per batch)
- **Files**: `src/services/analytics/firstPartyEventLoggingExporter.ts`

### 11. BigQuery Metrics

- **Endpoint**: `https://api.anthropic.com/api/claude_code/metrics`
- **Files**: `src/utils/telemetry/bigqueryExporter.ts`

### 12. MCP Proxy

An Anthropic-hosted proxy for MCP servers.

- **Endpoint**: `https://mcp-proxy.anthropic.com/v1/mcp/{server_id}`
- **Auth**: Claude.ai OAuth tokens
- **Files**: `src/services/mcp/client.ts`, `src/constants/oauth.ts`

### 13. MCP Registry

Fetches the official list of MCP servers.

- **Endpoint**: `https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial`
- **Files**: `src/services/mcp/officialRegistry.ts`

### 14. Web Search Pages

The WebSearch tool can scrape Bing search result pages directly, or fetch search context through Brave's LLM Context API.
Switch the backend explicitly with `WEB_SEARCH_ADAPTER=bing|brave`.

- **Bing endpoint**: `https://www.bing.com/search?q={query}&setmkt=en-US`
- **Brave endpoint**: `https://api.search.brave.com/res/v1/llm/context?q={query}`
- **Files**:
  - `packages/builtin-tools/src/tools/WebSearchTool/adapters/bingAdapter.ts`
  - `packages/builtin-tools/src/tools/WebSearchTool/adapters/braveAdapter.ts`

There is also a domain blocklist lookup:
- **Endpoint**: `https://api.anthropic.com/api/web/domain_info?domain={domain}`
- **Files**: `packages/builtin-tools/src/tools/WebFetchTool/utils.ts`

### 15. Google Cloud Storage (auto-update)

- **Endpoint**: `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases`
- **Files**: `src/utils/autoUpdater.ts`

### 16. GitHub Raw Content

- **Endpoint**: `https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md`
- **Endpoint**: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json`
- **Files**: `src/utils/releaseNotes.ts`, `src/utils/plugins/installCounts.ts`

### 17. Claude in Chrome Bridge

- **Endpoint**: `wss://bridge.claudeusercontent.com` (production) / `wss://bridge-staging.claudeusercontent.com` (staging)
- **Files**: `src/utils/claudeInChrome/mcpServer.ts`

### 18. CCR Upstream Proxy

- **Endpoint**: `ws://api.anthropic.com/v1/code/upstreamproxy/ws`
- **Activation**: `CLAUDE_CODE_REMOTE=1` + `CCR_UPSTREAM_PROXY_ENABLED=1`
- **Files**: `src/upstreamproxy/upstreamproxy.ts`

### 19. Voice STT

- **Endpoint**: `wss://api.anthropic.com/api/ws/...`
- **Files**: `src/services/voiceStreamSTT.ts`

### 20. Desktop App Download

- **Endpoint**: `https://claude.ai/api/desktop/win32/x64/exe/latest/redirect` (Windows)
- **Endpoint**: `https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect` (macOS)
- **Files**: `src/components/DesktopHandoff.tsx`

---

## Anthropic API auxiliary endpoints

The following endpoints all live under `api.anthropic.com`, grouped by function:

| Endpoint path | Purpose | File |
|---|---|---|
| `/api/event_logging/batch` | Batch event reporting | `src/services/analytics/firstPartyEventLoggingExporter.ts` |
| `/api/claude_code/metrics` | BigQuery metrics export | `src/utils/telemetry/bigqueryExporter.ts` |
| `/api/oauth/claude_cli/create_api_key` | Create an API key | `src/constants/oauth.ts` |
| `/api/oauth/claude_cli/roles` | Fetch user roles | `src/constants/oauth.ts` |
| `/api/oauth/accounts/grove` | Notification settings | `src/services/api/grove.ts` |
| `/api/oauth/organizations/{id}/referral/*` | Referral campaigns | `src/services/api/referral.ts` |
| `/api/oauth/organizations/{id}/overage_credit_grant` | Overage credits | `src/services/api/overageCreditGrant.ts` |
| `/api/oauth/organizations/{id}/admin_requests` | Admin requests | `src/services/api/adminRequests.ts` |
| `/api/web/domain_info?domain={}` | Domain safety check | `src/tools/WebFetchTool/utils.ts` |
| `/api/claude_code/settings` | Settings sync | `src/services/settingsSync/index.ts` |
| `/api/claude_code/managed_settings` | Enterprise managed settings (1h polling) | `src/services/remoteManagedSettings/index.ts` |
| `/api/claude_code/team_memory?repo={}` | Team memory sync | `src/services/teamMemorySync/index.ts` |
| `/api/auth/trusted_devices` | Trusted device registration | `src/bridge/trustedDevice.ts` |
| `/api/organizations/{id}/claude_code/buddy_react` | Companion reactions | `src/buddy/companionReact.ts` |
| `/mcp-registry/v0/servers` | MCP server registry | `src/services/mcp/officialRegistry.ts` |
| `/v1/files` | File upload/download | `src/services/api/filesApi.ts` |
| `/v1/sessions/{id}/events` | Session history | `src/assistant/sessionHistory.ts` |
| `/v1/code/triggers` | Remote triggers | `src/tools/RemoteTriggerTool/RemoteTriggerTool.ts` |
| `/v1/organizations/{id}/mcp_servers` | Organization MCP config | `src/services/mcp/claudeai.ts` |

## Non-Anthropic remote domains

| Domain | Service | Protocol |
|---|---|---|
| `bedrock-runtime.*.amazonaws.com` | AWS Bedrock | HTTPS |
| `{region}-aiplatform.googleapis.com` | Google Vertex AI | HTTPS |
| `{resource}.services.ai.azure.com` | Azure Foundry | HTTPS |
| `www.bing.com` | Bing search | HTTPS |
| `search.brave.com` | Brave search | HTTPS |
| `storage.googleapis.com` | Auto-update | HTTPS |
| `raw.githubusercontent.com` | Changelog / plugin stats | HTTPS |
| `bridge.claudeusercontent.com` | Chrome Bridge | WSS |
| `platform.claude.com` | OAuth authorization page | HTTPS |
| `claude.com` / `claude.ai` | OAuth / download | HTTPS |
| `claude.fedstart.com` | FedStart OAuth | HTTPS |
