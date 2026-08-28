# dsh-mcp-live-status

[English](README.md) | 中文

**在输入框里看清哪些 MCP 真的连上了——在你按下发送键之前。**

一个 DeepSeek Harness 插件，把 MCP 实时状态药丸放进对话输入框的工具行，
紧挨着权限模式与模型选择器。

![输入框工具行里的 MCP 状态药丸](docs/screenshot.png)

## 为什么需要它

DSH 的设置页能告诉你某个 MCP 插件**挂载**了，但没法告诉你服务器**应答**了。

`@deepseek-ai/dsh-mcp-client` 默认 `failOnStartupError: false`——传输层从没连上的服务器，
Cordis fiber 状态照样是 `ACTIVE`。它在 UI 的每一处都显示正常。
你会在智能体调用它的工具时才发现它是死的，而那时任务已经跑到一半。

这个插件补的就是这个缺口，判据是唯一能证明握手成功的东西：**工具注册**。
mcp-client 只有在 `connect()` 和 `listTools()` 都成功之后，才会把
`mcp__<serverName>__<toolName>` 注册到 `ctx.tools`。
所以状态是两个来源的 join——Loader 说配了什么，对上工具注册表说到了什么。

| Loader entry | 已注册工具 | 展示为 |
|---|---|---|
| fiber `active` | > 0 | 🟢 已连接 |
| fiber `active` | 0 | 🟡 **已启动，未连接** ← 别处都看不出来的那个状态 |
| fiber `pending` / `loading` | — | 🔵 启动中 |
| fiber `failed` | — | 🔴 挂载失败 |
| 已停用 | — | ⚪ 已停用（默认不显示） |

## 安装

```bash
dsh plugin --profile web add github:felix-lj-ct/dsh-mcp-live-status
```

然后重启 profile：

```bash
dsh --profile web
```

药丸会出现在输入框工具行。没有配置任何 MCP 时它整个不渲染，不占布局。

## 长什么样

```
健康态 —— 不显示分母，因为分母不携带信息
  [+] [⏱ Full access ⌄] [● MCP 4]        [模型 ⌄] [↑]

降级态 —— 分母恰好在出问题时才出现
  [+] [⏱ Full access ⌄] [● MCP 3/4]      [模型 ⌄] [↑]
```

分母只在异常时出现，是刻意的取舍：用户的扫视成本从「读两个数并比较」
降到「有没有斜杠」。

点击药丸展开只读面板，列出每个服务器的传输方式、工具数，以及出问题时的原因：

```
┌──────────────────────────────────┐
│ MCP 服务器                    ⟳  │
├──────────────────────────────────┤
│ ● atlassian     stdio     31 工具 │
│ ● mongodb-qa    stdio     20 工具 │
│ ● broken-probe  stdio  已启动，未连接 │
├──────────────────────────────────┤
│ 3 个已配置 · 2 个已连接            │
└──────────────────────────────────┘
```

## 配置

可选，默认值对大多数人够用。

```yaml
- id: dsh-mcp-live-status
  name: dsh-mcp-live-status
  config:
    pollIntervalMs: 10000   # 0 表示关闭轮询（只在挂载与手动刷新时拉取）
    showDisabled: false     # 是否显示已停用的 Loader entry
```

轮询仅在浏览器标签页可见时进行。

## 权限与风险

只读。这个插件没有任何途径启动、停止、重载或改写 MCP 服务器配置——
服务器管理仍然归设置页。

| 接触面 | 做了什么 |
|---|---|
| `ctx.loader` | 只读遍历已配置的插件树 |
| `ctx.tools` | 只读工具**名称**；从不调用任何工具 |
| `ctx.webServer` | 注册一条 JSON 路由 `GET /dsh-mcp-live-status/status` |
| 网络 | 无外发。浏览器半边只 fetch 上面这条本地路由。 |
| 存储 | 无。不缓存、不记历史、不写文件。 |

**关于凭据。** MCP 服务器普遍把凭据直接写在命令行上
（`--connectionString mongodb+srv://user:pass@host`、`--token …`）。
因为状态 payload 会被浏览器拉取，参数值在离开宿主前会先过滤：
含 URI scheme 的、含 `user:pass@` userinfo 的、跟在疑似密钥名参数之后的
（`pass`/`token`/`key`/`secret`/`auth`/`conn`/`dsn`/`uri`/`url`）、
超过 24 字符的无分隔符串、以及超过 40 字符的，一律丢弃。`env` 完全不读。
HTTP 传输只保留 `origin + pathname`，query 与 userinfo 不会外泄。

结果是可识别但不可利用——显示 `npx -y mongodb-mcp-server --readOnly`，
而不是那串连接串。

这个过滤是启发式的。如果你的服务器**明文参数本身**就敏感，
在把 DSH 暴露到 localhost 之外前，请先自己看一眼这条路由返回了什么：

```bash
curl 127.0.0.1:3080/dsh-mcp-live-status/status
```

## 兼容性

- DeepSeek Harness `0.1.0-rc.7`（在此版本上开发并验证）
- Profile：`web`（插件面向浏览器 UI，`platform: web`）
- 必需 `webServer`。`loader` 与 `tools` 通过 `ctx.reflect.get()` 机会性读取——
  缺少其中任何一个 profile 仍能正常启动，只是报告的信息变少。
- 不依赖 `dsh-typert-loader` 或 `dsh-api-gateway`。

## 已知限制

- **需要有会话。** `conversation.input.left` 是 session scope，
  shell 在会话存在前不会传 zone。实际使用中从新建会话页开始就能看到药丸
  （因为选定 workspace 就会创建会话），但在真正无会话的界面上它不渲染。
- **轮询而非推送。** mcp-client 不发状态事件，没有可订阅的通道。
  读数最多滞后一个轮询间隔。
- **`no-tools` 是推断，不是探针。** 一个确实不提供任何工具的服务器，
  和一个从没连上的服务器无法区分，两者都显示琥珀色。
  插件绝不会自己另开一条 MCP 连接去探测。
- **数的是工具，不是健康度。** 连上后又静默的服务器，
  在 mcp-client 的重连预算耗尽之前，仍保留上一代已注册的工具。

## 开发

```bash
npm install
npm run build          # tsc —— 只编译 host 半边；浏览器半边是纯 JS
dsh plugin --profile web add ./dsh-mcp-live-status
dsh --profile web --dump-config | grep -A2 dsh-mcp-live-status
```

`dist/` 是刻意提交进仓库的。pnpm 默认拦截 git 依赖的 `prepare` 脚本，
而它要求的 `allowBuilds` key 绑定 commit hash——如果靠安装时构建，
每个用户在每次发版后都得重新粘一次那个 key。改 `src/` 后请先跑 `npm run build` 再提交。

两半彼此独立：

- `src/index.ts` → `dist/index.js` —— Node 侧，采集状态并提供路由。
- `lib/client.js` —— 浏览器侧，手写 CJS factory，无构建步骤、无 JSX。
  模块加载器从 `exports["./client"]` + `dsh.client` 自动发现它，
  并服务于 `/plugins/dsh-mcp-live-status/client.js`。

要复现琥珀态：加一个 command 指向不存在可执行文件的服务器，
并保持 `failOnStartupError: false`。

## License

MIT
