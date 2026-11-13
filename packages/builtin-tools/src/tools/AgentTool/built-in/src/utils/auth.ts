/** Whether a third-party (not direct Anthropic) API or service is in use; same signature as `isUsing3PServices` in the repo-root `src/utils/auth.ts`. */
export type isUsing3PServices = () => boolean // true means the current config goes through a compatibility layer or a third-party model endpoint
