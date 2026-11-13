# Memory and performance peak analysis report

> Process bun, RSS baseline **682 MB**, worst case **1.8 GB** | 2026-05-02 | **Investigation complete** (12 iterations)
> Fix commits: `ef10ad28` + `ab0bbbc4` (reduced 100-300 MB) | Architectural limit: Bun mimalloc/JSC does not return memory pages (~150-250 MB permanently held)

## Fixed (10 items)

| Problem | Original peak | Fix | Location |
|------|--------|------|------|
| O(n²) streaming string concatenation | 2-20 MB | `+=` → array accumulation | `claude.ts:1834,2271` |
| Messages.tsx multiple traversals | 100-270 MB | Merged into a single pass | `Messages.tsx:417-418` |
| ColorFile had no cache | 50-100 MB | LRU-50 | `HighlightedCode.tsx:14-61` |
| Ink StylePool unbounded | 10-50+ MB | Cap of 1000 | `@ant/ink/screen.ts:122` |
| CompanionSprite high frequency | CPU | TICK_MS→1000ms | `CompanionSprite.tsx:15` |
| MCP stderr buffer | 1-640 MB | 64→8MB/server | `mcp-client/connection.ts:117` |
| BashTool output buffer | 30-330 MB | 32→2MB | `stringUtils.ts:88` |
| Transcript write queue | 5-50 MB | Cap of 1000 | `sessionStorage.ts:613-619` |
| contentReplacementState | Keeps growing | Cleared on compact | `compact/compact.ts` |
| SSE buffer | Unbounded | 1MB cap | SSE handling code |

## P0 — Core bottlenecks (6 items)

| # | Problem | Peak | Location | Suggestion |
|---|------|------|------|------|
| 1 | 7-8x spread copies of the message array (3-4 copies resident at the tail of a turn) | 120-320 MB | 7 places in `query.ts` (:477,:491,:897,:1135,:1745,:1857,:1878) | Remove the spread / pass by reference / switch to push |
| 2 | AutoCompact timing flaw (check is before the API, growth is after) | API limit exceeded | `query.ts:575` | Add a predictive threshold check |
| 3 | reactiveCompact is an empty stub (no emergency compaction on API 413) | No fallback | all of `reactiveCompact.ts` | Implement the real logic |
| 4 | buildMessageLookups rebuilds 8 Maps/Sets (triggered by every streaming delta) | GC STW 100-173ms | `Messages.tsx:519` | Incremental update / split the useMemo chain |
| 5 | useDeferredValue double buffering | 100-200 MB | `REPL.tsx:1569` | Inherent to React scheduling; limited room to optimize |
| 6 | Compact peak window (preCompactReadFileState + summary + attachments) | 20-80 MB | `compact.ts:524-644` | Release preCompactReadFileState/summaryResponse earlier |

## P1 — Important bottlenecks (14 items)

| # | Problem | Peak | Location | Suggestion |
|---|------|------|------|------|
| 7 | OpenAI/Gemini/Grok compatibility layers O(n²) concatenation | 25-75 MB | 9 places in 3 files (`openai/index.ts:386`, `gemini/index.ts:148`, `grok/index.ts:163`) | Switch to array accumulation (same pattern as claude.ts) |
| 8 | messages.ts O(n²) concatenation | 10-25 MB | `messages.ts:3252,3268` | Switch to array accumulation |
| 9 | highlight.js loads all 192 languages (only 26 needed) | 8-12 MB | `color-diff-napi/index.ts:21` | Custom build |
| 10 | hlLineCache module-level singleton with 2048 entries | ~4 MB | `color-diff-napi/index.ts:508` | Switch to LRU + size cap |
| 11 | colorFileCache stores code 3x | 2-5 MB | `HighlightedCode.tsx:14` | Remove the code field from the value |
| 12 | Virtual scroll keeps 200 components resident | 50 MB | `useVirtualScroll.ts` | Lower OVERSCAN_ROWS / MAX_MOUNTED_ITEMS |
| 13 | FileReadTool large files (output capped at 100K chars, but fully loaded while reading) | A few MB temporarily | `FileReadTool.ts:342` | Check size before reading, truncate while streaming |
| 14 | Session restore loads everything (disk→JSON→REPL in three stages) | 200-300 MB | `sessionStorage.ts:3482` | Streaming JSONL / incremental restore |
| 15 | Session write accumulates 100MB | ~100 MB | `sessionStorage.ts:652` | Streaming writes |
| 16 | Forked Agent FileStateCache is a full clone | 50N MB | `forkedAgent.ts:382` | Shared/layered cache (10MB for agents) |
| 17 | GC threshold 350MB < baseline (pointless forced GC every second) | CPU waste | `cli/print.ts:554` | Raise to 800MB+ |
| 18 | PDF 100-page processing | ~100 MB | `apiLimits.ts:54` | Page-by-page streaming |
| 19 | Single image processing (base64→decode→resize) | ~16 MB/image | `apiLimits.ts:22` | Streaming resize |
| 20 | Token estimation error of ±25-50% amplifies the timing problem | Inaccurate thresholds | `tokenEstimation.ts:215` | Content-type-aware estimation |

