import type { z } from 'zod/v4'
import { LspServerConfigSchema } from '../../utils/plugins/schemas.js'

/** Single LSP server config in a plugin manifest / `.lsp.json` (derived from the Zod schema). */
export type LspServerConfig = z.infer<ReturnType<typeof LspServerConfigSchema>>

/**
 * Scope and source plugin name attached when a plugin registers dynamically.
 * Distinct from global user/project config, avoiding name collisions between plugins.
 */
export type ScopedLspServerConfig = LspServerConfig & {
  scope: 'dynamic' // scope marker mounted by a plugin at runtime
  source: string // source plugin name (used for the `plugin:name:server` prefix, etc.)
}

/** Lifecycle state of the LSP subprocess (maintained by `LSPServerInstance`). */
export type LspServerState =
  | 'stopped' // not started or fully exited
  | 'starting' // spawning the process / handshaking
  | 'running' // initialized and able to serve requests
  | 'stopping' // shutting down gracefully
  | 'error' // error state after a failed start or a runtime crash
