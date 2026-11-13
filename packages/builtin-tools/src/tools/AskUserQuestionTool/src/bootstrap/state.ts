/** Returns the list of channels currently allowed to be shown (name, connection state, etc.); same as `getAllowedChannels` in the host `src/bootstrap/state.js`. */
export type getAllowedChannels =
  typeof import('src/bootstrap/state.js').getAllowedChannels

/** Returns the question preview render format (Markdown/HTML) or unconfigured; same as the host `getQuestionPreviewFormat`. */
export type getQuestionPreviewFormat =
  typeof import('src/bootstrap/state.js').getQuestionPreviewFormat
