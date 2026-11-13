import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

/** Common interface of session upstream transports such as WebSocket / SSE+POST / Hybrid. */
export type Transport = {
  setOnData(callback: (data: string) => void): void // register the downstream data callback (line-based text)
  setOnClose(callback: (closeCode?: number) => void): void // callback on connection close (with an optional close code)
  connect(): void | Promise<void> // establish or re-establish the transport
  write(message: StdoutMessage): void | Promise<void> // send one control/streaming message upstream
  close(): void // actively close and release resources
}
