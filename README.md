# opencode-glass

See exactly what OpenCode sends to the model and what comes back.

opencode-glass is an OpenCode v2 plugin that records every request OpenCode makes to a model provider, and the raw
response, as it goes over the wire. That includes the parts `/export` leaves out:

- the full system prompt, including your `AGENTS.md` instructions and the list of available skills
- every tool definition with its description and JSON schema
- auxiliary requests such as session title generation and compaction
- the raw response stream, chunk by chunk, and provider errors

Use it to understand why the model behaves the way it does, to check what a skill or instruction file adds to the
context, or to compare how a change to your setup shows up in the prompt.

## Requirements

- OpenCode v2 (tested with 2.0.29)

Nothing else. OpenCode runs the TypeScript sources directly, so there is no build step and no `npm install`.

## Install

1. Clone the repository somewhere permanent. OpenCode loads the plugin from this folder, so keep it there.

   ```sh
   git clone https://github.com/felixscherz/opencode-glass.git ~/opencode-glass
   ```

2. Add the folder to `plugins` in your global OpenCode config, `~/.config/opencode/opencode.json`. Use the absolute
   path to the folder itself, not to a file inside it:

   ```json
   {
     "plugins": [{ "package": "/Users/you/opencode-glass" }]
   }
   ```

   Keep any plugins you already have in the list. To record only in one project, put the entry in that project's
   `opencode.json` instead.

3. Restart OpenCode's background server and reopen the TUI:

   ```sh
   opencode service restart
   ```

4. Check that it is active: run `/plugins` in the TUI. `opencode-glass` appears under both **Server** (the recorder)
   and **TUI** (the `/glass` command).

From now on every session is recorded.

## Usage

Work with OpenCode as usual. When you want to look at what was sent, run `/glass` in the TUI (also in the command
palette as "Show capture folder"). It shows the folder of the session you are in and copies the path to the
clipboard:

```
Glass captures

/Users/you/.local/share/opencode-glass/ses_ea2adbc1affer8Y5QpLSiPGzBR

Copied to clipboard.
```

On the home screen it shows the root folder that holds all sessions. `/glass` only touches the TUI, so nothing is
added to your session or sent to the model.

The copy uses the OSC 52 terminal escape, which Ghostty, kitty, and WezTerm support. In iTerm2, enable "Applications
in terminal may access clipboard"; inside tmux, set `set -g set-clipboard on`. Otherwise copy the path from the dialog.

Then open the folder, for example:

```sh
cd "$(pbpaste)"          # macOS; the path /glass just copied
less *-0002-primary-request.md
```

## What gets recorded

Each session gets a folder. Every model call produces a request and a response with the same prefix, and the names
sort in the order the calls were made. This is a real capture of a one-message session:

```
~/.local/share/opencode-glass/
└── ses_ea2adbc1affer8Y5QpLSiPGzBR/
    ├── 2026-10-21T07-17-15-065Z-0001-title-request.json
    ├── 2026-10-21T07-17-15-065Z-0001-title-request.md
    ├── 2026-10-21T07-17-15-065Z-0001-title-response.json
    ├── 2026-10-21T07-17-15-065Z-0001-title-response.md
    ├── 2026-10-21T07-17-15-072Z-0002-primary-request.json
    ├── 2026-10-21T07-17-15-072Z-0002-primary-request.md
    ├── 2026-10-21T07-17-15-072Z-0002-primary-response.json
    └── 2026-10-21T07-17-15-072Z-0002-primary-response.md
```

The part after the number is the kind of call: `primary` is the agent loop, `title` generates the session title,
`compaction` summarizes a long session, `generate` is any other one-off generation. A single user message usually
causes several calls: one `primary` call per step of the agent loop, for example after each tool result.

Every capture comes in two formats:

- **`.md` for reading.** The body is shown as a JSON outline, and every long string in it (the system prompt, tool
  descriptions, message content, the response stream) is printed as plain text under its JSON path, so you read it
  as written instead of as one escaped JSON string.
- **`.json` for tools.** Metadata, headers, and the body: parsed when it is JSON, otherwise the raw text, such as a
  server-sent event stream exactly as received. Use it with `jq` or to diff two turns.

Excerpts from `0002-primary-request.md` above, shortened where marked with `…`:

````markdown
# primary request

