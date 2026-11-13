/** Strips sandbox-violation marker tags from display text to avoid UI noise; same as the host `removeSandboxViolationTags`. */
export type removeSandboxViolationTags =
  typeof import('src/utils/sandbox/sandbox-ui-utils.js').removeSandboxViolationTags
