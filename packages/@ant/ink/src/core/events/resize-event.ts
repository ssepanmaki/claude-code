/** Event payload received by the `onResize` callback when the terminal size changes (consistent with `stdout.columns` / `stdout.rows`). */
export type ResizeEvent = {
  columns: number // current terminal column count (width)
  rows: number // current terminal row count (height)
}
