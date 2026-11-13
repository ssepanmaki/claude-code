# MCP_SKILLS — MCP skill discovery

> Feature Flag: `FEATURE_MCP_SKILLS=1`
> Implementation status: functional (the config-gated filter is complete, the core fetcher is a stub)
> References: 9

## 1. Overview

MCP_SKILLS discovers resources exposed by MCP servers (the `skill://` URI scheme) and converts them into callable skill commands. An MCP server can provide tools, prompts and resources at the same time; with this feature enabled, resources with a `skill://` URI are recognized as skills.

### Core characteristics

- **Automatic discovery**: `skill://` resources are fetched automatically when an MCP server connects
- **Command conversion**: MCP resources are converted into `prompt`-type Command objects
- **Live refresh**: skills are fetched again when the prompts/resources lists change
- **Cache consistency**: the skill cache is cleared when a connection closes

## 2. Implementation architecture

### 2.1 Data flow

```
MCP Server connects
      │
      ▼
client.ts: connectToServer / setupMcpClientConnections
  ├── fetchToolsForClient     (MCP tools)
  ├── fetchCommandsForClient   (MCP prompts → Command objects)
  ├── fetchMcpSkillsForClient  (MCP skill:// resources → Command objects) [MCP_SKILLS]
  └── fetchResourcesForClient  (MCP resources)
      │
      ▼
commands = [...mcpPrompts, ...mcpSkills]
      │
      ▼
AppState.mcp.commands updated
      │
      ▼
getMcpSkillCommands() filters → SkillTool invokes
```

### 2.2 Skill filtering

File: `src/commands.ts:604-616`

`getMcpSkillCommands(mcpCommands)` filters on:

```ts
cmd.type === 'prompt'                  // must be the prompt type
cmd.loadedFrom === 'mcp'               // must come from an MCP server
!cmd.disableModelInvocation            // must be invocable by the model
feature('MCP_SKILLS')                  // the feature flag must be on
```

### 2.3 Conditional loading

File: `src/services/mcp/client.ts:129-133`

`fetchMcpSkillsForClient` is loaded conditionally through `require()`; when the feature flag is off no module is loaded:

```ts
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? require('../../skills/mcpSkills.js').fetchMcpSkillsForClient
  : null
```

### 2.4 Cache management

The skill-fetching function maintains a `.cache` (Map), which is cleared at these moments:

| Event | Behavior |
|-------|----------|
| Connection closed | Clear that client's skill cache |
| `disconnectMcpServer()` | Clear the skill cache |
| `prompts/list_changed` notification | Refresh prompts + fetch skills in parallel |
| `resources/list_changed` notification | Refresh resources + prompts + skills |

### 2.5 Integration points

| File | Lines | Description |
|------|-------|-------------|
| `src/commands.ts` | 604-616, 620-633 | Command filtering and SkillTool command collection |
| `src/services/mcp/client.ts` | 129-133, 1394, 1672, 2176 | Skill fetching, cache clearing, fetch on connect |
| `src/services/mcp/useManageMCPConnections.ts` | 22-26, 682-740 | Live refresh (prompts/resources changes) |

## 3. Key design decisions

1. **Feature gate isolation**: `feature('MCP_SKILLS')` guards the conditional `require()` and every call site. When off, no module is loaded and no fetch happens
2. **Resource-to-skill mapping**: skills are discovered from `skill://` URI resources of the MCP server. `fetchMcpSkillsForClient` does the conversion (currently a stub)
3. **Avoiding a circular dependency**: `mcpSkillBuilders.ts` is a leaf node of the dependency graph, avoiding the `client.ts ↔ mcpSkills.ts ↔ loadSkillsDir.ts` cycle
4. **Server capability check**: fetching skills also requires the MCP server to support resources (`!!client.capabilities?.resources`)

## 4. Usage

```bash
# Enable the feature
FEATURE_MCP_SKILLS=1 bun run dev

# Prerequisites:
# 1. An MCP server that supports skill:// resources is configured
# 2. The MCP server declares the resources capability
```

## 5. What still needs to be completed

| File | Status | To implement |
|------|--------|--------------|
| `src/skills/mcpSkills.ts` | Stub | `fetchMcpSkillsForClient()` — pick `skill://` URIs out of the MCP resource list and convert them into Command objects |
| `src/skills/mcpSkillBuilders.ts` | Stub | Skill builder registration (avoids the circular dependency) |

## 6. File index

| File | Responsibility |
|------|----------------|
| `src/commands.ts:547-608` | Skill command filtering |
| `src/services/mcp/client.ts:117-2358` | Skill fetching + cache management |
| `src/services/mcp/useManageMCPConnections.ts` | Live refresh |
| `src/skills/mcpSkills.ts` | Core conversion logic (stub) |
