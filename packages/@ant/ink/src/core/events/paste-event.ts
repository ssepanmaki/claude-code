/** Shape of the paste event received by `onPaste` / `onPasteCapture` on Box and similar components (a placeholder convention aligned with the bracketed-paste parse result). */
export type PasteEvent = {
  pastedText: string // UTF-8 text parsed in terminal bracketed-paste mode; may be an empty string to represent an empty paste
}
