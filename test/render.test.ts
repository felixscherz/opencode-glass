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
