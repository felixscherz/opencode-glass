import { assembleReply, type Reply, type ReplyFormat } from "./assemble.ts"
import type { Capture } from "./capture.ts"

/** Strings longer than this, or spanning several lines, are printed as text blocks instead of inline JSON. */
const INLINE_LIMIT = 120

const FORMAT_NAMES: Record<ReplyFormat, string> = {
  "chat-completions": "Chat Completions",
  "anthropic-messages": "Anthropic Messages",
  "openai-responses": "OpenAI Responses",
  gemini: "Gemini",
}

/**
 * Renders a capture as Markdown, with the metadata first and the content at the bottom. A response in a known
 * provider format reads as the reply the model gave, joined from its stream. Anything else is shown without knowing the wire format: the body as a JSON skeleton, with every
 * long string in it (system prompt, tool descriptions, skill text, message content) pulled out into its own section
 * so it reads as plain text rather than an escaped JSON string.
 *
 * `rawFile` is the path of the capture as recorded, relative to the Markdown file, and is linked from the header.
 */
export function renderMarkdown(capture: Capture, rawFile?: string): string {
  const reply = capture.direction === "response" ? assembleReply(capture.body) : undefined
  const lines = header(capture, rawFile)
  if (reply) lines.push(...replySummary(reply))
  if (capture.headers) {
    lines.push("## Headers", "", fence(JSON.stringify(capture.headers, null, 2), "json"), "")
  }
  lines.push(...(reply ? replyParts(reply) : bodySections(capture.body)))
  return lines.join("\n")
}

function header(capture: Capture, rawFile: string | undefined): string[] {
  const lines = [
    `# ${capture.kind} ${capture.direction}`,
    "",
    "| | |",
    "|---|---|",
    `| captured | ${capture.capturedAt} |`,
    `| session | ${capture.sessionID} |`,
    `| agent | ${capture.agent} |`,
    `| model | \`${JSON.stringify(capture.model)}\` |`,
    `| transport | ${capture.transport} |`,
  ]
  if (capture.url) lines.push(`| request | ${capture.method ?? ""} ${capture.url} |`)
  if (capture.status !== undefined) lines.push(`| status | ${capture.status} |`)
  if (capture.error) lines.push(`| error | body incomplete: ${capture.error} |`)
  if (rawFile) lines.push(`| raw | [${rawFile}](${rawFile}) |`)
  lines.push("")
  return lines
}

function replySummary(reply: Reply): string[] {
  const lines = ["## Reply", "", "| | |", "|---|---|", `| format | ${FORMAT_NAMES[reply.format]} |`]
  if (reply.model) lines.push(`| model | ${reply.model} |`)
  if (reply.stopReason) lines.push(`| stop reason | ${reply.stopReason} |`)
  lines.push("")
  if (reply.error !== undefined) lines.push("## Error", "", fence(JSON.stringify(reply.error, null, 2), "json"), "")
  if (reply.usage !== undefined) lines.push("## Usage", "", fence(JSON.stringify(reply.usage, null, 2), "json"), "")
  return lines
}

/** Reasoning, text and tool calls, in the order the model produced them. */
function replyParts(reply: Reply): string[] {
  const lines: string[] = []
  for (const part of reply.parts) {
    switch (part.type) {
      case "reasoning":
        lines.push("## Reasoning", "")
        if (part.text) lines.push(fence(part.text), "")
        if (part.encrypted) lines.push(`_${part.text ? "The provider also sent" : "The provider sent only"} encrypted reasoning._`, "")
        break
      case "text":
        lines.push("## Text", "", fence(part.text), "")
        break
      case "tool-call":
        lines.push(`## Tool call: ${part.name}`, "")
        if (part.id) lines.push(`\`${part.id}\``, "")
        lines.push(toolInput(part.input), "")
        break
    }
  }
  return lines
}

/** Pretty-printed when the model wrote valid JSON, as written otherwise, e.g. when the stream broke off. */
function toolInput(input: string): string {
  try {
    return fence(JSON.stringify(JSON.parse(input), null, 2), "json")
  } catch {
    return fence(input)
  }
}

function bodySections(body: unknown): string[] {
  const texts: Array<{ path: string; text: string }> = []
  const skeleton = extractTexts(body, "body", texts)
  const tools = toolNames(body)
  const lines: string[] = []
  if (tools.length > 0) {
    lines.push(`## Tools (${tools.length})`, "", ...tools.map((name) => `- ${name}`), "")
  }
  lines.push("## Body", "", fence(JSON.stringify(skeleton, null, 2), "json"), "")
  for (const { path, text } of texts) {
    lines.push(`### ${path}`, "", fence(text), "")
  }
  return lines
}

function extractTexts(value: unknown, path: string, texts: Array<{ path: string; text: string }>): unknown {
  if (typeof value === "string") {
    if (value.length <= INLINE_LIMIT && !value.includes("\n")) return value
    texts.push({ path, text: value })
    return `<see ${path}>`
  }
  if (Array.isArray(value)) return value.map((item, index) => extractTexts(item, `${path}[${index}]`, texts))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, extractTexts(item, `${path}.${key}`, texts)]),
    )
  }
  return value
}

/** Tool names across the common shapes: Anthropic/Responses `name`, Chat Completions `function.name`, Gemini `functionDeclarations`. */
function toolNames(body: unknown): string[] {
  const tools = isRecord(body) && Array.isArray(body.tools) ? body.tools : []
  return tools.flatMap((tool): string[] => {
    if (!isRecord(tool)) return []
    if (typeof tool.name === "string") return [tool.name]
    if (isRecord(tool.function) && typeof tool.function.name === "string") return [tool.function.name]
    if (Array.isArray(tool.functionDeclarations)) {
      return tool.functionDeclarations.flatMap((declaration) =>
        isRecord(declaration) && typeof declaration.name === "string" ? [declaration.name] : [],
      )
    }
    return []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** A fence longer than any backtick run in the text, so captured Markdown cannot close it early. */
function fence(text: string, language = ""): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const marker = "`".repeat(Math.max(3, longest + 1))
  return `${marker}${language}\n${text}\n${marker}`
}
