/** Simple option used by CustomSelect, permission rule lists, etc. */
export type Option = {
  label: string // text shown to the user
  value: string // internal value returned on selection (e.g. rule key, placeholder)
}
