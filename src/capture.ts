/** One payload exchanged with a model provider, exactly as it went over the wire. */
export interface Capture {
  readonly capturedAt: string
  readonly sessionID: string
  readonly agent: string
  readonly model: unknown
  /** Why OpenCode made the request: the agent loop, compaction, title generation, ... */
  readonly kind: string
  readonly direction: "request" | "response"
  readonly transport: "http" | "websocket"
  readonly method?: string
  readonly url?: string
  readonly status?: number
  readonly headers?: Record<string, string>
  /** Parsed JSON when the payload is JSON, the raw text otherwise (e.g. a server-sent event stream). */
  readonly body: unknown
  /** Set when the body could not be read to the end; `body` then holds what arrived before the failure. */
  readonly error?: string
}

export function parseBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Reads a body to the end, keeping what arrived if the stream fails part way, e.g. when the user aborts. */
export async function readText(stream: ReadableStream<Uint8Array> | null): Promise<{ text: string; error?: string }> {
  if (!stream) return { text: "" }
  const decoder = new TextDecoder()
  let text = ""
  try {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
    return { text: text + decoder.decode() }
  } catch (error) {
    return { text: text + decoder.decode(), error: error instanceof Error ? error.message : String(error) }
  }
}
