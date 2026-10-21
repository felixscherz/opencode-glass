import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { Capture } from "./capture.ts"
import { renderMarkdown } from "./render.ts"

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
 * Lays out captures as `<directory>/<sessionID>/<time>-<seq>-<kind>-<direction>.{json,md}`. A request and its
 * response share one exchange prefix, and prefixes sort in send order.
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
      await mkdir(path.dirname(exchange), { recursive: true })
      const base = `${exchange}-${capture.direction}`
      await Promise.all([
        writeFile(`${base}.json`, JSON.stringify(capture, null, 2)),
        writeFile(`${base}.md`, renderMarkdown(capture)),
      ])
    },

    /** WebSocket replies arrive frame by frame, so they are appended as JSON lines instead of written once. */
    async appendFrame(exchange: string, frame: { readonly receivedAt: string; readonly frame: unknown }): Promise<void> {
      await mkdir(path.dirname(exchange), { recursive: true })
      await appendFile(`${exchange}-response.jsonl`, `${JSON.stringify(frame)}\n`)
    },
  }
}

function safeName(value: string): string {
  return value.replace(/[^\w.-]/g, "_")
}
