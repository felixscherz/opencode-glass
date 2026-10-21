# opencode-glass

An OpenCode v2 plugin that records every payload OpenCode exchanges with a model provider, exactly as it goes over the
wire: the request OpenCode sends and the raw response the provider streams back. Unlike `/export`, the captures
include the full system prompt, the skill listing, every tool definition, and auxiliary requests such as title
generation and compaction.

It hooks `http.request`, `http.response`, `experimental.ws.send`, and `experimental.ws.receive` on the session, so
what it records is the provider-specific payload: Chat Completions, Responses, Anthropic Messages, Gemini, and so on.

## Install

Add the repository directory to `plugins` in `~/.config/opencode/opencode.json` (or a project's `opencode.json`):

```json
{
  "plugins": [
    {
      "package": "/path/to/opencode-glass",
      "options": { "directory": "/where/to/write/captures" }
    }
  ]
}
```

`options` is optional. The entry must point at the directory, not at a file: for a local path, OpenCode loads
`<directory>/server.ts`.

## Output

Captures go to `directory`, by default `$XDG_DATA_HOME/opencode-glass` (`~/.local/share/opencode-glass`), one folder
per session:

```
<directory>/<sessionID>/
  2026-10-21T07-01-56-391Z-0001-title-request.json
  2026-10-21T07-01-56-391Z-0001-title-request.md
  2026-10-21T07-01-56-391Z-0001-title-response.json
  2026-10-21T07-01-56-391Z-0001-title-response.md
  2026-10-21T07-01-56-398Z-0002-primary-request.json
  ...
```

A request and its response share a prefix, and prefixes sort in send order. The kind is `primary` (agent loop),
`title`, `compaction`, or `generate`.

- `.json` holds the metadata, headers, and the body: parsed when it is JSON (requests, error responses), otherwise the
  raw text, such as a server-sent event stream exactly as received. Use it with `jq`, or diff two turns.
- `.md` is the same payload for reading: the body as a JSON skeleton, with every long string (system prompt, tool
  descriptions, message content, the event stream) printed as plain text under its JSON path.
- `-response.jsonl` replaces the response files for WebSocket providers: one line per received frame.

The response is read from a copy of the stream in the background, so streaming in OpenCode is not delayed. If the
stream breaks off, for example when you interrupt the agent, the capture keeps what arrived and sets `error`.

Headers and query parameters whose names look like credentials (`authorization`, `x-api-key`, `key`, ...) are
replaced with `[redacted]`. Request bodies are stored as sent, so treat the capture folder as sensitive: it contains
your conversations and file contents.

## Caveats

- Plugin hooks run in registration order. A plugin that rewrites the request in a later `http.request` hook changes
  what is sent after this plugin has recorded it.
- The WebSocket hooks are experimental in OpenCode and have not been tested against a real WebSocket provider.

## Development

```sh
npm install
npm test
npm run typecheck
```
