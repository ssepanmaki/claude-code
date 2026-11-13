/** State of the virtual terminal cursor in a rendered frame (column/row coordinates and whether it is drawn), used by diff and the cursor preamble. */
export type Cursor = {
  x: number // column of the cursor, counted from 0
  y: number // row of the cursor, counted from 0
  visible: boolean // whether the cursor should be drawn in the terminal this frame (no cursor-move sequence is emitted when hidden)
}
