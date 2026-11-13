/** Interaction phase of the side-channel indicator for the main loop / streaming output. */
export type SpinnerMode =
  | 'tool-input' // waiting for the user to respond to a tool input
  | 'tool-use' // tool executing
  | 'responding' // model is streaming a reply
  | 'thinking' // model thinking/planning (provider details not distinguished)
  | 'requesting' // request sent, waiting for the first chunk (faster shimmer cadence)

/** Terminal 24-bit color (consistent with Ink `RGBColor` and the gradient interpolation helpers). */
export type RGBColor = {
  r: number // red 0–255
  g: number // green 0–255
  b: number // blue 0–255
}
