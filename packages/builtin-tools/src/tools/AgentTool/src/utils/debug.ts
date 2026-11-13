/** Write to the debug log file (subject to log level and filter rules); same as `logForDebugging` in the host `src/utils/debug.js`. */
export type logForDebugging =
  typeof import('src/utils/debug.js').logForDebugging
