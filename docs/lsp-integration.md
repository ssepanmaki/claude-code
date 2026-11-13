# LSP Integration

Claude Code has built-in Language Server Protocol (LSP) integration. It provides code intelligence (go to definition, find references, hover info, document symbols, and more) and passive diagnostic feedback.

## Quick start

### 1. Install an LSP plugin

In the Claude Code REPL, use the `/plugin` command to search for and install an LSP plugin:

```
/plugin
```

Search for `lsp`, find the plugin for your language (for example `typescript-lsp`), and install it.

After installing, run `/reload-plugins` to activate the plugin.

Once an LSP plugin is installed, the background LSP Server Manager loads it and starts the matching language server automatically. No manual configuration is needed.

### 2. Enable the LSP tool

The LSP tool must be enabled explicitly through an environment variable before Claude can issue code intelligence queries on its own:

```bash
ENABLE_LSP_TOOL=1 bun run dev
```

When it is not enabled, LSP servers still run in the background and push passive diagnostic feedback (type errors and so on).

## Automatic recommendations

Besides searching with `/plugin` manually, Claude Code detects the following while you edit files:

1. It watches `fileHistory.trackedFiles` and notices newly edited files.
2. It scans the installed marketplaces for an LSP plugin that declares support for the file extension.
3. It checks whether the matching LSP binary (for example `typescript-language-server`) is installed on the system.
4. When these conditions are met, it shows a recommendation dialog where you can choose to install.

```
┌───── LSP Plugin Recommendation ─────────────┐
│                                               │
│  LSP provides code intelligence like          │
│  go-to-definition and error checking          │
│                                               │
│  Plugin: typescript-lsp                       │
│  Triggered by: .ts files                     │
│                                               │
│  Would you like to install this LSP plugin?   │
│                                               │
│  > Yes, install typescript-lsp               │
│    No, not now                                │
│    Never for typescript-lsp                   │
│    Disable all LSP recommendations            │
└───────────────────────────────────────────────┘
```

- The dialog closes automatically after 30 seconds without input (counted as "No").
- Choosing "Never" stops recommending that plugin.
- Choosing "Disable" turns off all LSP recommendations.
- After 5 consecutive dismissals, recommendations are disabled automatically.

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│                    LSP Tool                         │
│  packages/builtin-tools/src/tools/LSPTool/LSPTool.ts│
│  (tool Claude can call, 9 operations)               │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              LSP Server Manager (Singleton)          │
│  src/services/lsp/manager.ts                        │
│  - initializeLspServerManager()                     │
│  - reinitializeLspServerManager()                   │
│  - shutdownLspServerManager()                       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           LSP Server Manager (instance)              │
│  src/services/lsp/LSPServerManager.ts               │
│  - manages multiple LSPServerInstance objects       │
│  - routes requests by file extension                │
│  - file sync (didOpen/didChange/didSave/didClose)   │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ LSPServer    │ │ LSPServer    │ │ LSPServer    │
│ Instance     │ │ Instance     │ │ Instance     │
│ (typescript) │ │ (python)     │ │ (rust...)    │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
┌──────▼───────┐ ┌──────▼───────┐ ┌──────▼───────┐
│ LSPClient    │ │ LSPClient    │ │ LSPClient    │
│ (JSON-RPC)   │ │ (JSON-RPC)   │ │ (JSON-RPC)   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
  child process    child process    child process
     (stdio)          (stdio)          (stdio)
```

### Passive diagnostic feedback

```
LSP Server ──publishDiagnostics──▶ passiveFeedback.ts
                                          │
                                          ▼
                                   LSPDiagnosticRegistry
                                   (dedup, capacity limits)
                                          │
                                          ▼
                                   Attachment System
                                   (injected into the conversation asynchronously)
