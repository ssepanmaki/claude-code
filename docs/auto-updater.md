# Auto-Update Mechanism

## Overview

Claude Code has a multi-strategy auto-update system. It supports three install types, silent background updates, a manual CLI command, server-side version gating, and release-notes display. The system aims to keep the CLI current with minimal user intervention, while still offering rollback and manual control as fallbacks.

---

## Install types and update strategies

The update strategy is determined by the install type, detected in `src/utils/doctorDiagnostic.ts`:

| Install type | Update strategy | Auto-install? |
|---|---|---|
| `native` | Downloads a binary from GCS/Artifactory and activates it through a symlink | Yes (silent) |
| `npm-global` | `npm install -g` / `bun install -g` | Yes (silent) |
| `npm-local` | `npm install` into `~/.claude/local/` | Yes (silent) |
| `package-manager` | Shows a notice with the upgrade command for the operating system | No (notice only) |
| `development` | Not applicable: `claude update` reports an error | N/A |

### Strategy routing

`src/components/AutoUpdaterWrapper.tsx`, mounted in the React/Ink UI tree, detects the install type and renders the matching update component:

- `native` → `NativeAutoUpdater` (binary download + symlink)
- `package-manager` → `PackageManagerAutoUpdater` (notice only)
- anything else → `AutoUpdater` (JS/npm based)

---

## Background auto-update loop

The three update components share the same polling pattern:

```typescript
useInterval(checkForUpdates, 30 * 60 * 1000); // every 30 minutes
```

A check also runs once when the component mounts (that is, at startup).

### Pre-check gates

Before any update attempt, the system checks the following in order:

1. **Is auto-update disabled?** `getAutoUpdaterDisabledReason()` (`src/utils/config.ts:1737`)
   - `NODE_ENV === 'development'`
   - the `DISABLE_AUTOUPDATER` environment variable is set
   - essential-traffic-only mode
   - `config.autoUpdates === false` (except for the protected mode of native installs)
2. **Maximum version cap?** `getMaxVersion()` (`src/utils/autoUpdater.ts:108`) is a server-side kill switch that prevents updating to a known-bad version.
3. **Skip this version?** `shouldSkipVersion()` (`src/utils/autoUpdater.ts:145`) honors the user's `minimumVersion` setting, preventing an accidental downgrade when switching to the stable channel.

### Native auto-updater (`src/components/NativeAutoUpdater.tsx`)

