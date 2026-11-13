# WEB_SEARCH_TOOL — Web Search Tool

> Status: adapter architecture complete; supports API / Bing / Brave backends
> References: core tool, no feature flag gating (always enabled)

## 1. Overview

WebSearchTool lets the model search the internet for up-to-date information. The original implementation only supported Anthropic API server-side search (the `web_search_20250305` server tool), which is unavailable behind third-party proxy endpoints. It has been refactored into an adapter architecture that supports API server-side search plus two HTML-parsing backends, Bing and Brave, so search works with any API endpoint.

## 2. Architecture

### 2.1 Adapter Pattern

```
WebSearchTool.call()
       │
       ▼
  createAdapter()  ← adapter factory
       │
       ├── ApiSearchAdapter  — Anthropic official API server-side search
       │     └── uses the web_search_20250305 server tool
       │         makes a second API call via queryModelWithStreaming
       │
       ├── BingSearchAdapter  — Bing HTML scraping + regex extraction
       │     └── fetches the Bing results page HTML directly
       │         extracts title/URL/snippet from b_algo blocks with regexes
       │
       └── BraveSearchAdapter — Brave LLM Context API
             └── calls the Brave HTTPS GET endpoint
                 maps the grounding payload to title/URL/snippet
```

### 2.2 Module Structure

| Module | File | Description |
|--------|------|-------------|
| Tool entry | `packages/builtin-tools/src/tools/WebSearchTool/WebSearchTool.ts` | `buildTool()` definition: schema, permissions, execution, output formatting |
| Tool prompt | `packages/builtin-tools/src/tools/WebSearchTool/prompt.ts` | System prompt for the search tool |
| UI rendering | `packages/builtin-tools/src/tools/WebSearchTool/UI.tsx` | Terminal rendering component for search results |
| Adapter interface | `packages/builtin-tools/src/tools/WebSearchTool/adapters/types.ts` | `WebSearchAdapter` interface, `SearchResult`/`SearchOptions`/`SearchProgress` types |
| Adapter factory | `packages/builtin-tools/src/tools/WebSearchTool/adapters/index.ts` | `createAdapter()` factory that selects the backend |
| API adapter | `packages/builtin-tools/src/tools/WebSearchTool/adapters/apiAdapter.ts` | Wraps the original `queryModelWithStreaming` logic using the server tool |
| Bing adapter | `packages/builtin-tools/src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing HTML scraping + regex parsing |
| Brave adapter | `packages/builtin-tools/src/tools/WebSearchTool/adapters/braveAdapter.ts` | Brave LLM Context API adaptation and result mapping |
| Unit tests | `packages/builtin-tools/src/tools/WebSearchTool/__tests__/bingAdapter.test.ts`, `packages/builtin-tools/src/tools/WebSearchTool/__tests__/braveAdapter*.test.ts`, `packages/builtin-tools/src/tools/WebSearchTool/__tests__/adapterFactory.test.ts` | Bing / Brave parsing and factory logic tests |
| Integration tests | `packages/builtin-tools/src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts`, `packages/builtin-tools/src/tools/WebSearchTool/__tests__/braveAdapter.integration.ts` | Real network request verification |

### 2.3 Data Flow

```
Model calls WebSearchTool(query, allowed_domains, blocked_domains)
       │
       ▼
  validateInput() — checks query is non-empty and allowed/blocked don't coexist
       │
       ▼
  createAdapter() → ApiSearchAdapter | BingSearchAdapter | BraveSearchAdapter
       │
       ▼
  adapter.search(query, { allowedDomains, blockedDomains, signal, onProgress })
       │
       ├── onProgress({ type: 'query_update', query })
       │
       ├── axios.get(search-engine-url)
       │     └── API auth headers
       │
       ├── extractResults(payload) — extract results per backend
       │     └── grounding → SearchResult[] mapping
       │
       ├── client-side domain filtering (allowedDomains / blockedDomains)
       │
       ├── onProgress({ type: 'search_results_received', resultCount })
       │
       ▼
  Formatted as a markdown link list and returned to the model
