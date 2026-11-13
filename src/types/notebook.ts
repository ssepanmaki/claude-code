/** Jupyter / nbformat cell type. */
export type NotebookCellType =
  | 'code' // executable code cell
  | 'markdown' // documentation cell
  | 'raw' // raw text cell

/** Streaming output cell in a raw notebook. */
export type NotebookStreamCellOutput = {
  output_type: 'stream' // stdout/stderr stream
  text?: string | string[] // stream chunk; may be several concatenated parts
}

/** data payload of execute_result / display_data (common keys only). */
export type NotebookDisplayData = Record<string, unknown> & {
  'text/plain'?: string | string[] // plain-text fallback representation
}

/** Execution result or display output in a raw notebook. */
export type NotebookRichCellOutput = {
  output_type: 'execute_result' | 'display_data' // execution result or rich display
  data?: NotebookDisplayData // MIME bundle (including image/png etc.)
}

/** Error output in a raw notebook. */
export type NotebookErrorCellOutput = {
  output_type: 'error' // kernel error
  ename: string // exception type name
  evalue: string // exception message
  traceback: string[] // traceback lines
}

/** Union of raw cell outputs (parsed from ipynb). */
export type NotebookCellOutput =
  | NotebookStreamCellOutput
  | NotebookRichCellOutput
  | NotebookErrorCellOutput

/** Notebook cell before parsing (nbformat subset). */
export type NotebookCell = {
  id?: string // cell id (common in nbformat >= 4.5)
  cell_type: NotebookCellType // cell type
  source: string | string[] // cell source
  execution_count?: number | null // execution count of a code cell
  outputs?: NotebookCellOutput[] // output list of a code cell
  metadata?: Record<string, unknown> // extra metadata (written by the edit tool)
}

/** Language-related subset of the notebook's top-level metadata. */
export type NotebookMetadata = {
  language_info?: {
    name?: string // default kernel language name (e.g. python)
  }
}

/** On-disk `.ipynb` root structure (used for reading and incremental edits). */
export type NotebookContent = {
  nbformat?: number // major version (defaults to 4 when absent)
  nbformat_minor?: number // minor version (affects id strategy, etc.)
  cells: NotebookCell[] // cell sequence
  metadata: NotebookMetadata // document-level metadata
}

/** Normalized inline image payload (fed to the model image block). */
export type NotebookOutputImage = {
  image_data: string // base64 with no whitespace
  media_type: 'image/png' | 'image/jpeg' // MIME subtype
}

/** Streaming output normalized by `processOutput` (for tool messages). */
export type NotebookCellSourceStreamOutput = {
  output_type: 'stream'
  text: string // text after truncation/concatenation
}

/** Rich output normalized by `processOutput`. */
export type NotebookCellSourceRichOutput = {
  output_type: 'execute_result' | 'display_data'
  text?: string // body text extracted from text/plain
  image?: NotebookOutputImage // present if there is an image/png or jpeg
}

/** Error output normalized by `processOutput`. */
export type NotebookCellSourceErrorOutput = {
  output_type: 'error'
  text: string // single text merged from ename/evalue/traceback
}

/** Union of cell outputs before entering the tool chain. */
export type NotebookCellSourceOutput =
  | NotebookCellSourceStreamOutput
  | NotebookCellSourceRichOutput
  | NotebookCellSourceErrorOutput

/** Cell summary structure fed to the model as a tool result. */
export type NotebookCellSource = {
  cellType: NotebookCellType // type aligned with the source cell
  source: string // concatenated cell source string
  execution_count?: number // execution count kept for code cells
  cell_id: string // stable cell id (generated as cell-{index} if absent)
  language?: string // code cell language id (annotated when not python)
  outputs?: NotebookCellSourceOutput[] // normalized output list
}
