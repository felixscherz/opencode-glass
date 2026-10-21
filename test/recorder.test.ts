import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import type { Capture } from "../src/capture.ts"
import { createRecorder } from "../src/recorder.ts"

const capture = (direction: Capture["direction"], body: unknown): Capture => ({
  capturedAt: "2026-10-21T10:00:00.000Z",
  sessionID: "ses_1",
  agent: "build",
  model: { providerID: "fake", id: "m" },
  kind: "primary",
  direction,
  transport: "http",
  body,
})

test("a request and its response share one exchange prefix, and exchanges sort in send order", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "glass-"))
  const recorder = createRecorder(directory)
  const at = new Date("2026-10-21T10:00:00.000Z")

  const first = recorder.exchange("ses_1", "title", at)
  const second = recorder.exchange("ses_1", "primary", at)
  await recorder.write(second, capture("request", { messages: [] }))
  await recorder.write(first, capture("request", { messages: [] }))
  await recorder.write(second, capture("response", "data: [DONE]\n\n"))

  const files = (await readdir(path.join(directory, "ses_1"))).sort()
  assert.deepEqual(files, [
    "2026-10-21T10-00-00-000Z-0001-title-request.json",
    "2026-10-21T10-00-00-000Z-0001-title-request.md",
    "2026-10-21T10-00-00-000Z-0002-primary-request.json",
    "2026-10-21T10-00-00-000Z-0002-primary-request.md",
    "2026-10-21T10-00-00-000Z-0002-primary-response.json",
    "2026-10-21T10-00-00-000Z-0002-primary-response.md",
  ])
  const response = JSON.parse(await readFile(`${second}-response.json`, "utf8"))
  assert.equal(response.body, "data: [DONE]\n\n")
})

test("websocket frames are appended to one JSON lines file in arrival order", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "glass-"))
  const recorder = createRecorder(directory)
  const exchange = recorder.exchange("ses_1", "primary", new Date())

  await recorder.appendFrame(exchange, { receivedAt: "t1", frame: { type: "delta" } })
  await recorder.appendFrame(exchange, { receivedAt: "t2", frame: { type: "done" } })

  const lines = (await readFile(`${exchange}-response.jsonl`, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  assert.deepEqual(lines, [
    { receivedAt: "t1", frame: { type: "delta" } },
    { receivedAt: "t2", frame: { type: "done" } },
  ])
})
