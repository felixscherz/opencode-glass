/**
 * A model's reply put back together from a response body: the text, reasoning and tool calls the provider streamed
 * as many small events, joined into whole parts in the order the model produced them.
 */
export interface Reply {
  readonly format: ReplyFormat
  readonly model?: string
  readonly parts: readonly ReplyPart[]
  readonly stopReason?: string
  readonly usage?: unknown
  /** An error the provider reported inside an otherwise successful response, e.g. mid-stream. */
  readonly error?: unknown
}

export type ReplyFormat = "chat-completions" | "anthropic-messages" | "openai-responses" | "gemini"

export type ReplyPart =
  /** `encrypted` is set when the provider sent reasoning it does not let the client read. */
  | { readonly type: "reasoning"; readonly text: string; readonly encrypted: boolean }
  | { readonly type: "text"; readonly text: string }
  /** `input` is the arguments as the model wrote them, usually JSON. */
  | { readonly type: "tool-call"; readonly id?: string; readonly name: string; readonly input: string }

type Event = Record<string, unknown>

/**
 * Assembles a response body in one of the common provider formats, streamed as server-sent events or not. Returns
 * `undefined` for anything else, such as an error body, so the caller can fall back to showing the body as it is.
 */
export function assembleReply(body: unknown): Reply | undefined {
  const events = (typeof body === "string" ? serverSentEvents(body) : Array.isArray(body) ? body : [body]).filter(isRecord)
  if (events.some((event) => Array.isArray(event.choices))) return chatCompletions(events)
  if (events.some((event) => Array.isArray(event.candidates))) return gemini(events)
  if (events.some(isResponsesEvent)) return openaiResponses(events)
  if (events.some(isAnthropicEvent)) return anthropicMessages(events)
  return undefined
}

/** The JSON payload of each event; anything else, such as OpenAI's `[DONE]` marker, is skipped. */
function serverSentEvents(text: string): unknown[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
    try {
      return data ? [JSON.parse(data)] : []
    } catch {
      return []
    }
  })
}

/** Only the first choice is assembled; OpenCode never asks for more than one. */
function chatCompletions(events: Event[]): Reply {
  let model: string | undefined
  let stopReason: string | undefined
  let usage: unknown
  let error: unknown
  let reasoning = ""
  let encrypted = false
  let text = ""
  const calls = new Map<number, { id?: string; name: string; input: string }>()

  for (const event of events) {
    model = string(event.model) ?? model
    usage = event.usage ?? usage
    error = event.error ?? error
    const choice = array(event.choices).find((choice) => isRecord(choice) && (choice.index ?? 0) === 0)
    if (!isRecord(choice)) continue
    stopReason = string(choice.finish_reason) ?? stopReason
    // Streamed chunks carry a `delta`, a non-streamed completion the whole `message`.
    const delta = record(choice.delta) ?? record(choice.message) ?? {}
    text += string(delta.content) ?? ""
    // `reasoning_content` (DeepSeek, LiteLLM) or `reasoning` (OpenRouter, vLLM).
    reasoning += string(delta.reasoning_content) ?? string(delta.reasoning) ?? ""
    // LiteLLM passes through OpenAI reasoning items, which are encrypted unless a summary was requested.
    for (const item of array(delta.reasoning_items).filter(isRecord)) {
      reasoning += summaryText(item)
      encrypted ||= typeof item.encrypted_content === "string"
    }
    array(delta.tool_calls).forEach((call, position) => {
      if (!isRecord(call)) return
      const index = typeof call.index === "number" ? call.index : position
      const fn = record(call.function) ?? {}
      const current = calls.get(index) ?? { name: "", input: "" }
      calls.set(index, {
        id: string(call.id) ?? current.id,
        name: current.name + (string(fn.name) ?? ""),
        input: current.input + (string(fn.arguments) ?? ""),
      })
    })
  }

  const parts: ReplyPart[] = []
  if (reasoning || encrypted) parts.push({ type: "reasoning", text: reasoning, encrypted })
  if (text) parts.push({ type: "text", text })
  for (const [, call] of [...calls].sort(([a], [b]) => a - b)) parts.push(toolCall(call.id, call.name, call.input))
  return reply("chat-completions", parts, { model, stopReason, usage, error })
}

