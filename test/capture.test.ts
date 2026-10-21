import assert from "node:assert/strict"
import { test } from "node:test"
import { readText } from "../src/capture.ts"

const encode = (text: string) => new TextEncoder().encode(text)

test("a body is read to the end", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode("data: a\n\n"))
      controller.enqueue(encode("data: b\n\n"))
      controller.close()
    },
  })

  assert.deepEqual(await readText(stream), { text: "data: a\n\ndata: b\n\n" })
})

test("a stream cut off part way keeps what arrived and says why", async () => {
  let delivered = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered) return controller.error(new Error("aborted"))
      delivered = true
      controller.enqueue(encode("data: a\n\n"))
    },
  })

  assert.deepEqual(await readText(stream), { text: "data: a\n\n", error: "aborted" })
})

test("a multi-byte character split across chunks is decoded intact", async () => {
  const bytes = encode("ü")
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1))
      controller.enqueue(bytes.slice(1))
      controller.close()
    },
  })

  assert.deepEqual(await readText(stream), { text: "ü" })
})
