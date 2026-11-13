/** Checks whether a path falls inside the merged working directories allowed for the current tool; same as the host `pathInAllowedWorkingPath`. */
export type pathInAllowedWorkingPath =
  typeof import('src/utils/permissions/filesystem.js').pathInAllowedWorkingPath
