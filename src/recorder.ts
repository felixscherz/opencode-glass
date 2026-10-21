import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { Capture } from "./capture.ts"
import { renderMarkdown } from "./render.ts"

/** The session subfolder that holds captures exactly as recorded, beside the Markdown rendered from them. */
const RAW = "raw"

export function defaultDirectory(): string {
  const data = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  return path.join(data, "opencode-glass")
}

/** Both the server and TUI plugin read the same `directory` option. */
export function captureDirectory(options: Readonly<Record<string, unknown>>): string {
  return typeof options.directory === "string" ? options.directory : defaultDirectory()
}

export function sessionFolder(directory: string, sessionID: string): string {
  return path.join(directory, safeName(sessionID))
}

/**
 * Lays out captures as `<directory>/<sessionID>/<time>-<seq>-<kind>-<direction>.md` for reading, with the capture as
 * recorded in `raw/` under the same name. A request and its response share one exchange prefix, and prefixes sort in
 * send order.
 */
export function createRecorder(directory: string) {
  let sequence = 0

  return {
    /** Reserves the file prefix for one request and its response. */
    exchange(sessionID: string, kind: string, at: Date): string {
      sequence += 1
      const stamp = at.toISOString().replace(/[:.]/g, "-")
      return path.join(sessionFolder(directory, sessionID), `${stamp}-${String(sequence).padStart(4, "0")}-${safeName(kind)}`)
    },

    async write(exchange: string, capture: Capture): Promise<void> {
      const name = `${path.basename(exchange)}-${capture.direction}`
      const raw = `${RAW}/${name}.json`
      await mkdir(path.join(path.dirname(exchange), RAW), { recursive: true })
      await Promise.all([
        writeFile(path.join(path.dirname(exchange), raw), JSON.stringify(capture, null, 2)),
        writeFile(`${exchange}-${capture.direction}.md`, renderMarkdown(capture, raw)),
      ])
    },

    /** WebSocket replies arrive frame by frame, so they are appended as JSON lines instead of written once. */
    async appendFrame(exchange: string, frame: { readonly receivedAt: string; readonly frame: unknown }): Promise<void> {
      const folder = path.join(path.dirname(exchange), RAW)
      await mkdir(folder, { recursive: true })
      await appendFile(path.join(folder, `${path.basename(exchange)}-response.jsonl`), `${JSON.stringify(frame)}\n`)
    },
  }
}

function safeName(value: string): string {
  return value.replace(/[^\w.-]/g, "_")
}
