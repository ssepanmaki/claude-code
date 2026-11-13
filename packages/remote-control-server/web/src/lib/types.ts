// =============================================================================
// Unified Chat Data Model — shared between ACP and RCS chat interfaces
// =============================================================================

import type { ToolCallContent, PermissionOption, PlanEntry } from '../acp/types'

// Tool call status
export type ToolCallStatus =
  | 'running'
  | 'complete'
  | 'error'
  | 'waiting_for_confirmation'
  | 'rejected'
  | 'canceled'

// Tool call data
export interface ToolCallData {
  id: string
  title: string
  status: ToolCallStatus
  content?: ToolCallContent[]
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  // Permission request (only when status === "waiting_for_confirmation")
  permissionRequest?: {
    requestId: string
    options: PermissionOption[]
  }
  // Standalone permission request (created when there is no matching tool call)
  isStandalonePermission?: boolean
}

// Assistant message block — a normal message or a thinking process
export type AssistantChunk =
  | { type: 'message'; text: string }
  | { type: 'thought'; text: string }

// Image in a user message
export interface UserMessageImage {
  mimeType: string
  data: string // base64 encoded
}

// User message entry
export interface UserMessageEntry {
  type: 'user_message'
  id: string
  content: string
  images?: UserMessageImage[]
}

// Assistant message entry
export interface AssistantMessageEntry {
  type: 'assistant_message'
  id: string
  chunks: AssistantChunk[]
}

// Tool call entry
export interface ToolCallEntry {
  type: 'tool_call'
  toolCall: ToolCallData
}

// Plan display entry (Agent execution plan)
export interface PlanDisplayEntry {
  type: 'plan'
  id: string
  entries: PlanEntry[]
}

// Unified chat entry type
export type ThreadEntry =
  | UserMessageEntry
  | AssistantMessageEntry
  | ToolCallEntry
  | PlanDisplayEntry

// =============================================================================
// Chat component props types
// =============================================================================

// Message submitted from ChatInput
export interface ChatInputMessage {
  text: string
  images?: UserMessageImage[]
}

// Permission request entry (for PermissionPanel)
export interface PendingPermission {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  description?: string
  options?: PermissionOption[]
}

// Session list entry (for SessionSidebar)
export interface SessionListItem {
  id: string
  title?: string | null
  updatedAt?: string | null
  isActive?: boolean
}