function isAnthropicEvent(event: Event): boolean {
  return event.type === "message" || event.type === "message_start" || event.type === "content_block_start"
}

function anthropicMessages(events: Event[]): Reply {
  let model: string | undefined
  let stopReason: string | undefined
  let usage: Record<string, unknown> | undefined
  let error: unknown
  const blocks = new Map<number, ReplyPart>()

  for (const event of events) {
    // A non-streamed response is the message itself, a stream starts with it and fills in its content.
    const message = event.type === "message" ? event : event.type === "message_start" ? record(event.message) : undefined
    if (message) {
      model = string(message.model) ?? model
      stopReason = string(message.stop_reason) ?? stopReason
      usage = { ...usage, ...record(message.usage) }
      array(message.content).forEach((block, index) => {
        const part = isRecord(block) ? anthropicBlock(block) : undefined
        if (part) blocks.set(index, part)
      })
    }
    const index = typeof event.index === "number" ? event.index : 0
    if (event.type === "content_block_start") {
      const block = record(event.content_block)
      const part = block ? anthropicBlock(block) : undefined
      // Streamed tool input arrives as JSON fragments, so the placeholder `{}` of the start event is dropped.
      if (part) blocks.set(index, part.type === "tool-call" ? { ...part, input: "" } : part)
    }
    if (event.type === "content_block_delta") {
      const delta = record(event.delta) ?? {}
      const part = blocks.get(index)
      const added = string(delta.text) ?? string(delta.thinking) ?? string(delta.partial_json) ?? ""
      if (part?.type === "tool-call") blocks.set(index, { ...part, input: part.input + added })
      else if (part) blocks.set(index, { ...part, text: part.text + added })
    }
    if (event.type === "message_delta") {
      stopReason = string(record(event.delta)?.stop_reason) ?? stopReason
      usage = { ...usage, ...record(event.usage) }
    }
    if (event.type === "error") error = event.error
  }

  const parts = [...blocks].sort(([a], [b]) => a - b).map(([, part]) => part)
  return reply("anthropic-messages", parts, { model, stopReason, usage, error })
}

function anthropicBlock(block: Event): ReplyPart | undefined {
  switch (block.type) {
    case "text":
      return { type: "text", text: string(block.text) ?? "" }
    case "thinking":
      return { type: "reasoning", text: string(block.thinking) ?? "", encrypted: false }
    case "redacted_thinking":
      return { type: "reasoning", text: "", encrypted: true }
    case "tool_use":
    case "server_tool_use":
      return toolCall(string(block.id), string(block.name) ?? "", JSON.stringify(block.input ?? {}))
    default:
      return undefined
  }
}

function isResponsesEvent(event: Event): boolean {
  return event.object === "response" || (typeof event.type === "string" && event.type.startsWith("response."))
}

