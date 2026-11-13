# TEAMMEM — team shared memory

> Feature Flag: `FEATURE_TEAMMEM=1`
> Implementation status: fully usable (requires Anthropic OAuth + a GitHub remote)
> References: 51

## 1. Overview

TEAMMEM implements a team shared memory system keyed to a GitHub repository. Files in the `memory/team/` directory are synced both ways with Anthropic's servers, so every authenticated member of the team can share project knowledge.

### Core features

- **Incremental sync**: only files whose content hash changed are uploaded (delta upload)
- **Conflict resolution**: ETag-based optimistic locking plus 412 conflict retry
- **Secret scanning**: files containing secrets are detected and skipped before upload (PSR M22174)
- **Path traversal protection**: every write path is validated to stay inside the `memory/team/` boundary
- **Batched upload**: PUT requests over 200KB are split automatically so the gateway does not reject them

## 2. User interaction

### Sync behavior

| Event | Behavior |
|------|------|
| Project start | Automatically pulls team memory into `memory/team/` |
| Local file edit | The watcher detects the change and pushes automatically |
| Server-side update | Overwrites local files on the next pull (server-wins) |
| Secret detected | Skips that file and logs a warning; other files still sync |

### API endpoints

```
GET  /api/claude_code/team_memory?repo={owner/repo}             → full data + entryChecksums
GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes → checksums only (used for conflict resolution)
PUT  /api/claude_code/team_memory?repo={owner/repo}             → upload entries (upsert semantics)
```

## 3. Implementation architecture

### 3.1 Sync state

```ts
type SyncState = {
  lastKnownChecksum: string | null    // ETag conditional request
  serverChecksums: Map<string, string> // sha256:<hex> per-file hashes
  serverMaxEntries: number | null      // server capacity learned from 413
}
```

### 3.2 Pull flow (Server → Local)

File: `src/services/teamMemorySync/index.ts:770-867`

```
pullTeamMemory(state)
      │
      ▼
Check OAuth + GitHub remote
      │
      ▼
fetchTeamMemory(state, repo, etag)
  ├── 304 Not Modified → return (no change)
  ├── 404 → return (no data on the server)
  └── 200 → parse TeamMemoryData
      │
      ▼
Refresh serverChecksums (per-key hashes)
      │
      ▼
writeRemoteEntriesToLocal(entries)
  ├── Path traversal validation (validateTeamMemKey)
  ├── File size check (skip if > 250KB)
  ├── Content comparison (skip the write if identical)
  └── Parallel writes (Promise.all)
```

### 3.3 Push flow (Local → Server)

File: `src/services/teamMemorySync/index.ts:889-1146`

```
pushTeamMemory(state)
      │
      ▼
readLocalTeamMemory(maxEntries)
  ├── Recursively scan the memory/team/ directory
  ├── Skip oversized files (> 250KB)
  ├── Secret scan (scanForSecrets, gitleaks rules)
  └── Truncate to serverMaxEntries (if known)
      │
      ▼
Compute delta = local files - serverChecksums
  (only files whose hash differs)
      │
      ▼
batchDeltaByBytes(delta)
  (split into batches of ≤200KB)
      │
      ▼
uploadTeamMemory(state, repo, batch, etag), batch by batch
  ├── 200 success → update serverChecksums
  ├── 412 conflict → fetchTeamMemoryHashes() refreshes checksums
  │                → recompute delta and retry (up to 2 times)
  └── 413 over capacity → learn serverMaxEntries
```

### 3.4 Secret scanning

File: `src/services/teamMemorySync/secretScanner.ts`

File contents are scanned with gitleaks rule patterns. When a secret is detected:
- The file is skipped (not uploaded)
- A `tengu_team_mem_secret_skipped` event is logged (rule ID only, never the value)
- Other files still sync

### 3.5 File watching

File: `src/services/teamMemorySync/watcher.ts`

Watches the `memory/team/` directory for changes and triggers an automatic push. Spurious changes caused by pull writes are suppressed.

### 3.6 Path safety

File: `src/memdir/teamMemPaths.ts`

- `validateTeamMemKey(relPath)` — verifies a relative path does not escape the `memory/team/` boundary
- `getTeamMemPath()` — returns the team memory root directory path

## 4. Key design decisions

1. **Server-wins on pull, local-wins on push**: on pull, server content overwrites local files; on push, local edits overwrite the server. A local user is actively editing, so their changes should not be silently dropped
2. **Delta upload**: only entries whose hash changed are uploaded, saving bandwidth. The first push is a full upload; later ones are incremental
3. **Batched PUT**: each PUT is ≤200KB so the API gateway (~256-512KB) does not reject it. Each batch is upserted independently, so a partial failure does not affect batches already committed
4. **Secret scanning before upload**: PSR M22174 requires that secrets never leave the machine. The scan runs in `readLocalTeamMemory`, so files with secrets never enter the upload set
5. **ETag optimistic locking**: push uses an `If-Match` header. On 412 it probes `?view=hashes` (fetching checksums only, not contents), refreshes, and retries
6. **Server capacity learned dynamically**: no client-side capacity limit is assumed; it is learned from `extra_details.max_entries` in the 413 response

## 5. Usage

```bash
# Enable the feature
FEATURE_TEAMMEM=1 bun run dev

# Prerequisites:
# 1. Logged in through Anthropic OAuth
# 2. The project has a GitHub remote (git remote -v shows origin)
# 3. The memory/team/ directory is created automatically
```

## 6. External dependencies

| Dependency | Notes |
|------|------|
| Anthropic OAuth | First-party authentication |
| GitHub Remote | `getGithubRepo()` provides `owner/repo` as the sync scope |
| Team Memory API | The `/api/claude_code/team_memory` endpoint |

## 7. File index

| File | Lines | Responsibility |
|------|------|------|
| `src/services/teamMemorySync/index.ts` | 1257 | Core sync logic (pull/push/sync) |
| `src/services/teamMemorySync/watcher.ts` | — | File watching + auto-sync trigger |
| `src/services/teamMemorySync/secretScanner.ts` | — | gitleaks secret scanning |
| `src/services/teamMemorySync/types.ts` | — | Zod schemas + type definitions |
| `src/services/teamMemorySync/teamMemSecretGuard.ts` | — | Secret guard helper |
| `src/memdir/teamMemPaths.ts` | — | Path validation + directory management |
