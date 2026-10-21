import assert from "node:assert/strict"
import { test } from "node:test"
import { REDACTED, redactHeaders, redactUrl } from "../src/redact.ts"

test("credential headers are redacted, others kept", () => {
  const headers = redactHeaders(
    new Headers({ authorization: "Bearer sk-1", "x-api-key": "sk-2", "content-type": "application/json" }),
  )

  assert.deepEqual(headers, { authorization: REDACTED, "content-type": "application/json", "x-api-key": REDACTED })
})

test("api keys in the query string are redacted", () => {
  const url = redactUrl("https://example.com/v1/models/g:generate?key=secret&alt=sse")

  assert.equal(url, `https://example.com/v1/models/g:generate?key=${encodeURIComponent(REDACTED)}&alt=sse`)
})
