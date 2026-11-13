/**
 * Optional type of the Logger's second argument.
 * Callers append details via util.format; in practice usually a caught exception object.
 */
export type LoggerDetail = Error | NodeJS.ErrnoException

/** Narrows unknown to LoggerDetail, for catch blocks to pass to the logger. */
export function toLoggerDetail(detail: unknown): LoggerDetail | undefined {
  return detail instanceof Error ? detail : undefined
}

/** Logger interface injected by the host, aligned with DebugLogger (util.format). */
export interface Logger {
  info: (message: string, detail?: LoggerDetail) => void // info
  error: (message: string, detail?: LoggerDetail) => void // error
  warn: (message: string, detail?: LoggerDetail) => void // warning
  debug: (message: string, detail?: LoggerDetail) => void // debug
  silly: (message: string, detail?: LoggerDetail) => void // finest-grained debug
}

/**
 * error_type enum for Bridge connection failures.
 * Reported by bridgeClient when getUserId / getOAuthToken / WebSocket creation fails.
 */
export type ChromeBridgeConnectionErrorType =
  | 'no_user_id' // unable to get the user UUID
  | 'no_oauth_token' // unable to get the OAuth token
  | 'websocket_error' // WebSocket WebSocket creation or runtime error

/** Telemetry metadata for tool calls (started / completed / timeout / error). */
export type ChromeBridgeToolCallMetadata = {
  tool_name: string // MCP MCP tool name
  tool_use_id: string // UUID of this call
  duration_ms?: number // elapsed time (milliseconds)
  timeout_ms?: number // timeout threshold (milliseconds), timeout events only
  error_message?: string // error summary (truncated), error events only
}

/** Telemetry metadata for Bridge connection failures. */
export type ChromeBridgeConnectionFailedMetadata = {
  duration_ms: number // time from connection start to failure (milliseconds)
  error_type: ChromeBridgeConnectionErrorType // failure reason category
  reconnect_attempt: number // current reconnect attempt number
}

/** Telemetry metadata for Bridge connection start. */
export type ChromeBridgeConnectionStartedMetadata = {
  bridge_url: string // target WebSocket URL (including the user path)
}

/** Telemetry metadata for Bridge disconnection. */
export type ChromeBridgeDisconnectedMetadata = {
  close_code: number // WebSocket WebSocket close code
  duration_since_connect_ms: number // duration from successful connection to disconnection (milliseconds)
  reconnect_attempt: number // upcoming reconnect attempt number
}

/** Telemetry metadata for a successful Bridge connection. */
export type ChromeBridgeConnectionSucceededMetadata = {
  duration_ms: number // time from start until the connection is ready (milliseconds)
  status: 'paired' | 'waiting' // paired=paired = extension paired; waiting = waiting for the extension to connect
}

/** Telemetry metadata for Bridge reconnect attempts exhausted. */
export type ChromeBridgeReconnectExhaustedMetadata = {
  total_attempts: number // cumulative reconnect attempt limit
}

/**
 * Union of metadata types for the trackEvent callback.
 * Each variant corresponds to a chrome_bridge_* event in bridgeClient; null means no extra fields.
 */
export type ChromeBridgeTrackEventMetadata =
  | ChromeBridgeToolCallMetadata
  | ChromeBridgeConnectionFailedMetadata
  | ChromeBridgeConnectionStartedMetadata
  | ChromeBridgeDisconnectedMetadata
  | ChromeBridgeConnectionSucceededMetadata
  | ChromeBridgeReconnectExhaustedMetadata
  | null // no metadata (e.g. peer_connected / peer_disconnected)

export type PermissionMode =
  | 'ask'
  | 'skip_all_permission_checks'
  | 'follow_a_plan'