```

LSP servers push `textDocument/publishDiagnostics` notifications asynchronously. After deduplication and capacity limiting, they are injected into Claude's conversation context as attachments.

## Core modules

| File | Responsibility |
|------|------|
| `src/services/lsp/manager.ts` | Global singleton; initialize / reinitialize / shutdown lifecycle management |
| `src/services/lsp/LSPServerManager.ts` | Multi-server management, routing by file extension, file sync |
| `src/services/lsp/LSPServerInstance.ts` | Lifecycle of a single LSP server instance (start / stop / restart / health check) |
| `src/services/lsp/LSPClient.ts` | JSON-RPC communication layer (built on `vscode-jsonrpc`), child process management |
| `src/services/lsp/config.ts` | Loads LSP server configuration from plugins |
| `src/services/lsp/LSPDiagnosticRegistry.ts` | Diagnostic registration, deduplication, capacity limits |
| `src/services/lsp/passiveFeedback.ts` | Registers the `publishDiagnostics` notification handler |
| `packages/builtin-tools/src/tools/LSPTool/LSPTool.ts` | LSP tool implementation (exposed to Claude) |
| `packages/builtin-tools/src/tools/LSPTool/schemas.ts` | Input schema (discriminated union of 9 operations) |
| `packages/builtin-tools/src/tools/LSPTool/formatters.ts` | Result formatting for each operation |
| `packages/builtin-tools/src/tools/LSPTool/prompt.ts` | Tool description text |
| `src/utils/plugins/lspPluginIntegration.ts` | Loading from plugins, validation, environment variable resolution, scope management |

## Operations supported by the LSP tool

| Operation | LSP method | Description |
|------|-----------|------|
| `goToDefinition` | `textDocument/definition` | Jump to a symbol's definition |
| `findReferences` | `textDocument/references` | Find all references |
| `hover` | `textDocument/hover` | Get hover info (docs, types) |
| `documentSymbol` | `textDocument/documentSymbol` | Get all symbols in a document |
| `workspaceSymbol` | `workspace/symbol` | Search symbols across the whole workspace |
| `goToImplementation` | `textDocument/implementation` | Find implementations of an interface or abstract method |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | Get the call hierarchy item at a position |
| `incomingCalls` | `callHierarchy/incomingCalls` | Find all functions that call this function |
| `outgoingCalls` | `callHierarchy/outgoingCalls` | Find all functions this function calls |

Every operation requires the `filePath`, `line` (1-based), and `character` (1-based) parameters.

## Plugin development: LSP server configuration

LSP servers are provided by plugins. A plugin's `manifest.json` can declare LSP servers in three formats:

**1. Inline config (defined directly in the manifest)**

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      }
    }
  }
}
```

**2. Reference to an external .lsp.json file**

```json
{
  "lspServers": "path/to/.lsp.json"
}
```

**3. Mixed array format**

```json
{
  "lspServers": [
    "path/to/.lsp.json",
    {
      "another-server": { "command": "...", "extensionToLanguage": { "...": "..." } }
    }
  ]
}
```

You can also place a `.lsp.json` file directly in the plugin directory without declaring it in the manifest.

### LSP server config schema

| Field | Type | Required | Description |
|------|------|------|------|
| `command` | string | Yes | Executable command for the LSP server (no spaces) |
| `args` | string[] | No | Command-line arguments |
| `extensionToLanguage` | `Record<string, string>` | Yes | Mapping from file extension to language ID (at least one) |
| `transport` | `"stdio"` \| `"socket"` | No | Communication method; defaults to `stdio` |
| `env` | `Record<string, string>` | No | Environment variables set when starting the server |
| `initializationOptions` | unknown | No | Initialization options passed to the server |
| `settings` | unknown | No | Settings passed through `workspace/didChangeConfiguration` |
| `workspaceFolder` | string | No | Workspace directory path |
| `startupTimeout` | number | No | Startup timeout in milliseconds |
| `maxRestarts` | number | No | Maximum restart count (default 3) |

### Environment variable substitution

`command`, `args`, `env`, and `workspaceFolder` in the config support:

- `${CLAUDE_PLUGIN_ROOT}`: the plugin root directory
- `${CLAUDE_PLUGIN_DATA}`: the plugin data directory
- `${user_config.KEY}`: a value the user set when enabling the plugin
- `${VAR}`: a system environment variable

## Lifecycle management

### Server state machine

```
stopped → starting → running
running → stopping → stopped
any     → error (on failure)
error   → starting (on retry)
```

### Crash recovery

- When an LSP server crashes, its state is set to `error`.
- The next request tries to restart it automatically (through `ensureServerStarted`).
- After more than `maxRestarts` (default 3) attempts, it gives up.

### Transient error retry

- `ContentModified` errors (LSP error code -32801) are retried automatically, up to 3 times.
- Retries use exponential backoff: 500ms → 1000ms → 2000ms.
- These errors are common with servers such as rust-analyzer that are still indexing the project.

### Diagnostic capacity limits

- At most 10 diagnostics per file.
- At most 30 diagnostics in total.
- Anything beyond that is sorted by severity and truncated (Error > Warning > Info > Hint).
- Cross-turn dedup: a diagnostic that was already sent is not sent again.
- After a file is edited, its sent-record is cleared so new diagnostics can come through.

### Plugin refresh

After installing or uninstalling a plugin, use `/reload-plugins`. It calls `reinitializeLspServerManager()`, which:
1. Shuts down the old server instances asynchronously.
2. Resets the state to `not-started`.
3. Calls `initializeLspServerManager()` to reload the plugin config.

## Dependencies

- `vscode-jsonrpc`: JSON-RPC communication (lazy-loaded; required only when a server instance is actually created)
- `vscode-languageserver-protocol`: LSP protocol types
- `vscode-languageserver-types`: LSP type definitions
- `lru-cache`: diagnostic dedup cache
