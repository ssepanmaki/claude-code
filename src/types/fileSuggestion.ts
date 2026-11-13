/**
 * JSON payload received on stdin by the `FileSuggestion` custom command.
 * Fields match `createBaseHookInput()` plus the current path prefix `query`.
 */
export type FileSuggestionCommandInput = {
  session_id: string // current session id
  transcript_path: string // path to the session transcript file
  cwd: string // working directory
  permission_mode?: string // permission mode snapshot (if any)
  agent_id?: string // subagent id (if triggered inside an agent)
  agent_type?: string // subagent type or main-thread type
  query: string // path prefix the user is currently typing (the part to complete)
}
