/** Returns the original working directory at process start (unaffected by mid-session workspace switches); same as the host `getOriginalCwd`. */
export type getOriginalCwd =
  typeof import('src/bootstrap/state.js').getOriginalCwd