export interface BridgeConfig {
  /** Bridge WebSocket base URL (e.g., wss://bridge.claudeusercontent.com) */
  url: string
  /** Returns the user's account UUID for the connection path */
  getUserId: () => Promise<string | undefined>
  /** Returns a valid OAuth token for bridge authentication */
  getOAuthToken: () => Promise<string | undefined>
  /** Optional dev user ID for local development (bypasses OAuth) */
  devUserId?: string
}

/** Metadata about a connected Chrome extension instance. */
export interface ChromeExtensionInfo {
  deviceId: string
  osPlatform?: string
  connectedAt: number
  name?: string
}

export interface ClaudeForChromeContext {
  serverName: string
  logger: Logger
  socketPath: string
  // Optional dynamic resolver for socket path. When provided, called on each
  // connection attempt to handle runtime conditions (e.g., TMPDIR mismatch).
  getSocketPath?: () => string
  // Optional resolver returning all available socket paths (for multi-profile support).
  // When provided, a socket pool connects to all sockets and routes by tab ID.
  getSocketPaths?: () => string[]
  clientTypeId: string // "desktop" | "claude-code"
  onToolCallDisconnected: () => string
  onAuthenticationError: () => void
  isDisabled?: () => boolean
  /** Bridge WebSocket configuration. When provided, uses bridge instead of socket. */
  bridgeConfig?: BridgeConfig
  /** If set, permission mode is sent to the extension immediately on bridge connection. */
  initialPermissionMode?: PermissionMode
  /** Bridge telemetry callback; eventName is a chrome_bridge_* event name */
  trackEvent?: (
    eventName: string, // event name
    metadata: ChromeBridgeTrackEventMetadata, // event metadata
  ) => void
  /** Called when user pairs with an extension via the browser pairing flow. */
  onExtensionPaired?: (deviceId: string, name: string) => void
  /** Returns the previously paired deviceId, if any. */
  getPersistedDeviceId?: () => string | undefined
  /** Called when a remote extension is auto-selected (only option available). */
  onRemoteExtensionWarning?: (ext: ChromeExtensionInfo) => void
}

/**
 * Map Node's process.platform to the platform string reported by Chrome extensions
 * via navigator.userAgentData.platform.
 */
export function localPlatformLabel(): string {
  return process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'win32'
      ? 'Windows'
      : 'Linux'
}

/** Permission request forwarded from the extension to the desktop for user approval. */
export interface BridgePermissionRequest {
  /** Links to the pending tool_call */
  toolUseId: string
  /** Unique ID for this permission request */
  requestId: string
  /** Tool type, e.g. "navigate", "click", "execute_javascript" */
  toolType: string
  /** The URL/domain context */
  url: string
  /** Additional action data (click coordinates, text, etc.) */
  actionData?: Record<string, unknown>
}

/** Desktop response to a bridge permission request. */
export interface BridgePermissionResponse {
  requestId: string
  allowed: boolean
}

/** Per-call permission overrides, allowing each session to use its own permission state. */
export interface PermissionOverrides {
  permissionMode: PermissionMode
  allowedDomains?: string[]
  /** Callback invoked when the extension requests user permission via the bridge. */
  onPermissionRequest?: (request: BridgePermissionRequest) => Promise<boolean>
}

/** Shared interface for McpSocketClient and McpSocketPool */
export interface SocketClient {
  ensureConnected(): Promise<boolean>
  callTool(
    name: string,
    args: Record<string, unknown>,
    permissionOverrides?: PermissionOverrides,
  ): Promise<unknown>
  isConnected(): boolean
  disconnect(): void
  setNotificationHandler(
    handler: (notification: {
      method: string
      params?: Record<string, unknown>
    }) => void,
  ): void
  /** Set permission mode for the current session. Only effective on BridgeClient. */
  setPermissionMode?(
    mode: PermissionMode,
    allowedDomains?: string[],
  ): Promise<void>
  /** Switch to a different browser. Only available on BridgeClient. */
  switchBrowser?(): Promise<
    | {
        deviceId: string
        name: string
      }
    | 'no_other_browsers'
    | null
  >
}
