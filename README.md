# dsh-mcp-live-status

English | [中文](README.zh.md)

**See which MCP servers are actually connected — in the composer, before you hit send.**

A DeepSeek Harness plugin that puts a live MCP status pill in the conversation
composer's tool row, next to the access-mode and model controls.

![The MCP status pill in the composer tool row](docs/screenshot.png)

## Why

DSH's settings page can tell you an MCP plugin *mounted*. It cannot tell you the
server *answered*.

`@deepseek-ai/dsh-mcp-client` defaults to `failOnStartupError: false`, so a
server whose transport never connected still reaches Cordis fiber state
`ACTIVE`. It looks healthy everywhere in the UI. You find out it is dead when
the agent tries to call one of its tools, mid-task.

This plugin closes that gap by checking the one thing that actually proves a
handshake happened: **tool registration**. mcp-client only registers
`mcp__<serverName>__<toolName>` on `ctx.tools` after `connect()` *and*
`listTools()` have both succeeded. So the status is a join of two sources —
what the Loader says is configured, against what the tool registry says arrived.

| Loader entry | Registered tools | Shown as |
|---|---|---|
| fiber `active` | > 0 | 🟢 Connected |
| fiber `active` | 0 | 🟡 **Up, not connected** ← the one nothing else surfaces |
| fiber `pending` / `loading` | — | 🔵 Starting |
| fiber `failed` | — | 🔴 Mount failed |
| disabled | — | ⚪ Disabled (hidden by default) |

## Install

```bash
dsh plugin --profile web add github:felix-lj-ct/dsh-mcp-live-status
```

Then restart the profile:

```bash
dsh --profile web
```

The pill appears in the composer tool row. If no MCP servers are configured, it
renders nothing at all and costs no layout.

## What it looks like

```
Healthy — no denominator, because a denominator would carry no information
  [+] [⏱ Full access ⌄] [● MCP 4]        [model ⌄] [↑]

Degraded — the denominator appears exactly when something is wrong
  [+] [⏱ Full access ⌄] [● MCP 3/4]      [model ⌄] [↑]
```

Clicking the pill opens a read-only panel listing every server with its
transport, tool count, and — when something is off — the reason:

```
┌──────────────────────────────────┐
│ MCP servers                   ⟳  │
├──────────────────────────────────┤
│ ● atlassian     stdio    31 tools │
│ ● mongodb-qa    stdio    20 tools │
│ ● broken-probe  stdio  Up, not connected │
├──────────────────────────────────┤
│ 3 configured · 2 connected        │
└──────────────────────────────────┘
```

## Configuration

Optional. Defaults are fine for most people.

```yaml
- id: dsh-mcp-live-status
  name: dsh-mcp-live-status
  config:
    pollIntervalMs: 10000   # 0 disables polling (mount + manual refresh only)
    showDisabled: false     # include Loader entries that are disabled
```

Polling only runs while the browser tab is visible.

## Permissions and risk

Read-only. This plugin has no way to start, stop, reload, or reconfigure an MCP
server — managing servers stays with the settings page.

| Surface | What it does |
|---|---|
| `ctx.loader` | Reads the configured plugin tree (read-only iteration) |
| `ctx.tools` | Reads registered tool *names* only; never calls a tool |
| `ctx.webServer` | Serves one JSON route, `GET /dsh-mcp-live-status/status` |
| Network | None outbound. The browser half fetches only that local route. |
| Storage | None. No cache, no history, no files written. |

**On secrets.** MCP servers are routinely launched with credentials on the
command line (`--connectionString mongodb+srv://user:pass@host`, `--token …`).
Because the status payload is fetched by a browser, argument values are
filtered before they leave the host: anything containing a URI scheme or
`user:pass@` userinfo, anything following a flag named like a secret
(`pass`/`token`/`key`/`secret`/`auth`/`conn`/`dsn`/`uri`/`url`), any opaque blob
over 24 characters, and anything over 40 characters is dropped. `env` is never
read at all. HTTP transports keep only `origin + pathname`, so query strings and
userinfo never ship.

The result is recognisable but not exploitable — `npx -y mongodb-mcp-server
--readOnly` rather than the connection string.

This filter is heuristic. If you run a server whose *plain* arguments are
themselves sensitive, set `showDisabled: false` and review what the route
returns before exposing DSH beyond localhost:

```bash
curl 127.0.0.1:3080/dsh-mcp-live-status/status
```

## Compatibility

- DeepSeek Harness `0.1.0-rc.7` (developed and verified against this version)
- Profile: `web` (the plugin targets the browser UI; `platform: web`)
- Requires `webServer`. `loader` and `tools` are read opportunistically through
  `ctx.reflect.get()` — a profile missing either still boots, it just reports
  less.
- No dependency on `dsh-typert-loader` or `dsh-api-gateway`.

## Known limitations

- **Needs a session.** `conversation.input.left` is session-scoped and the shell
  passes it no zone until a session exists. In practice the pill is visible from
  the new-session screen onward, because picking a workspace creates the
  session — but on a truly session-less screen it renders nothing.
- **Polling, not push.** mcp-client emits no status events, so there is nothing
  to subscribe to. The readout can be up to one interval stale.
- **`no-tools` is inference, not a probe.** A server that genuinely publishes
  zero tools is indistinguishable from one that never connected. Both are
  amber. The plugin never opens its own MCP connection to check.
- **Counts tools, not health.** A server that connected and then went silent
  keeps its last registered tool generation until mcp-client's reconnect budget
  runs out.

## Development

```bash
npm install
npm run build          # tsc — host half only; the browser half is plain JS
dsh plugin --profile web add ./dsh-mcp-live-status
dsh --profile web --dump-config | grep -A2 dsh-mcp-live-status
```

`dist/` is committed on purpose. pnpm blocks a git dependency's `prepare`
script by default, and the `allowBuilds` key it asks for is pinned to the commit
hash — so building on install would make every user paste a new key on every
release. Run `npm run build` before committing a change to `src/`.

The two halves are independent:

- `src/index.ts` → `dist/index.js` — Node side; collects status, serves the route.
- `lib/client.js` — browser side; hand-written CJS factory, no build step, no
  JSX. The module loader discovers it from `exports["./client"]` +
  `dsh.client` and serves it at `/plugins/dsh-mcp-live-status/client.js`.

To reproduce the amber state, add a server pointing at a command that does not
exist and leave `failOnStartupError: false`.

## License

MIT
