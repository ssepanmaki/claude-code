# Telemetry and remote config delivery audit (excluding Sentry)

## 1. Datadog logs

**File**: `src/services/analytics/datadog.ts`

- **Endpoint**: configured through the `DATADOG_LOGS_ENDPOINT` environment variable (empty by default, i.e. disabled)
- **Client token**: configured through the `DATADOG_API_KEY` environment variable (empty by default, i.e. disabled)
- **Behavior**: sends logs in batches (15s flush interval, 100-entry cap), first-party (direct Anthropic API) users only
- **Event allowlist**: the `tengu_*` series of events (startup, errors, OAuth, tool calls, etc., ~35 kinds)
- **Baseline data**: collects model, platform, arch, version, userBucket (the user hashed into 30 buckets), etc.
- **Only when**: `NODE_ENV === 'production'`
- **Example configuration**: `DATADOG_LOGS_ENDPOINT=https://http-intake.logs.datadoghq.com/api/v2/logs DATADOG_API_KEY=xxx bun run dev`

## 2. First-party event logging (BigQuery)

**Files**: `src/services/analytics/firstPartyEventLogger.ts` + `firstPartyEventLoggingExporter.ts`

- **Endpoint**: `https://api.anthropic.com/api/event_logging/batch` (switchable for staging)
- **Behavior**: uses the OpenTelemetry SDK's `BatchLogRecordProcessor` to export in batches to Anthropic's own BQ pipeline
- **Data**: full event metadata (session, model, env context, user data, subscription type, etc.)
- **Resilience**: failed events are persisted to local disk (JSONL), retried with quadratic backoff, up to 8 attempts
- **Proto schema**: events are serialized as `ClaudeCodeInternalEvent` / `GrowthbookExperimentEvent` protobufs
- **Auth fallback**: on a 401 the auth header is dropped and the request is retried

## 3. GrowthBook remote feature flags / dynamic config

**File**: `src/services/analytics/growthbook.ts`

- **Server**: `https://api.anthropic.com/` (remote eval mode)
- **Behavior**: fetches all feature flags at startup, then refreshes every 6h (external users) / 20min (ant)
- **Disk cache**: feature values are written to `cachedGrowthBookFeatures` in `~/.claude.json`
- **Uses**:
  - Controls the Datadog switch (`tengu_log_datadog_events`)
  - Controls the event sampling rate (`tengu_event_sampling_config`)
  - Controls the sink killswitch (`tengu_frond_boric`)
  - Controls the BQ batch configuration (`tengu_1p_event_batch_config`)
  - Controls the version cap / auto-update kill switch
  - Controls the safety-check gate for remotely managed settings
- **User attributes**: sends deviceId, sessionId, organizationUUID, accountUUID, email, subscriptionType, etc.

## 4. Remote Managed Settings (enterprise config delivery)

**File**: `src/services/remoteManagedSettings/index.ts`

- **Endpoint**: `{BASE_API_URL}/api/claude_code/settings`
- **Behavior**: delivers configuration to enterprise users, supports ETag/304 caching, polls in the background every hour
- **Safety**: when a change includes "dangerous settings", a dialog asks the user to confirm
- **Applies to**: all API key users can fetch; OAuth users only on Enterprise/C4E/Team
- **Fail-open**: on request failure the local cache is used; with no cache it is skipped

## 5. Settings Sync

**File**: `src/services/settingsSync/index.ts`

- **Endpoint**: `{BASE_API_URL}/api/claude_code/user_settings`
- **Behavior**: the CLI uploads local settings/memory to the remote; CCR mode downloads from the remote
- **Synced content**: userSettings, userMemory, projectSettings, projectMemory
- **Feature gate**: `UPLOAD_USER_SETTINGS` / `DOWNLOAD_USER_SETTINGS`
- **File size limit**: 500KB per file

## 6. OpenTelemetry third-party telemetry