## P2 — Minor issues (10 items)

| # | Problem | Peak | Location |
|---|------|------|------|
| 21 | lastAPIRequestMessages stays resident | 30-50 MB | `bootstrap/state.ts:118` |
| 22 | MCP Tool Schema stored twice | ~40 MB | `manager.ts:73` + `AppStateStore.ts:175` |
| 23 | ContentReplacementState grows monotonically | 0.5-2 MB | `toolResultStorage.ts:390` |
| 24 | Perfetto 100K events | ~30 MB | `perfettoTracing.ts:106` |
| 25 | StreamingMarkdown double rendering | Temporary | `Markdown.tsx:185` |
| 26 | MarkdownTable 3 traversals | CPU peak | `MarkdownTable.tsx:99` |
| 27 | Search index WeakMap | 5-10 MB | `transcriptSearch.ts:17` |
| 28 | ACP FileStateCache per session | 50 MB | `acp/agent.ts:554` |
| 29 | Agent initialMessages shallow copy | 1-5 MB/agent | `runAgent.ts:382` |
| 30 | Hook result accumulation | ~1 MB+ | `toolExecution.ts:1474` |

## CPU / rendering hotspots

| # | Problem | Impact | Location |
|---|------|------|------|
| C2 | Every React commit in Ink triggers Yoga layout | ~1-3ms/commit | `reconciler.ts:279` → `ink.tsx:323` |
| C3 | MessageRow mount ~1.5ms (React/Yoga/Ink pipeline overhead) | ~290ms stall on batch mounts | `useVirtualScroll.ts` |
| C4 | Layout shift triggers full-screen damage | O(rows×cols) | `ink.tsx:655-661` |
| C9 | Synchronous fs operations block the main thread | Intermittent stalls | `projectOnboardingState.ts:20` etc. |

Existing mitigations: React ConcurrentRoot batching, frame rate limit of 16ms, virtual scroll overscan 80 + SLIDE_STEP=25 + useDeferredValue, Markdown tokenCache LRU-500 + hasMarkdownSyntax fast path, Yoga incremental cache.

## Ruled out (summary of 12 rounds)

VSZ of 516 GB is virtual mapping | Zod ~650KB | Markdown LRU-500 already optimized | useSkillsChange/useSettingsChange clean up correctly | useInboxPoller converges by design (not a loop) | React Compiler `_c(N)` unused | File watchers ~5KB | React reconciler WeakMap + freeRecursive | Ink screen buffer ~86KB | CharPool/HyperlinkPool ~1-5MB reset every 5min | AWS/Google/Azure SDKs are all lazily loaded | Sentry is an empty implementation | useCallback closures avoided via messagesRef (no leak) | MCP stderrHandler has a 64MB cap + cleanup | useRef is cleaned up by clearConversation/compact | apiMetricsRef is reset at the end of a turn | useEffect has cleanup functions | lodash-es is tree-shakable | AppState useSyncExternalStore updates only the relevant slice | The SDK has no global retry queue | Ink unmount cleans up

## Conclusions

**Memory root causes, ranked**:
1. 7-8x spread copies of the message array (120-320 MB), the core bottleneck
2. useDeferredValue double buffering + full recomputation of the React useMemo chain (100-200 MB + GC STW)
3. Session restore/write peaks (200-300 MB)
4. AutoCompact timing flaw + the empty reactiveCompact stub (risk of exceeding the API limit)
5. Forked Agent FileStateCache clones (50N MB)
6. Virtual scroll's 200 resident components, ~50MB
7. Bun/JSC does not return memory pages (architectural)

**CPU root cause**: useInboxPoller polls every second → React commit → Yoga layout → the full-screen Ink diff full pipeline. Batch mounting of Markdown rendering stalls for ~290ms.

**Estimated optimization headroom**:

| Priority | Number of measures | Estimated reduction |
|--------|--------|----------|
| P0 | 6 | 240-600 MB |
| P1 | 14 | 300-600 MB |
| P2 | 10 | 80-200 MB |
| **Total** | **30 items** | **620-1400 MB** |

In theory it can drop from 400-700 MB to **200-350 MB** (bounded by the mimalloc/JSC architectural limit).
