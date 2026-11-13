# CONTEXT_COLLAPSE: context collapsing

> Feature Flag: `FEATURE_CONTEXT_COLLAPSE=1`
> Sub-feature: `FEATURE_HISTORY_SNIP=1`
> Implementation status: all core logic is stubbed, wiring is complete
> References: CONTEXT_COLLAPSE 20 + HISTORY_SNIP 16 = 36

## 1. Overview

CONTEXT_COLLAPSE lets the model introspect context window usage and compress old messages intelligently. When the conversation nears the context limit, old messages are automatically collapsed into compressed summaries, keeping the key information while freeing token space.

### Sub-features

| Feature | Function |
|---------|------|
| `CONTEXT_COLLAPSE` | Context collapse engine (background LLM calls compress old messages) |
| `HISTORY_SNIP` | SnipTool: marks messages for collapsing/trimming |

## 2. Architecture

### 2.1 Module status

| Module | File | Status |
|------|------|------|
| Collapse core | `src/services/contextCollapse/index.ts` | **Stub**: the interfaces are complete (`ContextCollapseStats`, `CollapseResult`, `DrainResult`); all functions are no-ops |
| Collapse operations | `src/services/contextCollapse/operations.ts` | **Stub**: `projectView` is the identity function |
| Collapse persistence | `src/services/contextCollapse/persist.ts` | **Stub**: `restoreFromEntries` is a no-op |
| CtxInspectTool | `packages/builtin-tools/src/tools/CtxInspectTool/CtxInspectTool.ts` | **Implemented**: context introspection tool |
| SnipTool prompt | `src/tools/SnipTool/prompt.ts` | **Stub**: empty tool name |
| SnipTool implementation | `src/tools/SnipTool/SnipTool.ts` | **Missing** |
| force-snip command | `src/commands/force-snip.js` | **Missing** |
| Collapse read/search | `src/utils/collapseReadSearch.ts` | **Complete**: Snip is a silently absorbed operation |
| QueryEngine integration | `src/QueryEngine.ts` | **Wired**: imports and uses the snip projection |
| Token warning UI | `src/components/TokenWarning.tsx` | **Wired**: collapse progress label |

### 2.2 Core interfaces (defined, to be implemented)

```ts
// contextCollapse/index.ts
interface ContextCollapseStats {
  // context usage statistics
}
interface CollapseResult {
  // result of a collapse operation
}
interface DrainResult {
  // result of an emergency release
}

// Key functions (all stubs):
isContextCollapseEnabled()          // → false
applyCollapsesIfNeeded(messages)    // pass-through
recoverFromOverflow(messages)       // pass-through (413 recovery)
initContextCollapse()               // no-op
```

### 2.3 Expected data flow

```
Conversation keeps growing
      │
      ▼
Context nears the limit (detected by query.ts)
      │
      ├── Overflow detection (query.ts:440,616,802)
      │
      ▼
applyCollapsesIfNeeded(messages) [to be implemented]
      │
      ├── Background LLM call compresses old messages
      ├── Keeps key information (decisions, file paths, errors)
      └── Replaces old messages with compressed summaries
      │
      ├── 413 recovery (query.ts:1093,1179)
      │   └── recoverFromOverflow() emergency collapse
      │
      ▼
projectView() filters the collapsed message view
      │
      ▼
The model carries on (in the compressed context)
```

### 2.4 The HISTORY_SNIP sub-feature

SnipTool provides manual collapsing:

- The `/force-snip` command forces a collapse
- SnipTool marks specific messages for collapsing/trimming
- `collapseReadSearch.ts` is fully implemented and treats Snip as a silently absorbed operation

### 2.5 Integration points

| File | Location | Notes |
|------|------|------|
| `src/query.ts` | 18,440,616,802,1093,1179 | Overflow detection, 413 recovery, applying collapses |
| `src/QueryEngine.ts` | 124,127,1301 | Snip projection use |
| `src/utils/analyzeContext.ts` | 1122 | Skips the reserved-buffer display |
| `src/utils/sessionRestore.ts` | 127,494 | Restores collapse state |
| `src/services/compact/autoCompact.ts` | 179,215 | Takes collapsing into account during auto-compaction |

## 3. What remains to be built

| Priority | Module | Effort | Notes |
|--------|------|--------|------|
| 1 | `services/contextCollapse/index.ts` | Large | Collapse state machine, LLM calls, message compression |
| 2 | `services/contextCollapse/operations.ts` | Medium | `projectView()` message filtering |
| 3 | `services/contextCollapse/persist.ts` | Small | `restoreFromEntries()` disk persistence |
| 4 | `tools/CtxInspectTool/` | Done | The context introspection tool is implemented (`packages/builtin-tools/src/tools/CtxInspectTool/`) |
| 5 | `tools/SnipTool/SnipTool.ts` | Medium | Snip tool implementation |
| 6 | `commands/force-snip.js` | Small | `/force-snip` command |

## 4. Key design decisions

1. **Background LLM compression**: collapsing is not plain truncation; an LLM generates a compressed summary that keeps the key information
2. **413 recovery**: when the API returns 413 (request too large), an emergency collapse is the most important recovery path
3. **Works alongside autoCompact**: collapse and auto-compaction (compact) are different mechanisms; collapse works at the message level, compaction at the conversation level
4. **Persistence**: collapse state is persisted to disk and reloaded when a session is restored

## 5. Usage

```bash
# Enable context collapse
FEATURE_CONTEXT_COLLAPSE=1 bun run dev

# Enable the snip sub-feature
FEATURE_CONTEXT_COLLAPSE=1 FEATURE_HISTORY_SNIP=1 bun run dev
```

## 6. File index

| File | Responsibility |
|------|------|
| `src/services/contextCollapse/index.ts` | Collapse core (stub, interfaces defined) |
| `src/services/contextCollapse/operations.ts` | Projection operations (stub) |
| `src/services/contextCollapse/persist.ts` | Persistence (stub) |
| `src/utils/collapseReadSearch.ts` | Snip absorption (complete) |
| `src/query.ts` | Overflow detection and 413 recovery integration |
| `src/QueryEngine.ts` | Snip projection use |
| `src/components/TokenWarning.tsx` | Collapse progress UI |
