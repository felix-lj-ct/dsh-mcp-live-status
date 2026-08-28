# DSH 对话页 MCP 运行状态插件 — 设计

日期：2026-08-28
状态：设计已确认，待实现

## 目标

在 DSH Web UI 的**对话页面**实时展示当前 profile 下 MCP 服务器的运行与连接状态，
让用户在按下发送键之前就知道「这一轮智能体手上有哪些 MCP 能力」。
以第三方插件形式发布，并提交到 DSH Plugin Hub。

## 一、为什么需要自己算状态

`@deepseek-ai/dsh-mcp-client` **不导出任何状态服务**——reconnect 状态只进日志。
唯一现成的 Remote 是 `pluginInventory/list`，返回 `entryId / moduleName / enabled / fiberPhase`。

它不够用，因为 mcp-client 默认 `failOnStartupError: false`：
**连不上服务器时，插件依然正常激活，`fiberPhase` 仍是 `active`**。
只看 fiberPhase 无法区分「连上了」和「起来了但连不上」。

真正的连接证据是**工具是否注册成功**：mcp-client 只有在握手 + `listTools()` 都成功后，
才会把工具以 `mcp__<serverName>__<rawName>` 注册到 `ctx.tools`。
所以状态判定需要同时读两个来源，做一次 join。

### 状态判定表

| loader entry | 已注册工具数 | 状态 | 颜色 |
|---|---|---|---|
| `disabled` | — | 已停用 | 灰（默认不展示） |
| fiber `failed` | — | 挂载失败 | 红 |
| fiber `pending` / `loading` | — | 启动中 | 蓝（脉冲） |
| fiber `active` | > 0 | 已连接 | 绿 |
| fiber `active` | 0 | 已启动，未连接 | 琥珀 |
| 无 fiber (`null`) | — | 未挂载 | 灰 |

琥珀那一行是这个插件真正的价值所在——官方设置页看不出这个状态。

## 二、传输层：HTTP 路由，不用 Typert Remote

评估过两条路：

**A. Typert Remote**（官方 `dsh-host-plugin-inventory` 走的路）。
可行——`dsh-typert-loader` 会自动扫描 loader entry 的 `package.json` → `exports["./typert"]`
并注册，manifest 是纯 JS 对象可手写，不需要 monorepo codegen；
前端 `ctx.remote.$mount()` 是公开方法。
但要引入 zod、手写两份 descriptor、并依赖 profile 里装了 `dsh-typert-loader` 和 `dsh-api-gateway`。

**B. `ctx.webServer` HTTP 路由 + 浏览器 `fetch()`**（官方 `create-dsh-plugin -t panel` 脚手架走的路）。
零额外依赖，一个 JSON 路由，前端一个 fetch。

**选 B。** 这是官方给第三方插件的推荐形态，活动部件更少，profile 依赖面更窄。
代价是丢掉了 Typert 的端到端类型校验——对一个只读的状态查询来说不值得那个复杂度。

## 三、架构

双半插件，两半独立部署：

```
┌─ HOST 半边（Node 进程，src/index.ts → dist/index.js）──────────┐
│                                                              │
│  inject: ['webServer', 'loader', 'tools']                    │
│                                                              │
│  collectMcpStatus():                                         │
│    for (const entry of ctx.loader.entries())                 │
│      if entry.options.name === '@deepseek-ai/dsh-mcp-client' │
│        → serverName  = entry.options.config.serverName       │
│          transport   = entry.options.config.transport        │
│          target      = command+args | url                    │
│          disabled    = entry.disabled                        │
│          phase       = entry.fiber?.phase ?? null            │
│                                                              │
│    const names = ctx.tools.schemas().map(s => s.name)        │
│    toolCount = names.filter(startsWith `mcp__${server}__`)   │
│                                                              │
│  ctx.webServer.register({                                    │
│    kind: 'exact', path: '/<pkg>/status', handler: json       │
│  })                        ← 装在 ctx.effect 里，卸载即注销     │
└──────────────────────────────────────────────────────────────┘
                              ↓ GET /<pkg>/status
┌─ BROWSER 半边（lib/client.js，手写 CJS factory，无构建）─────────┐
│                                                              │
│  window.__ModuleLoader__.load({ id, factory })               │
│  inject: ['slots', 'locale']                                 │
│                                                              │
│  ctx.slots.register({                                        │
│    name: 'conversation.input.left',   ← list / session scope │
│    id: 'mcp-status', order: 20, locale: NS                   │
│  }, McpStatusPill)                                           │
└──────────────────────────────────────────────────────────────┘
```

Host 半边通过 `cordis.patch.yml` 的 `insert` 行装进 profile；
浏览器半边**不需要 patch 行**——module loader 从 `package.json` 的
`exports["./client"]` + `dsh.client` 自动发现并挂载到 `/plugins/<pkg>/client.js`。

