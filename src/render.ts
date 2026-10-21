import type { Capture } from "./capture.ts"

/** Strings longer than this, or spanning several lines, are printed as text blocks instead of inline JSON. */
const INLINE_LIMIT = 120

/**
 * Renders a capture as Markdown without knowing the provider's wire format: the body is shown as a JSON skeleton,
 * and every long string in it (system prompt, tool descriptions, skill text, message content) is pulled out into
 * its own section so it reads as plain text rather than an escaped JSON string.
 */
export function renderMarkdown(capture: Capture): string {
  const texts: Array<{ path: string; text: string }> = []
  const skeleton = extractTexts(capture.body, "body", texts)
  const tools = toolNames(capture.body)

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
  lines.push("")

  if (tools.length > 0) {
    lines.push(`## Tools (${tools.length})`, "", ...tools.map((name) => `- ${name}`), "")
  }
  if (capture.headers) {
    lines.push("## Headers", "", fence(JSON.stringify(capture.headers, null, 2), "json"), "")
  }
  lines.push("## Body", "", fence(JSON.stringify(skeleton, null, 2), "json"), "")
  for (const { path, text } of texts) {
    lines.push(`### ${path}`, "", fence(text), "")
  }
  return lines.join("\n")
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
