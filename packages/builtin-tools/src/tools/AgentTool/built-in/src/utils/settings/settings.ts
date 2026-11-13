import type { SettingsJson } from 'src/utils/settings/types.js'

/** Returns the merged snapshot of all settings sources (deprecated function name, same behavior as `getInitialSettings`); same as `src/utils/settings/settings.ts`. */
export type getSettings_DEPRECATED = () => SettingsJson // no arguments; yields at least a merged settings object with nullable fields filled in