**File**: `src/utils/telemetry/instrumentation.ts`

- **Behavior**: full OTEL SDK initialization, supporting three signals: metrics / logs / traces
- **Protocols**: gRPC / http-json / http-protobuf (chosen through `OTEL_EXPORTER_OTLP_PROTOCOL`)
- **Exporters**: console / otlp / prometheus
- **Trigger**: the `CLAUDE_CODE_ENABLE_TELEMETRY=1` environment variable
- **Enhanced tracing**: `feature('ENHANCED_TELEMETRY_BETA')` + the GrowthBook gate `enhanced_telemetry_beta`

## 7. BigQuery Metrics Exporter (internal metrics)

**File**: `src/utils/telemetry/bigqueryExporter.ts`

- **Endpoint**: `https://api.anthropic.com/api/claude_code/metrics`
- **Behavior**: periodically (5min interval) exports OTel metrics to internal BQ
- **Applies to**: API customers, C4E/Team subscribers
- **Organization-level opt-out**: queried through the `checkMetricsEnabled()` API (see item 8 below)

## 8. Organization-level metrics opt-out query

**File**: `src/services/api/metricsOptOut.ts`

- **Endpoint**: `https://api.anthropic.com/api/claude_code/organizations/metrics_enabled`
- **Behavior**: queries whether the organization has metrics enabled, with a two-level cache (memory 1h + disk 24h)
- **Effect**: controls whether the BigQuery metrics exporter exports

## 9. Startup profiling

**File**: `src/utils/startupProfiler.ts`

- **Behavior**: samples startup performance data (100% ant / 0.5% external), reported through `logEvent('tengu_startup_perf')`
- **Detailed mode**: `CLAUDE_CODE_PROFILE_STARTUP=1` writes a full performance report to a file

## 10. Beta session tracing

**File**: `src/utils/telemetry/betaSessionTracing.ts`

- **Behavior**: detailed debug traces that send the system prompt, model output, tool schemas, etc.
- **Trigger**: `ENABLE_BETA_TRACING_DETAILED=1` + `BETA_TRACING_ENDPOINT`
- **External users**: enabled automatically in SDK/headless mode; interactive mode needs the GrowthBook gate `tengu_trace_lantern`

## 11. Bridge poll config (remote polling interval)

**File**: `src/bridge/pollConfig.ts`

- **Behavior**: fetches the bridge polling interval configuration from GrowthBook (`tengu_bridge_poll_interval_config`)
- **Controls**: the various poll intervals for single-session and multi-session

## 12. Plugin/MCP telemetry

**File**: `src/utils/plugins/fetchTelemetry.ts`

- **Behavior**: records network requests from plugins/marketplaces (install counts, marketplace clone/pull, etc.)
- **Event**: `tengu_plugin_remote_fetch`, containing host (sanitized), outcome, duration

---

## Ways to disable globally

```bash
# Disable all telemetry (Datadog + 1P + surveys)
DISABLE_TELEMETRY=1

# More aggressive: disable all non-essential network traffic (including auto-update, grove, release notes, etc.)
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Third-party providers disable it automatically
CLAUDE_CODE_USE_BEDROCK=1  # or VERTEX/FOUNDRY
```

`src/utils/privacyLevel.ts` is the central control point, with three levels: `default < no-telemetry < essential-traffic`.

---

## Data flow architecture

```
User action → logEvent()
              ↓
         sink.ts (routing layer)
           ↙        ↘
   trackDatadogEvent()   logEventTo1P()
          ↓                      ↓
   Datadog HTTP API     OTel BatchLogRecordProcessor
   (us5.datadoghq.com)       ↓
                    FirstPartyEventLoggingExporter
                             ↓
                    api.anthropic.com/api/event_logging/batch
                             ↓
                    BigQuery (ClaudeCodeInternalEvent proto)
```

GrowthBook acts as an independent channel that drives the switches and configuration of both sinks above.
