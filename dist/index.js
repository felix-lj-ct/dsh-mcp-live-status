import Schema from '@deepseek-ai/schemastery';
/** Plugin display name, shown in loader diagnostics. */
export const name = 'dsh-mcp-live-status';
/**
 * `webServer` carries the HTTP seam the browser half fetches; `loader` is the
 * configured-plugin tree. `tools` is deliberately NOT required: a profile
 * without it still gets a useful phase-only answer instead of a plugin that
 * never activates.
 */
export const inject = ['webServer', 'loader'];
/** The module specifier every MCP server entry is an instance of. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client';
/** HTTP path the browser half polls. */
const STATUS_PATH = '/dsh-mcp-live-status/status';
export const Config = Schema.object({
    pollIntervalMs: Schema.number().default(10000),
    showDisabled: Schema.boolean().default(false),
});
/**
 * Runtime mirror of Cordis's `FiberState` const enum. A const enum is erased at
 * compile time, so a cross-package consumer cannot import the values — the
 * official `dsh-host-plugin-inventory` mirrors it the same way.
 */
const FIBER_STATE = {
    PENDING: 0,
    LOADING: 1,
    ACTIVE: 2,
    FAILED: 3,
    DISPOSED: 4,
    UNLOADING: 5,
};
/** Public projection of the fiber lifecycle; DISPOSED reads as "no live root". */
const FIBER_PHASE = {
    [FIBER_STATE.PENDING]: 'pending',
    [FIBER_STATE.LOADING]: 'loading',
    [FIBER_STATE.ACTIVE]: 'active',
    [FIBER_STATE.FAILED]: 'failed',
    [FIBER_STATE.DISPOSED]: null,
    [FIBER_STATE.UNLOADING]: 'unloading',
};
/** Read a string field from an unknown config bag without trusting its shape. */
function readString(bag, key) {
    if (typeof bag !== 'object' || bag === null)
        return undefined;
    const value = bag[key];
    return typeof value === 'string' ? value : undefined;
}
/** Flag names whose VALUE is a secret, so the following argument must go too. */
const SECRET_FLAG = /(pass|pwd|token|secret|key|auth|cred|conn|dsn|uri|url)/i;
/**
 * Decide whether one stdio argument is safe to show.
 *
 * MCP servers are launched with their credentials on the command line as a
 * matter of routine — a Mongo server takes `--connectionString
 * mongodb+srv://user:pass@host`, an API server takes `--token abc`. This
 * payload is fetched by a browser and rendered into a tooltip, so any
 * credential in `args` would be published to the page. The rule is therefore
 * deny-by-suspicion: anything shaped like a URI, an embedded userinfo, or a
 * long opaque blob is dropped, and so is the value after a secret-named flag.
 */
function isSafeArg(arg) {
    if (arg.length > 40)
        return false;
    if (arg.includes('://'))
        return false;
    // `user:pass@host` — userinfo without a scheme. Note this must NOT reject a
    // bare `@`: npm specs are full of them (`mcp-remote@latest`, `@scope/pkg`),
    // and dropping those turns a useful line into a useless `npx -y`.
    if (/[^:\s]*:[^@\s]*@/.test(arg))
        return false;
    if (/^-/.test(arg))
        return true;
    // A bare token-looking blob: long, and without the separators a human writes.
    if (/^[A-Za-z0-9_+/=]{24,}$/.test(arg))
        return false;
    return true;
}
/**
 * Describe where a server comes from, for display only.
 *
 * Deliberately lossy on both transports: stdio `env` is never read, stdio args
 * are filtered by {@link isSafeArg}, and an HTTP URL keeps only origin +
 * pathname (`URL.origin` also drops any userinfo). What survives is enough to
 * recognise a server — `npx -y mongodb-mcp-server --readOnly` — and nothing
 * that is worth stealing.
 */
function describeTarget(config) {
    const url = readString(config, 'url');
    if (url) {
        try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
        }
        catch {
            // Unparseable: show nothing rather than guess where the secret ends.
            return '';
        }
    }
    const command = readString(config, 'command');
    if (!command)
        return '';
    const rawArgs = config?.['args'];
    const args = Array.isArray(rawArgs) ? rawArgs.filter((a) => typeof a === 'string') : [];
    const shown = [];
    let skipNext = false;
    for (const arg of args) {
        if (skipNext) {
            skipNext = false;
            continue;
        }
        if (/^--?[A-Za-z]/.test(arg) && SECRET_FLAG.test(arg)) {
            // `--connectionString <secret>` — drop the flag and its value together.
            // An inline `--token=abc` has no following value to skip.
            skipNext = !arg.includes('=');
            continue;
        }
        if (isSafeArg(arg))
            shown.push(arg);
    }
    return [command, ...shown].join(' ');
}
/**
 * Assign each registered tool to the server whose namespace prefix it carries.
 *
 * Longest prefix wins. `serverName` allows underscores, so servers named `foo`
 * and `foo__bar` can coexist and `mcp__foo__bar__baz` is a legal tool of
 * either — the longer namespace is the owner.
 */
