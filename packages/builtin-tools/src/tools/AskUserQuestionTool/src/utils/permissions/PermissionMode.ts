/** Maps a permission mode to an Ink theme color key, for UI such as the status line; same as the host `getModeColor`. */
export type getModeColor =
  typeof import('src/utils/permissions/PermissionMode.js').getModeColor