## 四、UI 设计

落点 `conversation.input.left`：输入框卡片内工具行，紧跟 `Full access` 之后。

选它的理由是语义归类——这一行现在放的是 `Full access`（权限）和模型选择器，
全都是「这一轮智能体手上有什么」。MCP 是工具能力的来源，属同一心智类别、
同一决策时刻。而且用户需要这个信息的瞬间，视线正在页面底部。

```
健康态 —— 不显示分母
  [+] [⏱ Full access ⌄] [● MCP 4]        [Gemini ⌄] [◌] [↑]

降级态 —— 分母此时才出现，琥珀色
  [+] [⏱ Full access ⌄] [● MCP 3/4]      [Gemini ⌄] [◌] [↑]

零配置 —— 整个 slot 不渲染，不占布局
  [+] [⏱ Full access ⌄]                  [Gemini ⌄] [◌] [↑]
```

**分母只在异常时出现**，是刻意的取舍：用户的扫视成本从「读两个数并比较」
降到「有没有斜杠」。健康态显示 `MCP 4/4` 会让每次扫视都付出一次比较。

点击弹出 popover（向上弹——下方是页面边缘）：

```
┌──────────────────────────────────┐
│ MCP 服务器                    ⟳  │
├──────────────────────────────────┤
│ ● mongodb-qa       stdio  12 工具 │
│ ● atlassian        stdio  34 工具 │
│ ● chrome-devtools  http    8 工具 │
│ ● figma            stdio         │
│   └ 已启动，未连接                 │
├──────────────────────────────────┤
│ 4 个已配置 · 3 个已连接    设置 →  │
└──────────────────────────────────┘
```

只读 + 手动刷新。不放重载/启停按钮：保持「只读观测」定位，
与官方设置页的插件管理职责不重叠，提交 Hub 时权限声明也更干净。

## 五、刷新策略

- 挂载时拉一次
- 之后每 10s 轮询一次，**仅在页面可见时**（`document.visibilityState === 'visible'`，
  监听 `visibilitychange` 暂停/恢复）
- 打开 popover 时立即拉一次
- 手动 ⟳ 立即拉一次

开销可忽略——host 侧就是遍历两个内存注册表，不做任何 I/O，不碰 MCP 连接本身。

## 六、错误处理

| 情况 | 行为 |
|---|---|
| fetch 失败 / 路由 404（host 半边未装） | 药丸整体不渲染，静默。不能因为自己坏了就在别人的输入框里显示错误 |
| host 侧 `ctx.loader` 遍历抛错 | 捕获，返回空列表 + `degraded: true`，前端不渲染 |
| 某个 entry 的 config 缺 `serverName` | 跳过该条，其余正常返回 |
| 组件渲染崩溃 | slot 的 entry error boundary 会接住并 abdicate 该 cell（框架能力，不需自己写） |

原则：这个插件寄生在别人的输入框里，任何自身故障都必须表现为「消失」而不是「报错」。

## 七、配置项

```ts
export interface Config {
  /** 轮询间隔（毫秒），0 表示关闭轮询只在挂载与手动刷新时拉取。 */
  pollIntervalMs: number   // default 10000
  /** 是否在药丸与列表中显示已停用的 MCP entry。 */
  showDisabled: boolean    // default false
}
```

用 `@deepseek-ai/schemastery` 导出同名 `Config` schema，默认值写在 schema 里。

## 八、验证方式

1. `npm run build` → tsc 编译 host 半边
2. `dsh plugin --profile web add ./<pkg>` 装入 profile
3. `dsh --profile web --dump-config` 确认 patch 行生效
4. `dsh --profile web` 启动，浏览器打开 127.0.0.1:3080
5. `curl 127.0.0.1:3080/<pkg>/status` 单独验证 host 半边
6. 手工制造降级态：在 cordis.yml 里加一个 command 指向不存在可执行文件的
   mcp-client entry，确认药丸变琥珀且分母出现

## 九、发布到 Plugin Hub

按 https://dsh-plugin.org/zh/submit 的三步：

1. GitHub 公开仓库
2. 打上 `dsh-plugin` topic
3. README 需含：一句话价值主张、可复制的安装命令
   （`dsh plugin --profile web add <pkg>`）、截图、权限与兼容性声明、License

免费，一个刷新周期内收录，只需要 GitHub 账号。
npm 发布是可选的——也可以只用 `github:<user>/<repo>` 安装。

## 十、明确不做（YAGNI）

- 不做 MCP 的启停/重载控制——那是设置页的职责
- 不做工具级明细列表（点开某个 server 看它 34 个工具叫什么）——对话页不是浏览工具的地方
- 不做历史记录 / 断线时间线
- 不做 Typert Remote 的类型化通道
- 不做「本次会话实际调用过哪些 MCP」——那是轨迹页的语义