function openaiResponses(events: Event[]): Reply {
  let model: string | undefined
  let error: unknown
  const items = new Map<number, ReplyPart>()
  // The final event carries the whole response; a stream that broke off before it is assembled from the deltas.
  let final: Event | undefined

  for (const event of events) {
    const response = event.object === "response" ? event : record(event.response)
    model = string(response?.model) ?? model
    if (event.object === "response" || ["response.completed", "response.incomplete", "response.failed"].includes(String(event.type))) {
      final = response
    }
    if (event.type === "error") error = event
    const index = typeof event.output_index === "number" ? event.output_index : 0
    const item = record(event.item)
    if (item && (event.type === "response.output_item.added" || event.type === "response.output_item.done")) {
      const part = responsesItem(item)
      if (part) items.set(index, part)
    }
    const delta = string(event.delta)
    const part = items.get(index)
    if (delta === undefined || !part) continue
    if (event.type === "response.function_call_arguments.delta" && part.type === "tool-call") {
      items.set(index, { ...part, input: part.input + delta })
    }
    const textDelta = ["response.output_text.delta", "response.reasoning_summary_text.delta", "response.reasoning_text.delta"]
    if (textDelta.includes(String(event.type)) && part.type !== "tool-call") items.set(index, { ...part, text: part.text + delta })
  }

  if (final) {
    const parts = array(final.output).flatMap((item) => (isRecord(item) ? (responsesItem(item) ?? []) : []))
    return reply("openai-responses", parts, { model, stopReason: string(final.status), usage: final.usage, error: final.error ?? error })
  }
  const parts = [...items].sort(([a], [b]) => a - b).map(([, part]) => part)
  return reply("openai-responses", parts, { model, error })
}

function responsesItem(item: Event): ReplyPart | undefined {
  switch (item.type) {
    case "message":
      return {
        type: "text",
        text: array(item.content)
          .filter(isRecord)
          .map((content) => string(content.text) ?? string(content.refusal) ?? "")
          .join(""),
      }
    case "reasoning": {
      const text = array(item.content).filter(isRecord).map((content) => string(content.text) ?? "").join("")
      return { type: "reasoning", text: text || summaryText(item), encrypted: typeof item.encrypted_content === "string" }
    }
    case "function_call":
      return toolCall(string(item.call_id), string(item.name) ?? "", string(item.arguments) ?? "")
    case "custom_tool_call":
      return toolCall(string(item.call_id), string(item.name) ?? "", string(item.input) ?? "")
    default:
      return undefined
  }
}

/** The summaries of an OpenAI reasoning item, one paragraph each. */
function summaryText(item: Event): string {
  return array(item.summary)
    .filter(isRecord)
    .map((summary) => string(summary.text) ?? "")
    .join("\n\n")
}

function gemini(events: Event[]): Reply {
  let model: string | undefined
  let stopReason: string | undefined
  let usage: unknown
  let error: unknown
  const parts: ReplyPart[] = []

  for (const event of events) {
    model = string(event.modelVersion) ?? model
    usage = event.usageMetadata ?? usage
    error = event.error ?? error
    const candidate = record(array(event.candidates)[0])
    if (!candidate) continue
    stopReason = string(candidate.finishReason) ?? stopReason
    for (const part of array(record(candidate.content)?.parts).filter(isRecord)) {
      const call = record(part.functionCall)
      if (call) {
        parts.push(toolCall(string(call.id), string(call.name) ?? "", JSON.stringify(call.args ?? {})))
        continue
      }
      const text = string(part.text)
      if (text === undefined) continue
      // Each chunk holds the next piece of the same thought or answer, so a piece of the same kind continues it.
      const type = part.thought === true ? "reasoning" : "text"
      const last = parts.at(-1)
      if (last?.type === type) parts[parts.length - 1] = { ...last, text: last.text + text }
      else parts.push(type === "reasoning" ? { type, text, encrypted: false } : { type, text })
    }
  }
  return reply("gemini", parts, { model, stopReason, usage, error })
}

function toolCall(id: string | undefined, name: string, input: string): ReplyPart {
  return id === undefined ? { type: "tool-call", name, input } : { type: "tool-call", id, name, input }
}

/** Leaves out what the response did not report, so a reply only shows what the provider sent. */
function reply(
  format: ReplyFormat,
  parts: ReplyPart[],
  details: { model?: string; stopReason?: string; usage?: unknown; error?: unknown },
): Reply {
  const present = Object.entries(details).filter(([, value]) => value !== undefined && value !== null)
  return { format, ...Object.fromEntries(present), parts }
}

function isRecord(value: unknown): value is Event {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function record(value: unknown): Event | undefined {
  return isRecord(value) ? value : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
