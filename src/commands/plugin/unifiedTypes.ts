import type {
  ConfigScope,
  MCPServerConnection,
} from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'

import type { PersistablePluginScope } from '../../utils/plugins/pluginIdentifier.js'

/** List item scope: `builtin` (which includes MCP) and `flagged` for delisted plugins. */
export type UnifiedInstalledScope = ConfigScope | 'builtin' | 'flagged'

/** Connection state summary of MCP connection rows in the plugin management list. */
export type McpRowStatus =
  | 'connected' // connected and usable
  | 'disabled' // disabled by the user or policy
  | 'pending' // connecting or reconnecting
  | 'needs-auth' // needs authentication such as OAuth
  | 'failed' // connection or handshake failed

/**
 * One row in the unified "installed" list: a plugin, failed placeholder, delisted marker, or MCP server.
 * The same data source used for pagination and keyboard navigation.
 */
export type UnifiedInstalledItem =
  | {
      type: 'plugin' // normally loaded plugin
      id: string // `name@marketplace` unique key `name@marketplace`
      name: string // short plugin name
      description: string | undefined // manifest manifest description
      marketplace: string // owning marketplace
      scope: PersistablePluginScope | 'builtin' // install/display scope (builtin is marked separately)
      isEnabled: boolean // whether enabled in merged settings
      errorCount: number // number of errors associated with this plugin
      errors: PluginError[] // structured error list
      plugin: LoadedPlugin // parsed manifest, paths, etc.
      pendingEnable?: boolean // UIUI: waiting for enable to complete
      pendingUpdate?: boolean // UIUI: waiting for update to complete
      pendingToggle?: 'will-enable' | 'will-disable' // enable toggle chosen by the user but not yet persisted
    }
  | {
      type: 'failed-plugin' // placeholder row for a plugin that failed to load
      id: string // id aligned with the error source
      name: string // display name
      marketplace: string // inferred, or unknown
      scope: UnifiedInstalledScope // inferred install scope
      errorCount: number
      errors: PluginError[]
    }
  | {
      type: 'flagged-plugin' // plugin delisted from the marketplace but still present in settings
      id: string
      name: string
      marketplace: string
      scope: 'flagged' // fixed to the delisted group
      reason: string // delisting reason code (e.g. delisted)
      text: string // user-facing explanatory text
      flaggedAt: string // time flagged (ISO, etc.)
    }
  | {
      type: 'mcp' // standalone MCP or plugin sub-MCP row
      id: string // stable list id (e.g. mcp:name)
      name: string // display name (for a sub-MCP, may be the server segment)
      description: string | undefined // optional subtitle
      scope: UnifiedInstalledScope // derived from the server config or parent plugin
      status: McpRowStatus // connection state summary
      client: MCPServerConnection // underlying connection object (for detail/tool views)
      indented?: boolean // true true means a sub-MCP nested under a plugin
    }
