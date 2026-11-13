/** Factory function type that assembles a callable host-side `Tool` instance from a tool definition. */
export type buildTool = typeof import('src/Tool.js').buildTool

/** Tool definition generic (input schema, permissions, progress, etc.); same as the host `ToolDef`. */
export type ToolDef = import('src/Tool.js').ToolDef

/** Check whether a tool's primary name or alias equals the query name; same as the host `toolMatchesName`. */
export type toolMatchesName = typeof import('src/Tool.js').toolMatchesName
