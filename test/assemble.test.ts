import assert from "node:assert/strict"
import { test } from "node:test"
import { assembleReply } from "../src/assemble.ts"

const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n"

test("a chat completions stream is joined into text, reasoning and whole tool calls", () => {
  const chunk = (delta: unknown, extra: object = {}) => ({
    object: "chat.completion.chunk",
    model: "m",
    choices: [{ index: 0, delta, ...extra }],
  })
  const body = sse(
    chunk({ role: "assistant", reasoning_content: "Think " }),
    chunk({ reasoning_content: "hard." }),
    chunk({ content: "Hi" }),
    chunk({ content: " there" }),
    chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "skill", arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"id":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }),
    chunk({}, { finish_reason: "tool_calls" }),
    { object: "chat.completion.chunk", choices: [], usage: { total_tokens: 3 } },
  )

  assert.deepEqual(assembleReply(body), {
    format: "chat-completions",
    model: "m",
    parts: [
      { type: "reasoning", text: "Think hard.", encrypted: false },
      { type: "text", text: "Hi there" },
      { type: "tool-call", id: "call_1", name: "skill", input: '{"id":"x"}' },
    ],
    stopReason: "tool_calls",
    usage: { total_tokens: 3 },
  })
})

test("encrypted reasoning from a chat completions proxy is marked as unreadable", () => {
  const body = sse({
    choices: [{ index: 0, delta: { reasoning_items: [{ type: "reasoning", encrypted_content: "gAAA", summary: [] }] } }],
  })

  assert.deepEqual(assembleReply(body)?.parts, [{ type: "reasoning", text: "", encrypted: true }])
})

test("an anthropic messages stream is joined block by block", () => {
  const body = sse(
    { type: "message_start", message: { model: "claude", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Hmm" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Let me " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "look." } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu_1", name: "read", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":' } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  )

  assert.deepEqual(assembleReply(body), {
    format: "anthropic-messages",
    model: "claude",
    parts: [
      { type: "reasoning", text: "Hmm", encrypted: false },
      { type: "text", text: "Let me look." },
      { type: "tool-call", id: "tu_1", name: "read", input: '{"path":"a.ts"}' },
    ],
    stopReason: "tool_use",
    usage: { input_tokens: 5, output_tokens: 9 },
  })
})

test("an openai responses stream that broke off is joined from its deltas", () => {
  const body = sse(
    { type: "response.created", response: { model: "gpt" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", summary: [] } },
    { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "Plan" },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", content: [] } },
    { type: "response.output_text.delta", output_index: 1, delta: "Hel" },
    { type: "response.output_text.delta", output_index: 1, delta: "lo" },
    { type: "response.output_item.added", output_index: 2, item: { type: "function_call", call_id: "c1", name: "bash", arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"cmd":"ls"}' },
  )

  assert.deepEqual(assembleReply(body), {
    format: "openai-responses",
    model: "gpt",
    parts: [
      { type: "reasoning", text: "Plan", encrypted: false },
      { type: "text", text: "Hello" },
      { type: "tool-call", id: "c1", name: "bash", input: '{"cmd":"ls"}' },
    ],
  })
})

test("a completed openai responses stream takes the final response as the reply", () => {
  const body = sse(
    { type: "response.output_text.delta", output_index: 0, delta: "partial" },
    {
      type: "response.completed",
      response: {
        model: "gpt",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }],
        usage: { total_tokens: 4 },
      },
    },
  )

  assert.deepEqual(assembleReply(body), {
    format: "openai-responses",
    model: "gpt",
    parts: [{ type: "text", text: "Done." }],
    stopReason: "completed",
    usage: { total_tokens: 4 },
  })
})

test("a gemini stream merges consecutive text parts and keeps thoughts apart", () => {
  const chunk = (parts: unknown[], extra: object = {}) => ({ candidates: [{ content: { parts }, ...extra }], modelVersion: "gemini" })
  const body = sse(
    chunk([{ text: "Mull", thought: true }]),
    chunk([{ text: "ing", thought: true }]),
    chunk([{ text: "Answer" }]),
    chunk([{ functionCall: { name: "grep", args: { q: "x" } } }], { finishReason: "STOP" }),
    { candidates: [], usageMetadata: { totalTokenCount: 7 } },
  )

  assert.deepEqual(assembleReply(body), {
    format: "gemini",
    model: "gemini",
    parts: [
      { type: "reasoning", text: "Mulling", encrypted: false },
      { type: "text", text: "Answer" },
      { type: "tool-call", name: "grep", input: '{"q":"x"}' },
    ],
    stopReason: "STOP",
    usage: { totalTokenCount: 7 },
  })
})

test("a non-streaming chat completion is read from its message", () => {
  const body = {
    object: "chat.completion",
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
  }

  assert.deepEqual(assembleReply(body)?.parts, [{ type: "text", text: "Hi" }])
})

test("a body in no known format is not assembled", () => {
  assert.equal(assembleReply("plain text"), undefined)
  assert.equal(assembleReply({ error: { message: "rate limited" } }), undefined)
})