```

## 3. Bing Adapter Details

### 3.1 Anti-Bot Workaround

Uses 13 Edge browser request headers (including `Sec-Ch-Ua`, `Sec-Fetch-*`, etc.) so Bing doesn't return an empty JS-rendered page:

```typescript
const BROWSER_HEADERS = {
  'User-Agent': '...Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Sec-Ch-Ua': '"Microsoft Edge";v="131", "Chromium";v="131", ...',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  // ... 13 headers in total
}
```

The `setmkt=en-US` parameter forces the US English market, avoiding regionalized results caused by IP geolocation.

### 3.2 URL Decoding (`resolveBingUrl()`)

Bing returns redirect URLs in the form `bing.com/ck/a?...&u=a1aHR0cHM6Ly9...`

- The first 2 characters of the `u` parameter are a protocol prefix: `a1` = https, `a0` = http
- The remainder is the real URL, base64url-encoded
- Bing-internal links and relative paths are filtered out and return `undefined`

### 3.3 Snippet Extraction (`extractSnippet()`)

A three-level fallback strategy:

1. `<p class="b_lineclamp...">` — Bing's search snippet paragraph
2. `<p>` inside `<div class="b_caption">` — alternate snippet location
3. Direct text of `<div class="b_caption">` — final fallback

### 3.4 Domain Filtering

Implemented client-side, with subdomain matching:
- `allowedDomains`: allowlist; a result's domain must match one of the entries (subdomains included)
- `blockedDomains`: blocklist; matching results are filtered out
- The two cannot be used together (enforced by `validateInput`)

## 4. Adapter Selection Logic

`createAdapter()` picks the backend in the following priority order and caches the adapter instance by the selected backend key:

```typescript
export function createAdapter(): WebSearchAdapter {
  // 1. Explicitly set via WEB_SEARCH_ADAPTER=api|bing|brave
  // 2. Official Anthropic API base URL → ApiSearchAdapter
  // 3. Third-party proxy / non-official endpoint → BingSearchAdapter
}
```

Setting `WEB_SEARCH_ADAPTER=brave` explicitly switches to the Brave LLM Context API backend, which requires
`BRAVE_SEARCH_API_KEY` or `BRAVE_API_KEY`.

## 5. Interface Definitions

### WebSearchAdapter

```typescript
interface WebSearchAdapter {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}

interface SearchResult {
  title: string
  url: string
  snippet?: string
}

interface SearchOptions {
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal?: AbortSignal
  onProgress?: (progress: SearchProgress) => void
}

interface SearchProgress {
  type: 'query_update' | 'search_results_received'
  query?: string
  resultCount?: number
}
```

### Tool Input Schema

```typescript
{
  query: string              // search keywords, at least 2 characters
  allowed_domains?: string[] // domain allowlist
  blocked_domains?: string[] // domain blocklist
}
```

## 6. File Index

| File | Responsibility |
|------|----------------|
| `packages/builtin-tools/src/tools/WebSearchTool/WebSearchTool.ts` | Tool definition entry |
| `packages/builtin-tools/src/tools/WebSearchTool/prompt.ts` | Search tool prompt |
| `packages/builtin-tools/src/tools/WebSearchTool/UI.tsx` | Terminal UI rendering |
| `packages/builtin-tools/src/tools/WebSearchTool/adapters/types.ts` | Adapter interface |
| `packages/builtin-tools/src/tools/WebSearchTool/adapters/index.ts` | Adapter factory |
| `packages/builtin-tools/src/tools/WebSearchTool/adapters/apiAdapter.ts` | API server-side search adapter |
| `packages/builtin-tools/src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing HTML parsing adapter |
| `packages/builtin-tools/src/tools/WebSearchTool/__tests__/bingAdapter.test.ts` | Unit tests (32 cases) |
| `packages/builtin-tools/src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts` | Integration tests |
| `src/tools.ts` | Tool registration |
