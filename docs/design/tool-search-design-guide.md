# ToolSearch Design Guide

> A systematic record of ToolSearch's architecture, core mechanisms, evolution history, and maintenance guide, based on four iterations of commits on the feature/tool_search branch.

## 1. Background

Claude Code ships with 60+ built-in tools, and the MCP servers a user connects can add dozens or even hundreds more. Sending the full schema of every tool to the model at once causes several serious problems:

1. **Token explosion** — each tool definition (name + description + inputSchema) costs several hundred tokens on average, so 60 tools is a constant overhead of tens of thousands of tokens.
2. **Prompt cache invalidation** — the tool list is part of the prompt and takes part in cache computation. Any addition or removal of a tool (such as an MCP server connecting/disconnecting) invalidates the whole cached segment.
3. **Diluted model attention** — too many tool definitions interfere with the model's accuracy in choosing core tools.

## 2. Solution overview

ToolSearch uses a **deferred loading** pattern:

- Tools are split into **Core Tools** (always loaded) and **Deferred Tools** (discovered on demand)
- The model searches for and discovers deferred tools through the `SearchExtraTools` tool
- Discovered deferred tools are executed by proxy through the `ExecuteExtraTool` tool
- **The tools array stays stable during a session**, and discovered deferred tools are no longer injected dynamically (the key decision of the v3 fix)

## 3. Core architecture

### 3.1 Tool classification

```
┌─────────────────────────────────────────────────────────────┐
│                     All Tools (60+ built-in + MCP)          │
├───────────────────────────┬─────────────────────────────────┤
│    Core Tools (29)        │     Deferred Tools (the rest)   │
│    always loaded,         │     schema not loaded,          │
│    called directly        │     discovered on demand        │
│    defined by CORE_TOOLS  │     decided by isDeferredTool() │
│    allowlist              │                                 │
└───────────────────────────┴─────────────────────────────────┘
```

**Core Tools** (the `CORE_TOOLS` Set in `src/constants/tools.ts`):

| Category | Tools |
|------|------|
| File operations | Bash/Shell, Read, Edit, Write, Glob, Grep, NotebookEdit |
| Agent interaction | Agent, AskUserQuestion |
| Task management | TaskOutput, TaskStop, TaskCreate, TaskGet, TaskList, TaskUpdate, TodoWrite |
| Planning | EnterPlanMode, ExitPlanMode, VerifyPlanExecution |
| Web | WebFetch, WebSearch |
| Code intelligence | LSP |
| Skills | Skill |
| Scheduling/monitoring | Sleep |
| Tool discovery | SearchExtraTools, ExecuteExtraTool, SyntheticOutput |

**isDeferredTool logic** (`packages/builtin-tools/src/tools/SearchExtraToolsTool/prompt.ts`):

```
isDeferredTool(tool) =
  tool.alwaysLoad === true?  → false (explicitly skip deferral)
  CORE_TOOLS.has(tool.name)? → false (core tools are not deferred)
  otherwise                  → true (everything else is deferred)
```

### 3.2 Three-layer component architecture

```
┌──────────────────────────────────────────────────────┐
│  API Layer (src/services/api/claude.ts)              │
│  ├─ Decides whether ToolSearch is enabled            │
│  ├─ Filters deferred tools out of the API tools array│
│  ├─ Injects <available-deferred-tools> or a delta    │
│  │  attachment                                       │
│  └─ Normalizes tool_reference/text message formats   │
├──────────────────────────────────────────────────────┤
│  Query Loop (src/query.ts)                           │
│  ├─ Turn-zero prefetch: triggered on user input      │
│  └─ Inter-turn prefetch: triggered asynchronously    │
│     after an assistant turn                          │
├──────────────────────────────────────────────────────┤
│  Search Engine                                       │
│  ├─ SearchExtraToolsTool — search entry (4 query modes) │
│  ├─ TF-IDF Index (toolIndex.ts) — semantic search    │
│  ├─ Keyword Search — exact matching                  │
│  └─ ExecuteExtraTool — proxy execution               │
└──────────────────────────────────────────────────────┘
```

### 3.3 Search engine design

SearchExtraToolsTool supports four query modes:

| Mode | Syntax | Behavior | Returns |
|------|------|------|------|
| **Select** | `select:CronCreate,Snip` | Fetch directly by name, comma-separated for multiple | Exact match list |
| **Discover** | `discover:schedule cron job` | Pure discovery mode, returns description + schema | Tool info text |
| **Keyword** | `notebook jupyter` | Keyword search | Sorted by relevance |
| **Required** | `+slack send` | The `+` prefix forces inclusion | Results containing the required term |

**Hybrid search algorithm**:

```
final score = keyword score × 0.4 + TF-IDF score × 0.6
```

- **Keyword Search**: weighted scoring based on tool-name parsing (CamelCase tokenization, MCP prefix splitting), searchHint matching, and description text matching
- **TF-IDF Search**: reuses the algorithm from `skillSearch/localSearch.ts`, computing weighted TF-IDF vectors over three fields: name (3.0), searchHint (2.5), and description (1.0)

**MCP tool name parsing**:

```
mcp__slack__send_message → parts: ["slack", "send", "message"]
CamelCase → parts: ["cron", "create"]
```

### 3.4 Execution pipeline

```
The model calls ExecuteExtraTool({tool_name: "CronCreate", params: {...}})
  ↓
ExecuteTool.call() looks up CronCreate in the global tool registry
  ↓
Checks the target tool's isEnabled() — bridged/conditional tools may be unavailable
  ↓
Delegates to the target tool's checkPermissions() — permissions pass through to the actual tool
  ↓
Calls the target tool's call() — fully equivalent to a direct call
  ↓
Returns the result (wrapped in ExecuteExtraTool's output schema)
```

Key design point: ExecuteExtraTool's `checkPermissions()` returns `passthrough`, delegating the permission decision entirely to the target tool. It introduces no extra permission layer of its own.

### 3.5 Prompt cache stability strategy (the key v3 fix)

**Problem**: early versions injected a deferred tool into the API tools array after discovering it, so the tools JSON changed each time a new tool was discovered, and the prompt cache was fully invalidated.

**Fix** (commit `c14b7ead`): deferred tools **never enter the API tools array**. For the whole session the tools array contains only core tools + SearchExtraTools + ExecuteExtraTool, and stays stable.

```
API tools array (unchanged during the session):
  [Core Tools (29)] + [SearchExtraTools, ExecuteExtraTool, SyntheticOutput]
  
  Excludes: any deferred tool (even one already discovered)
  Execution: proxied through ExecuteExtraTool
```

## 4. Prefetch

### 4.1 Two trigger points

1. **Turn-zero** (`getTurnZeroSearchExtraToolsPrefetch`) — on the first turn of user input, searches for relevant deferred tools based on the input text and injects them as an attachment
2. **Inter-turn** (`startSearchExtraToolsPrefetch`) — after an assistant turn ends, searches asynchronously based on the conversation context

### 4.2 Attachment pipeline

```
prefetch → Attachment(type: 'tool_discovery')
  → messages.ts converts it to a system-reminder
  → "The following tools were discovered... Use ExecuteExtraTool to invoke..."
```

### 4.3 Session dedup

The `discoveredToolsThisSession` Set tracks tools already discovered, to avoid repeated recommendations. This Set is independent of the skill prefetch dedup set, and they do not affect each other. `addBoundedSessionEntry()` keeps it capped at 500 entries, trimming to 400 when exceeded.

## 5. Mode switching

Controlled by the environment variable `ENABLE_SEARCH_EXTRA_TOOLS`:

| Environment variable value | Mode | Behavior |
|-----------|------|------|
| unset | `tst` | Enabled by default, always defers non-core tools |
| `true` | `tst` | Force enabled |
| `false` | `standard` | Fully disabled, all tools loaded inline |
| `auto` | `tst-auto` | Enabled only when deferred tools exceed 10% of the context window |
| `auto:N` | `tst-auto` | Custom threshold percentage (N=0 enables, N=100 disables) |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` | `standard` | Global kill switch |

`isSearchExtraToolsEnabledOptimistic()` — quick check (no threshold check), used for tool registration
`isSearchExtraToolsEnabled()` — full check (including the threshold check), used for API calls

## 6. Deferred tools delta mechanism

For Anthropic-internal users (`USER_TYPE=ant`) or users with the `tengu_glacier_2xr` feature flag enabled, a **delta attachment** replaces the `<available-deferred-tools>` header injection:

- First time: injects the full deferred tools list
- Afterwards: injects only incremental changes (added/removed)
- Advantage: changes in the tool pool do not invalidate the cache for the whole header

The delta attachment scans the `deferred_tools_delta` attachments in the message history, rebuilds the announced set, and then diffs it against the current deferred pool.

## 7. Evolution history

### v1: infrastructure layer (`7be08f53`)

**34 files, +4040/-90 lines**

- Defined the `CORE_TOOLS` allowlist (31 core tools)
- Implemented the TF-IDF tool index module `toolIndex.ts`
- Created `ExecuteTool` as the unified execution entry
- Enhanced ToolSearchTool: TF-IDF search path, discover mode, parallel search merging
- Added 27 unit tests
- Implemented the prefetch pipeline and UI components

**Key files**:
- `src/services/toolSearch/toolIndex.ts` → later renamed `searchExtraTools/toolIndex.ts`
- `packages/builtin-tools/src/tools/ExecuteTool/` — execution entry
- `src/constants/tools.ts` — CORE_TOOLS definition

### v2: unified self-built search (`8c157f07`)

**17 files, +274/-395 lines** (net reduction of 121 lines)

- **Removed `tool_reference` blocks** — no longer depends on the Anthropic API's `tool_reference` feature
- **Removed the `defer_loading` field** — no longer sends API-level deferred-loading markers for tools
- **Removed `modelSupportsToolReference()`** — no longer distinguishes whether a model supports tool_reference
- **Renamed ExecuteTool → ExecuteExtraTool** — expresses its role as a proxy executor more clearly
- **Output changed to plain text** — works for all providers, with no special API support needed
- **Simplified the system prompt** — tool usage guidance compressed from ~120 lines to ~10

**Design decision**: the core insight of this refactor was that depending on private Anthropic API features (tool_reference, defer_loading, beta header) made the system usable only with the first-party provider. A self-built TF-IDF + keyword search fully meets the need and works for all providers (OpenAI, Gemini, Grok).

### v3: cache stability fix (`c14b7ead`)

**7 files, +46/-31 lines**

- **Removed the "discover then include" logic** — discovered deferred tools are no longer injected into the tools array
- **Tools array kept stable** — only core tools + SearchExtraTools + ExecuteExtraTool
- **Strengthened priority guidance** — core tools are called directly, and ToolSearch is only a way to discover deferred tools
- **Rejection message for already-loaded tools** — searching for a core tool returns an explicit rejection

**Design decision**: the prompt cache is key to Claude Code's performance. Every change to the tools JSON invalidates the cache, at a cost far greater than the extra tokens of calling deferred tools by proxy through ExecuteExtraTool. So some convenience of direct calls was traded away for cache stability.

### v4: deferring Agents/Teams (`af0d7dc8`)

**7 files, +36/-18 lines**

- Removed `TeamCreate`, `TeamDelete`, and `SendMessage` from CORE_TOOLS
- These tools are commonly used only in swarm mode and otherwise take up context tokens
- In swarm mode SendMessage stays always loaded
- TeamCreate/TeamDelete return an enablement hint when swarm is not enabled

**Design decision**: not every user needs team features. Once deferred, most users save the token overhead of about 3 tool definitions.

## 8. File index

### Core files

| File | Responsibility |
|------|------|
| `src/constants/tools.ts` | CORE_TOOLS allowlist, tool permission sets |
| `src/utils/searchExtraTools.ts` | Mode decision, threshold calculation, delta diff, discovered tools extraction |
| `src/services/searchExtraTools/toolIndex.ts` | TF-IDF index building and search |
| `src/services/searchExtraTools/prefetch.ts` | Prefetch pipeline (turn-zero + inter-turn) |
| `packages/builtin-tools/src/tools/SearchExtraToolsTool/` | Search tool implementation (4 query modes) |
| `packages/builtin-tools/src/tools/ExecuteTool/` | Proxy executor implementation |
| `src/services/api/claude.ts` | API layer integration (tool filtering, message normalization) |
| `src/query.ts` | Query loop integration (prefetch trigger points) |
| `src/utils/messages.ts` | Attachment → system-reminder conversion |

### Shared infrastructure

| File | Reused exports |
|------|-------------|
| `src/services/skillSearch/localSearch.ts` | `tokenizeAndStem`, `computeWeightedTf`, `computeIdf`, `cosineSimilarity` |
| `src/services/skillSearch/prefetch.ts` | `extractQueryFromMessages` |

### Test files

| File | Coverage |
|------|---------|
| `src/services/searchExtraTools/__tests__/toolIndex.test.ts` | Index building, TF-IDF search, CJK handling |
| `src/services/searchExtraTools/__tests__/prefetch.test.ts` | Prefetch pipeline, dedup, attachment generation |
| `packages/builtin-tools/src/tools/SearchExtraToolsTool/__tests__/` | The 4 search tool modes |
| `packages/builtin-tools/src/tools/ExecuteTool/__tests__/` | Proxy execution |

## 9. Maintenance guide

### 9.1 Deciding whether to defer a new tool

Criteria for making a new tool deferred:
- The tool is used only in specific scenarios (such as swarm mode or a particular MCP integration)
- The tool's schema is large (takes up many context tokens)
- The tool is not a core operation the model would try by default

To promote a deferred tool to a core tool:
- Add the tool name constant to the `CORE_TOOLS` Set in `src/constants/tools.ts`
- Make sure the matching `*_TOOL_NAME` constant is imported

### 9.2 Notes when making changes

1. **Changing the TF-IDF functions in `localSearch.ts`**: also check `toolIndex.test.ts` and `localSearch.test.ts`
2. **Changing `extractQueryFromMessages` in `skillSearch/prefetch.ts`**: also check tool prefetch behavior (`searchExtraTools/prefetch.ts` calls the same function)
3. **Changing CORE_TOOLS**: update the `src/constants/__tests__/tools.test.ts` tests
4. **Changing `isDeferredTool`**: update `src/constants/__tests__/tools.test.ts` and `SearchExtraToolsTool.test.ts`

### 9.3 Performance tuning configuration

```bash
# Environment variable tuning
ENABLE_SEARCH_EXTRA_TOOLS=auto:15    # enable when deferred tools exceed 15% of context
SEARCH_EXTRA_TOOLS_WEIGHT_KEYWORD=0.5  # keyword search weight
SEARCH_EXTRA_TOOLS_WEIGHT_TFIDF=0.5    # TF-IDF search weight
SEARCH_EXTRA_TOOLS_DISPLAY_MIN_SCORE=0.10  # minimum display score threshold
```

### 9.4 Tuning search quality

- `TOOL_FIELD_WEIGHT` (`toolIndex.ts`): controls how much name/searchHint/description contribute to the TF-IDF score
- `KEYWORD_WEIGHT` / `TFIDF_WEIGHT` (`SearchExtraToolsTool.ts`): control the final weight ratio of the two algorithms in hybrid search
- The `searchHint` property: add a carefully written search hint to a tool to improve keyword matching quality

## 10. Relationship to Skill Search

ToolSearch and SkillSearch are parallel search systems that share the underlying algorithms but serve different domains:

| Dimension | ToolSearch | SkillSearch |
|------|-----------|-------------|
| What is searched | Deferred tools (built-in + MCP) | User skills |
| Execution | Proxy call via `ExecuteExtraTool` | Directly injects attachment content |
| Field weights | name:3.0, searchHint:2.5, desc:1.0 | name:3.0, whenToUse:2.0, desc:1.0 |
| Cache strategy | Cached by tool name list | Cached by cwd |
| Dedup set | `discoveredToolsThisSession` | A separate Set |

Shared underlying functions:
- `tokenizeAndStem` — unified CJK/ASCII tokenization and stemming
- `computeWeightedTf` — weighted term frequency computation
- `computeIdf` — inverse document frequency computation
- `cosineSimilarity` — vector cosine similarity
- `extractQueryFromMessages` — extracts the search query text from conversation history
