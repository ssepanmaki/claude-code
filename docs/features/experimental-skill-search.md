# EXPERIMENTAL_SKILL_SEARCH — Semantic skill search

> Feature Flag: `FEATURE_EXPERIMENTAL_SKILL_SEARCH=1`
> Implementation status: all stubs (8 files), wiring complete
> References: 21

## 1. Overview

EXPERIMENTAL_SKILL_SEARCH provides the DiscoverSkills tool, which searches the available skills semantically against the current task. The goal is for the model to discover and recommend relevant skills (local and remote) automatically while performing a task, without the user having to look for them manually.

## 2. Implementation architecture

### 2.1 Module status

| Module | File | Status | Description |
|--------|------|--------|-------------|
| DiscoverSkillsTool | `src/tools/DiscoverSkillsTool/prompt.ts` | **Stub** | Empty tool name |
| Prefetch | `src/services/skillSearch/prefetch.ts` | **Stub** | All 3 functions are no-ops |
| Remote loading | `src/services/skillSearch/remoteSkillLoader.ts` | **Stub** | Returns empty results |
| Remote state | `src/services/skillSearch/remoteSkillState.ts` | **Stub** | Returns null/undefined |
| Signals | `src/services/skillSearch/signals.ts` | **Stub** | `DiscoverySignal = any` |
| Telemetry | `src/services/skillSearch/telemetry.ts` | **Stub** | No-op logging |
| Local search | `src/services/skillSearch/localSearch.ts` | **Stub** | No-op cache |
| Feature check | `src/services/skillSearch/featureCheck.ts` | **Stub** | `isSkillSearchEnabled => false` |
| SkillTool integration | `src/tools/SkillTool/SkillTool.ts` | **Wired** | Dynamically loads all remote skill modules |
| Prompt integration | `src/constants/prompts.ts` | **Wired** | DiscoverSkills schema injection |

### 2.2 Expected data flow

```
The model handles a user task
      │
      ▼
DiscoverSkills tool triggers [to be implemented]
      │
      ├── Local search: index the metadata of installed skills
      │   └── localSearch.ts → match skill name/description/keywords
      │
      └── Remote search: query the skill marketplace/registry
          └── remoteSkillLoader.ts → fetch + parse
      │
      ▼
Rank and filter the results
      │
      ▼
Return the list of recommended skills
      │
      ▼
The model invokes the recommended skills through SkillTool
```

### 2.3 Prefetch mechanism

`prefetch.ts` is expected to analyze the message content before the user submits input and search for relevant skills ahead of time:

- `startSkillDiscoveryPrefetch()` — start prefetching
- `collectSkillDiscoveryPrefetch()` — collect the prefetch result
- `getTurnZeroSkillDiscovery()` — get the skill discovery result for turn 0

## 3. What still needs to be completed

| Priority | Module | Effort | Description |
|----------|--------|--------|-------------|
| 1 | `DiscoverSkillsTool` | Large | Semantic search tool schema + execution |
| 2 | `skillSearch/prefetch.ts` | Medium | User-input analysis and prefetch logic |
| 3 | `skillSearch/remoteSkillLoader.ts` | Large | Fetching from a remote marketplace/registry |
| 4 | `skillSearch/remoteSkillState.ts` | Small | State management of discovered skills |
| 5 | `skillSearch/localSearch.ts` | Medium | Local index building/querying |
| 6 | `skillSearch/featureCheck.ts` | Small | GrowthBook/config gating |
| 7 | `skillSearch/signals.ts` | Small | `DiscoverySignal` type definition |

## 4. Key design decisions

1. **Prefetch optimization**: start searching before the user submits, reducing first-response latency
2. **Local + remote dual search**: fast local index matching + deep remote marketplace search
3. **SkillTool integration**: discovered skills are invoked through SkillTool, so no new invocation mechanism is needed
4. **Independent of MCP_SKILLS**: MCP_SKILLS discovers from MCP servers, while EXPERIMENTAL_SKILL_SEARCH discovers from a skill marketplace

## 5. Usage

```bash
# Enable the feature (it only becomes truly usable once completed)
FEATURE_EXPERIMENTAL_SKILL_SEARCH=1 bun run dev
```

## 6. File index

| File | Responsibility |
|------|----------------|
| `src/tools/DiscoverSkillsTool/prompt.ts` | Tool schema (stub) |
| `src/services/skillSearch/prefetch.ts` | Prefetch logic (stub) |
| `src/services/skillSearch/remoteSkillLoader.ts` | Remote loading (stub) |
| `src/services/skillSearch/remoteSkillState.ts` | Remote state (stub) |
| `src/services/skillSearch/signals.ts` | Signal types (stub) |
| `src/services/skillSearch/telemetry.ts` | Telemetry (stub) |
| `src/services/skillSearch/localSearch.ts` | Local search (stub) |
| `src/services/skillSearch/featureCheck.ts` | Feature check (stub) |
| `src/tools/SkillTool/SkillTool.ts` | SkillTool integration point |
| `src/constants/prompts.ts:95,335,778` | Prompt enhancement |
