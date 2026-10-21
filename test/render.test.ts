import assert from "node:assert/strict"
import { test } from "node:test"
import type { Capture } from "../src/capture.ts"
import { renderMarkdown } from "../src/render.ts"

const capture = (body: unknown): Capture => ({
  capturedAt: "2026-10-21T10:00:00.000Z",
  sessionID: "ses_1",
  agent: "build",
  model: { providerID: "fake", id: "m" },
  kind: "primary",
  direction: "request",
  transport: "http",
  method: "POST",
  url: "http://localhost/v1/chat/completions",
  headers: { "content-type": "application/json" },
  body,
})

test("the system prompt reads as plain text, not an escaped JSON string", () => {
  const markdown = renderMarkdown(capture({ messages: [{ role: "system", content: "You are opencode.\nBe brief." }] }))

  assert.match(markdown, /### body\.messages\[0\]\.content\n\n```\nYou are opencode\.\nBe brief\.\n```/)
  assert.match(markdown, /"content": "<see body\.messages\[0\]\.content>"/)
})

test("short strings stay inline in the body", () => {
  const markdown = renderMarkdown(capture({ model: "m", messages: [{ role: "user", content: "hi" }] }))

  assert.match(markdown, /"content": "hi"/)
  assert.doesNotMatch(markdown, /### body/)
})

test("tool names are listed for chat completions, anthropic and gemini shapes", () => {
  const names = (body: unknown) => renderMarkdown(capture(body)).match(/## Tools \(\d+\)\n\n((?:- .*\n)+)/)?.[1]

  assert.equal(names({ tools: [{ type: "function", function: { name: "read" } }] }), "- read\n")
  assert.equal(names({ tools: [{ name: "bash" }] }), "- bash\n")
  assert.equal(names({ tools: [{ functionDeclarations: [{ name: "a" }, { name: "b" }] }] }), "- a\n- b\n")
})

test("captured text containing code fences cannot break out of its block", () => {
  const markdown = renderMarkdown(capture({ instructions: "Example:\n```ts\nx\n```" }))

  assert.match(markdown, /````\nExample:\n```ts\nx\n```\n````/)
})

test("a streamed response reads as the assembled reply and points to the raw stream", () => {
  const stream = [
    { choices: [{ index: 0, delta: { content: "Hello" } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "skill", arguments: '{"id":"x"}' } }] } }] },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")
  const markdown = renderMarkdown({ ...capture(stream), direction: "response" }, "raw/0002-primary-response.json")

  assert.match(markdown, /\| raw \| \[raw\/0002-primary-response\.json\]\(raw\/0002-primary-response\.json\) \|/)
  assert.match(markdown, /## Text\n\n```\nHello\n```/)
  assert.match(markdown, /## Tool call: skill\n\n`call_1`\n\n```json\n\{\n  "id": "x"\n\}\n```/)
  assert.doesNotMatch(markdown, /data: /)
})

test("a reply puts usage and headers above the reasoning and text, so the content sits at the bottom", () => {
  const stream = [
    { choices: [{ index: 0, delta: { reasoning_content: "Hmm", content: "Hello" } }] },
    { choices: [], usage: { total_tokens: 3 } },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")
  const markdown = renderMarkdown({ ...capture(stream), direction: "response" })

  const sections = markdown.match(/^## .*/gm)
  assert.deepEqual(sections, ["## Reply", "## Usage", "## Headers", "## Reasoning", "## Text"])
})

test("a request lists its headers above the body", () => {
  const sections = renderMarkdown(capture({ messages: [] })).match(/^## .*/gm)

  assert.deepEqual(sections, ["## Headers", "## Body"])
})