1. Calls `installLatest()` in `src/utils/nativeInstaller/installer.ts`.
2. Downloads the binary through `src/utils/nativeInstaller/download.ts` (GCS or Artifactory).
3. Verifies the SHA256 checksum (3 retries, 60-second stall detection).
4. Stores the versioned binary in the XDG directory.
5. Updates the symlink (`~/.local/bin/claude` → the new version's binary).
6. Keeps the 2 most recent versions and cleans up older ones.
7. Classifies errors for analytics (timeout, checksum, permission, out of disk space, npm, network).

### JS/npm auto-updater (`src/components/AutoUpdater.tsx`)

1. Calls `getLatestVersion()` to get the current npm dist-tag.
2. Compares versions with semver `gte()`.
3. Routes to a local or global install depending on the install type.
4. Uses a file lock (`acquireLock()` / `releaseLock()`) to prevent concurrent updates.

### Package-manager notifier (`src/components/PackageManagerAutoUpdater.tsx`)

Checks for updates every 30 minutes through a GCS bucket (not npm). It **does not install automatically**. It only shows the upgrade command for the operating system:

- macOS: `brew upgrade claude-code`
- Windows: `winget upgrade Anthropic.ClaudeCode`
- Alpine: `apk upgrade claude-code`

---

## Startup version gating

`src/utils/autoUpdater.ts:70`: `assertMinVersion()`

Defined at `src/utils/autoUpdater.ts:70` and designed to be called at startup (it is not currently wired into the startup flow):

```typescript
void assertMinVersion();
```

1. Fetches `tengu_version_config` from GrowthBook dynamic config.
2. If `MACRO.VERSION < minVersion`, prints an error message and calls `gracefulShutdownSync(1)`, forcing the user to update.
3. This is a **hard gate**: a CLI below the minimum version cannot start.

---

## Manual CLI commands

### `claude update` / `claude upgrade`

**File**: `src/cli/update.ts`

Full flow:
1. Runs `getDoctorDiagnostic()` to check system health.
2. Checks for multiple installations and configuration inconsistencies.
3. Routes by install type:
   - `development` → error ("development builds do not support auto-update")
   - `package-manager` → prints the update command for the operating system
   - `native` → uses the native installer's `updateLatest()`
   - `npm-local` → runs `npm install` in `~/.claude/local/`
   - `npm-global` → runs `npm install -g` (with a permission check)
4. Reports the current version, the latest version, and success/failure status.

### `claude rollback [target]` (internal only)

Rolls back to a previous version. Supports the `--list`, `--dry-run`, and `--safe` flags.

### `claude install [target]`

Installs or reinstalls the native build. Accepts an optional version target argument.

### `claude doctor`

Checks the health of the auto-updater and reports status, permissions, and configuration.

---

## Native installer architecture

**File**: `src/utils/nativeInstaller/installer.ts`

### Binary storage layout

```
~/.local/share/claude-code/
├── versions/          # versioned binaries (claude-1.0.3, claude-1.0.4, ...)
├── staging/           # temporary download staging area
└── locks/             # lock files based on PID and mtime

~/.local/bin/claude    # symlink to the current version's binary
```

Windows uses file copies instead of symlinks.

### Core operations

| Function | Description |
|---|---|
| `updateLatest()` | Core update flow: max version cap → skip check → lock → download → install → update symlink |
| `installLatest()` | Singleflight wrapper that prevents duplicate in-flight installs |
| `cleanupOldVersions()` | Keeps the 2 most recent versions and removes stale staging and temp files |
| `lockCurrentVersion()` | Process-lifetime lock that keeps the running version from being deleted |
| `cleanupNpmInstallations()` | Removes the old npm install when migrating to a native install |

### Download and verification

**File**: `src/utils/nativeInstaller/download.ts`

1. Routes to Artifactory (internal users) or a GCS bucket (external users).
2. Downloads the binary while tracking progress.
3. Verifies the SHA256 checksum.
4. Detects stalls for 60 seconds (aborts a stalled download).
5. Retries automatically 3 times on failure.

---

## File lock mechanism

**File**: `src/utils/autoUpdater.ts:176-268`

Prevents concurrent update processes from corrupting the installation:

- Lock file: `~/.claude/update.lock` (or an equivalent path)
- 5-minute timeout: a lock older than 5 minutes is treated as stale and forcibly acquired
- The process writes its PID into the lock file
- `acquireLock()` and `releaseLock()` are used by both the JS/npm and native installers

---

## Configuration

### Settings

**File**: `src/utils/settings/types.ts`

| Setting | Type | Description |
|---|---|---|
| `autoUpdatesChannel` | `'latest' \| 'stable'` | Release channel for auto-updates |
| `minimumVersion` | string | Minimum version requirement, preventing accidental downgrades |

### Global config

**File**: `src/utils/config.ts:191-193`

| Field | Type | Description |
|---|---|---|
| `autoUpdates` | boolean | Enable/disable auto-update (legacy) |
| `autoUpdatesProtectedForNative` | boolean | Native installs always auto-update |

### Config migration

**File**: `src/migrations/migrateAutoUpdatesToSettings.ts`

A one-time migration of the legacy `globalConfig.autoUpdates = false` to the `DISABLE_AUTOUPDATER=1` environment variable in settings. Defined in `src/migrations/migrateAutoUpdatesToSettings.ts` (not currently wired into the startup flow).

---

## Update notification dedup

**File**: `src/hooks/useUpdateNotification.ts`

The React hook `useUpdateNotification(updatedVersion)` ensures the "restart to update" message is shown only once per semver change (major.minor.patch), avoiding repeated notifications for the same version.

---

## Release notes

**File**: `src/utils/releaseNotes.ts`

1. Called on every startup from `src/setup.ts:387`.
2. Fetches the changelog from GitHub.
3. Caches it at `~/.claude/cache/changelog.md`.
4. Shows the changelog for versions newer than `lastReleaseNotesSeen`.
5. Uses semver comparison to decide which entries to show.

---

## Version comparison

**File**: `src/utils/semver.ts`

- Provides `gt()`, `gte()`, `lt()`, `lte()`, `satisfies()`, and `order()`.
- Uses `Bun.semver.order()` under Bun (20x faster).
- Falls back to the npm `semver` package under Node.js.

---

## Analytics events

All update-related telemetry uses events with the `tengu_` prefix:

| Category | Events |
|---|---|
| Version check | `tengu_version_check_success`, `tengu_version_check_failure` |
| JS auto-updater | `tengu_auto_updater_start/success/fail/up_to_date/lock_contention` |
| Native auto-updater | `tengu_native_auto_updater_start/success/fail` |
| Native update | `tengu_native_update_complete/skipped_max_version/skipped_minimum_version` |
| Locking | `tengu_version_lock_acquired/failed`, `tengu_native_update_lock_failed` |
| Binary download | `tengu_binary_download_attempt/success/failure`, `tengu_binary_manifest_fetch_failure` |
| Cleanup | `tengu_native_version_cleanup`, `tengu_native_staging_cleanup`, `tengu_native_stale_locks_cleanup` |
| Install | `tengu_native_install_package_success/failure`, `tengu_native_install_binary_success/failure` |
| Manual update | `tengu_update_check` |
| Migration | `tengu_migrate_autoupdates_to_settings`, `tengu_migrate_autoupdates_error` |

---

## Key file index

| File | Responsibility |
|---|---|
| `src/utils/autoUpdater.ts` | Core logic: version checks, npm install, file lock, min/max version gating |
| `src/cli/update.ts` | `claude update` command handler |
| `src/utils/nativeInstaller/installer.ts` | Native binary installer: download, version management, symlink, cleanup |
| `src/utils/nativeInstaller/download.ts` | Downloads binaries from GCS/Artifactory and verifies them |
| `src/utils/localInstaller.ts` | Local installer (`~/.claude/local/`), npm based |
| `src/components/AutoUpdaterWrapper.tsx` | Strategy routing by install type |
| `src/components/AutoUpdater.tsx` | JS/npm background auto-updater (30-minute interval) |
| `src/components/NativeAutoUpdater.tsx` | Native binary background auto-updater (30-minute interval) |
| `src/components/PackageManagerAutoUpdater.tsx` | Package-manager notice (30 minutes, display only) |
| `src/hooks/useUpdateNotification.ts` | Per-semver update notification dedup |
| `src/utils/releaseNotes.ts` | Changelog fetching, caching, and display |
| `src/utils/semver.ts` | Semver comparison (Bun native + npm fallback) |
| `src/utils/doctorDiagnostic.ts` | Install type detection and health diagnostics |
| `src/utils/config.ts:1737` | `getAutoUpdaterDisabledReason()`: the disable-check logic |
| `src/migrations/migrateAutoUpdatesToSettings.ts` | Legacy config migration |
| `src/screens/Doctor.tsx` | Doctor command UI showing auto-update status |

---

## Flow diagram

```
Startup
  ├── assertMinVersion() → hard block when the version is too old; refuses to start
  ├── migrateAutoUpdatesToSettings() → one-time config migration
  └── checkForReleaseNotes() → show the changelog for new versions

While the REPL runs (every 30 minutes)
  ├── AutoUpdaterWrapper detects the install type
  │
  ├── native → NativeAutoUpdater
  │     ├── fetch the version from GCS/Artifactory
  │     ├── check the max version cap (server-controlled)
  │     ├── check the minimumVersion setting (skip)
  │     ├── acquireLock()
  │     ├── downloadAndVerifyBinary() (SHA256 check, 3 retries)
  │     ├── install into the versions/ directory
  │     ├── update the symlink
  │     └── cleanupOldVersions() (keep 2 versions)
  │
  ├── npm-global/local → AutoUpdater
  │     ├── fetch the latest version from the npm registry
  │     ├── semver version comparison
  │     ├── acquireLock()
  │     └── npm install -g / local install
  │
  └── package-manager → PackageManagerAutoUpdater
        ├── fetch the version from GCS
        └── show "Run: brew upgrade ..." (no auto-install)

Manual
  └── claude update → full diagnostics + install orchestration
```
