/** Resolve the `QuerySource` used for telemetry or classification by built-in/custom Agent type; same as the host `getQuerySourceForAgent`. */
export type getQuerySourceForAgent =
  typeof import('src/utils/promptCategory.js').getQuerySourceForAgent
