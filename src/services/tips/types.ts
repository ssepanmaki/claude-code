import type { ThemeName } from '@anthropic/ink'
import type { FileStateCache } from '../../utils/fileStateCache.js'

/** Session context available when evaluating Spinner tips (fields may be provided partially depending on the call site). */
export type TipContext = {
  theme?: ThemeName // name of the current terminal theme, used for coloring such as `color()`
  readFileState?: FileStateCache // LRU of recently read files, used for file-related relevance checks
  bashTools?: Set<string> // set of bash subcommands seen in this session
}

/** Built-in or user-defined Spinner tip entry. */
export type Tip = {
  id: string // stable id: used for cooldown and history dedup
  content: (ctx?: TipContext) => Promise<string> // asynchronously generates the tip text shown next to the Spinner
  cooldownSessions: number // minimum number of sessions before it may be shown again
  isRelevant?: (ctx?: TipContext) => Promise<boolean> // optional: whether this entry should currently be shown
}
