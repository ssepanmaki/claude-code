/** Conversation message union type (user/assistant/system, etc.); same as the re-export in the host `src/types/message.js`. */
export type Message = import('src/types/message.js').Message

/** Normalized user message shape; same as `NormalizedUserMessage` in the host `src/types/message.js`. */
export type NormalizedUserMessage =
  import('src/types/message.js').NormalizedUserMessage
