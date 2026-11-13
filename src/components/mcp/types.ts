import type {
  ConfigScope,
  MCPServerConnection,
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'

/** Base fields shared by server rows in the `/mcp` list and menus. */
type ServerInfoBase = {
  name: string // normalized MCP server name
  client: MCPServerConnection // connection state and config carrier
  scope: ConfigScope // config source scope
}

/** Display form of stdio MCP servers in `/mcp` and the plugin management UI. */
export type StdioServerInfo = ServerInfoBase & {
  transport: 'stdio' // stdio subprocess
  config: McpStdioServerConfig // stdio launch parameters
}

/** SSE MCP server (including OAuth session state). */
export type SSEServerInfo = ServerInfoBase & {
  transport: 'sse' // server-sent events stream
  isAuthenticated: boolean | undefined // whether OAuth/session is ready (undefined when unknown)
  config: McpSSEServerConfig // SSE URL, headers, etc.
}

/** Streamable HTTP MCP server. */
export type HTTPServerInfo = ServerInfoBase & {
  transport: 'http' // remote over HTTP streaming or polling
  isAuthenticated: boolean | undefined // whether remote auth has completed
  config: McpHTTPServerConfig // HTTP endpoint config
}

/** Claude.ai proxy-type MCP endpoint. */
export type ClaudeAIServerInfo = ServerInfoBase & {
  transport: 'claudeai-proxy' // via the Claude.ai proxy channel
  isAuthenticated: boolean | undefined // for displaying proxy-side auth
  config: McpClaudeAIProxyServerConfig // proxy id/url, etc.
}

/** Discriminated union for connected MCP servers not declared by agents, as shown in the UI. */
export type ServerInfo =
  | StdioServerInfo
  | SSEServerInfo
  | HTTPServerInfo
  | ClaudeAIServerInfo

/**
 * MCP declarations extracted from Agent frontmatter, used for the `/mcp` "Agents" group.
 * Fields appear optionally by transport so menus can read them uniformly.
 */
export type AgentMcpServerInfo = {
  name: string // server name declared inside the agent
  sourceAgents: string[] // list of agentTypes that reference this declaration
  transport: 'stdio' | 'sse' | 'http' | 'ws' // transport category
  command?: string // stdio: launch command
  url?: string // remote: base URL
  needsAuth: boolean // whether OAuth/token is required
  /** OAuth state shown in the UI for remote transports (usually unknown for agent-declared paths). */
  isAuthenticated?: boolean // for UI display; optional
}

/** View state machine of the `/mcp` settings panel. */
export type MCPViewState =
  | { type: 'list'; defaultTab?: string } // server/Agents list; optional default tab
  | { type: 'server-menu'; server: ServerInfo } // action menu after selecting a server
  | { type: 'server-tools'; server: ServerInfo } // tool list of this server
  | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number } // details of a single tool
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo } // MCP menu for an agent-declared server
