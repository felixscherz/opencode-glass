import { Plugin } from "@opencode/plugin"
import { parseBody, readText } from "./capture.ts"
import { captureDirectory, createRecorder } from "./recorder.ts"
import { redactHeaders, redactUrl } from "./redact.ts"

/**
 * Records every payload OpenCode exchanges with a model provider: the request after OpenCode has turned the session
 * into the provider's wire format, and the raw response the provider streams back. Unlike `/export`, this includes
 * the system prompt, tool and skill definitions, and auxiliary requests such as title generation and compaction.
 *
 * Options:
 * - `directory`: where captures are written. Defaults to `$XDG_DATA_HOME/opencode-glass` (`~/.local/share/opencode-glass`).
 */
export default Plugin.define({
  id: "opencode-glass",
  async setup(context) {
    const recorder = createRecorder(captureDirectory(context.options))
    // Pairs a response with the exchange its request was recorded under.
    const exchanges = new WeakMap<Request, string>()
    // A WebSocket reply has no handle on its request, so frames go to the last send of the same session and kind.
    const sockets = new Map<string, string>()

    // Observing must never break the request, so failures are logged and swallowed.
    const safely = async (write: () => Promise<unknown>) => {
      try {
        await write()
      } catch (error) {
        console.error(`[opencode-glass] could not record: ${error instanceof Error ? error.message : error}`)
      }
    }

    const registrations = await Promise.all([
      context.session.hook("http.request", (input) =>
        safely(async () => {
          const at = new Date()
          const exchange = recorder.exchange(input.sessionID, input.kind, at)
          exchanges.set(input.request, exchange)
          // Reading a clone leaves the original body intact for the actual send.
          const { text, error } = await readText(input.request.clone().body)
          await recorder.write(exchange, {
            capturedAt: at.toISOString(),
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            kind: input.kind,
            direction: "request",
            transport: "http",
            method: input.request.method,
            url: redactUrl(input.request.url),
            headers: redactHeaders(input.request.headers),
            body: parseBody(text),
            error,
          })
        }),
      ),
      context.session.hook("http.response", (input) => {
        const exchange = exchanges.get(input.request) ?? recorder.exchange(input.sessionID, input.kind, new Date())
        const response = input.response.clone()
        // Not awaited: the hook returns at once so OpenCode streams the original while the clone is read to the end.
        void safely(async () => {
          const { text, error } = await readText(response.body)
          await recorder.write(exchange, {
            capturedAt: new Date().toISOString(),
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            kind: input.kind,
            direction: "response",
            transport: "http",
            status: response.status,
            headers: redactHeaders(response.headers),
            body: parseBody(text),
            error,
          })
        })
      }),
      context.session.hook("experimental.ws.send", (input) =>
        safely(async () => {
          const at = new Date()
          const exchange = recorder.exchange(input.sessionID, input.kind, at)
          sockets.set(`${input.sessionID}:${input.kind}`, exchange)
          await recorder.write(exchange, {
            capturedAt: at.toISOString(),
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            kind: input.kind,
            direction: "request",
            transport: "websocket",
            body: parseBody(input.frame),
          })
        }),
      ),
      context.session.hook("experimental.ws.receive", (input) =>
        safely(async () => {
          const key = `${input.sessionID}:${input.kind}`
          const exchange = sockets.get(key) ?? recorder.exchange(input.sessionID, input.kind, new Date())
          sockets.set(key, exchange)
          await recorder.appendFrame(exchange, { receivedAt: new Date().toISOString(), frame: parseBody(input.frame) })
        }),
      ),
    ])

    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
})