function countToolsByServer(toolNames, serverNames) {
    const counts = new Map(serverNames.map((s) => [s, 0]));
    const prefixes = serverNames
        .map((server) => ({ server, prefix: `mcp__${server}__` }))
        .sort((a, b) => b.prefix.length - a.prefix.length);
    for (const toolName of toolNames) {
        const owner = prefixes.find(({ prefix }) => toolName.startsWith(prefix));
        if (owner)
            counts.set(owner.server, (counts.get(owner.server) ?? 0) + 1);
    }
    return counts;
}
/** Join mount phase and tool evidence into the single verdict the UI renders. */
function resolveState(enabled, phase, toolCount) {
    if (!enabled)
        return 'disabled';
    if (phase === 'failed')
        return 'failed';
    if (phase === 'pending' || phase === 'loading')
        return 'starting';
    if (phase === null || phase === 'unloading')
        return 'unmounted';
    // phase === 'active'. Without a tool registry we cannot prove connectivity,
    // so report the mount rather than inventing a healthy-looking answer.
    if (toolCount === null)
        return 'connected';
    return toolCount > 0 ? 'connected' : 'no-tools';
}
export function apply(ctx, config) {
    const webServer = ctx.webServer;
    /**
     * Read a service without declaring a dependency on it.
     *
     * `ctx.<name>` only resolves for services listed in `inject`, so a plugin
     * that merely wants to look at `tools` would have to require it — and then
     * never activate in a profile without one. `reflect.get` is the non-binding
     * read: present means present, absent means absent.
     */
    const optionalService = (serviceName) => {
        try {
            return ctx.reflect.get(serviceName) ?? undefined;
        }
        catch {
            return undefined;
        }
    };
    const collect = () => {
        const loader = optionalService('loader');
        const tools = optionalService('tools');
        let toolNames = null;
        try {
            toolNames = tools ? tools.schemas().map((s) => s.name) : null;
        }
        catch {
            // A tool-registry failure must not take the whole readout down; degrade
            // to phase-only and let the payload say so.
            toolNames = null;
        }
        const found = [];
        for (const entry of loader?.entries() ?? []) {
            if (entry.options.group)
                continue;
            if (entry.options.name !== MCP_CLIENT_MODULE)
                continue;
            // Prefer the fiber's validated config: it is post-schema, so defaults are
            // applied and `!!js` expressions are already evaluated. Fall back to the
            // raw options for an entry that never mounted.
            const cfg = entry.fiber?.config ?? entry.options.config;
            const enabled = !entry.disabled;
            found.push({
                entryId: entry.id,
                serverName: readString(cfg, 'serverName') ?? entry.id,
                transport: readString(cfg, 'transport') ?? 'unknown',
                target: describeTarget(cfg),
                enabled,
                fiberPhase: entry.fiber === undefined ? null : (FIBER_PHASE[entry.fiber.state] ?? null),
            });
        }
        const counts = countToolsByServer(toolNames ?? [], found.map((s) => s.serverName));
        const servers = found
            .filter((s) => config.showDisabled || s.enabled)
            .map((s) => {
            const toolCount = toolNames === null ? null : (counts.get(s.serverName) ?? 0);
            return { ...s, toolCount, state: resolveState(s.enabled, s.fiberPhase, toolCount) };
        });
        return {
            servers,
            configured: servers.length,
            connected: servers.filter((s) => s.state === 'connected').length,
            toolsUnavailable: toolNames === null,
            pollIntervalMs: config.pollIntervalMs,
            generatedAt: new Date().toISOString(),
        };
    };
    ctx.effect(() => {
        const dispose = webServer.register({
            kind: 'exact',
            path: STATUS_PATH,
            handler: (_req, res) => {
                let body;
                try {
                    body = JSON.stringify(collect());
                }
                catch (error) {
                    // Never 500 into the composer. An empty, honest payload renders as
                    // "no MCP configured", which is the safe reading.
                    ctx.logger?.warn?.('[dsh-mcp-live-status] status collection failed: %o', error);
                    body = JSON.stringify({
                        servers: [],
                        configured: 0,
                        connected: 0,
                        toolsUnavailable: true,
                        pollIntervalMs: config.pollIntervalMs,
                        generatedAt: new Date().toISOString(),
                    });
                }
                const buf = Buffer.from(body, 'utf8');
                res.writeHead(200, {
                    'content-type': 'application/json; charset=utf-8',
                    'content-length': buf.length,
                    'cache-control': 'no-store',
                });
                res.end(buf);
            },
        });
        return dispose;
    }, 'dsh-mcp-live-status: status route');
}
