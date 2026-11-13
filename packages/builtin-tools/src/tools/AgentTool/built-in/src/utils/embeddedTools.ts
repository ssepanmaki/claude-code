/** Whether this build embeds Glob/Grep into other tools instead of registering them separately; same as `hasEmbeddedSearchTools` in the repo-root `src/utils/embeddedTools.ts`. */
export type hasEmbeddedSearchTools = () => boolean // when true the tool list contains no standalone Glob/Grep tool names