| | |
|---|---|
| captured | 2026-10-21T07:17:15.072Z |
| session | ses_ea2adbc1affer8Y5QpLSiPGzBR |
| agent | build |
| model | `{"id":"m","providerID":"fake","variant":"default"}` |
| transport | http |
| request | POST http://127.0.0.1:4999/v1/chat/completions |

## Tools (12)

- edit
- glob
- grep
…

## Body

```json
{
  "model": "m",
  "messages": [
    {
      "role": "system",
      "content": "<see body.messages[0].content>"
    },
    {
      "role": "user",
      "content": "\"say hi\""
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "edit",
        "description": "<see body.tools[0].function.description>",
        …
}
```

### body.messages[0].content

```
You are an AI agent running in OpenCode, a coding agent harness. Help the user accomplish their goals using the tools you have available.

# Harness
- Responses are rendered as GitHub-flavored Markdown.
…
```

### body.tools[0].function.description
…
````

And the matching `0002-primary-response.md`, which holds the stream as the provider sent it:

````markdown
# primary response

| | |
|---|---|
| captured | 2026-10-21T07:17:16.289Z |
| session | ses_ea2adbc1affer8Y5QpLSiPGzBR |
| agent | build |
| model | `{"id":"m","providerID":"fake","variant":"default"}` |
| transport | http |
| status | 200 |

…

### body

```
data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hello "},"finish_reason":null}]}

data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"from fake ü"},"finish_reason":null}]}

…

data: [DONE]
```
````

The body is whatever the provider's API expects, so its shape depends on the provider: Chat Completions as above,
or Anthropic Messages, OpenAI Responses, Gemini, and so on. For example, with a Chat Completions provider:

```sh
cd ~/.local/share/opencode-glass/<sessionID>

# the system prompt as plain text
jq -r '.body.messages[] | select(.role == "system") | .content' *-0002-primary-request.json

# the tool names of every request in the session
jq -c '[.body.tools[]?.function.name]' *-request.json

# what changed in the request between two steps of the agent loop
diff <(jq . *-0002-primary-request.json) <(jq . *-0003-primary-request.json)
```

For providers that stream over a WebSocket instead of HTTP, the response is a `…-response.jsonl` file with one line
per received frame instead of the `.json` and `.md` pair.

If a response stream breaks off, for example because you interrupted the agent, the capture keeps what arrived and
records why in `error`.

## Privacy

The captures contain everything the model saw: your conversations and the contents of every file the agent read.
Treat the capture folder like those files, and do not share captures without reading them first.

Headers and URL query parameters whose names look like credentials (`authorization`, `x-api-key`, `key`, `token`,
...) are replaced with `[redacted]`. Request and response bodies are stored unchanged.

Captures are never deleted automatically. Remove old session folders when you no longer need them.

## Configuration

To write captures somewhere else, pass `directory` in the plugin entry. Both `/glass` and the recorder use it:

```json
{
  "plugins": [{ "package": "/Users/you/opencode-glass", "options": { "directory": "/Users/you/glass-captures" } }]
}
```

The default is `$XDG_DATA_HOME/opencode-glass`, which is `~/.local/share/opencode-glass` when `XDG_DATA_HOME` is not
set.

## Uninstall

Remove the entry from `plugins`, run `opencode service restart`, and delete the capture folder.

## How it works

The plugin has two parts, both loaded from the same `plugins` entry:

- `server.ts` runs in OpenCode's server. It registers the session hooks `http.request`, `http.response`,
  `experimental.ws.send`, and `experimental.ws.receive`, which see a request after OpenCode has turned the session
  into the provider's wire format. Requests are read from a copy of the body. Responses are read from a copy of the
  stream in the background, so streaming in OpenCode is not delayed.
- `tui.ts` runs in the terminal UI and adds the `/glass` command.

## Limitations

- Plugin hooks run in registration order. A plugin that rewrites the request in a later `http.request` hook changes
  what is sent after opencode-glass has recorded it.
- The WebSocket hooks are experimental in OpenCode and have not been tested against a real WebSocket provider.
- `/glass` assumes the TUI and the OpenCode server run on the same machine. With a remote server, the captures are on
  the server's disk.

## Development

```sh
npm install         # type definitions and test tooling only
npm test
npm run typecheck
```

OpenCode watches local plugin folders and reloads the server part when files change. If a change to `/glass` does
not show up, reopen the TUI.
