---
name: buildify-workflow-dev
description: >-
  Builds Buildify workflows from installed Bundle nodes with the buildify CLI:
  discovers bundles and node schemas, writes the canvas flow.json (layout,
  edges, expressions, comments, groups), binds credentials, validates, saves
  drafts, test-runs (HTTP webhooks via /@test) and deploys to a worker. Use
  when the user creates, edits, test-runs or publishes a Buildify workflow, or
  mentions 编排流程, 工作流, flow.json, 画布, Webhook 接口, HTTP 接口, 试跑,
  @test, 发布, 版本号, 凭证, 服务器, 节点管理, 批注, 节点分组, 横排, 竖排,
  连线标签, 多段, 独立接口, 入站认证, 访问地址, 飞书卡片, 失败告警. For
  building Bundle nodes use buildify-bundle-dev instead.
---

# Buildify 流程编排

用已安装的 Bundle 节点编排工作流：发现节点、写画布 JSON、校验、保存草稿、试跑，试跑通过后确认版本号再发布到已确认的服务器，并用表格汇报。

- 和 `buildify-bundle-dev` 分工：那个「做节点」，这个「用节点编流程」。不要在本 skill 里改写 Bundle 源码。
- 唯一接口是 `buildify` CLI（`pip install buildify-cli`），它调 `buildify-open-api-server`。不要猜 REST 路径，不清楚先 `buildify help`。
- 机器可读输出一律加 `--json`，按退出码分支（见 [reference/cli.md](reference/cli.md)「退出码」）。

## 工作流

复制清单并逐项勾选：

```
流程编排进度：
- [ ] 1. CLI 就绪：buildify --json key test（见「工作区与密钥」）
- [ ] 2. 定项目、流程（见「沿用已有，只问缺的」）
- [ ] 3. 定服务器；画布方向默认 TB，试跑通过后默认发布
- [ ] 4. 发现节点：bundle list → bundle nodes → 只对要放进画布的节点拉 node-properties / node-relations
- [ ] 5. 凭证：只问空槽，三选一
- [ ] 6. 生成 flow.json（见「生成画布 JSON」）
- [ ] 7. workflow validate 闭环，ERROR 按节点写回顶层 errors
- [ ] 8. save-draft（新建先 workflow create）
- [ ] 9. test-run（HTTP 接口先测访问地址，见「试跑 HTTP 接口」）
- [ ] 10. 确认版本号和发布说明 → workflow deploy --wait → 发布表
```

步骤补充：

- **2–5 缺什么才问什么**，同一次提问里问完。缺口没回复前不要 `workflow create` / `save-draft` / `test-run` / `deploy`。
- **4**：没有对应软件包或节点时停止，见「环境里没有对应节点」。`bundle doc` 只在参数含义不清时读。
- **8**：改已有就打开该草稿再 save-draft。新建用用户给的名称，没给就用展示过的建议名。
- **9**：凭证选了「使用时再选」则停在草稿，不试跑。用户选了「只保存草稿」可以试跑，但不进入步骤 10。
- **10**：只在试跑通过、且用户没选「只保存草稿」时进行。见「发布与汇报」。

## 按任务读取（勿一次全读）

| 场景 | 读 |
|---|---|
| 命令、参数、退出码、推荐循环、save-draft 冲突 | [reference/cli.md](reference/cli.md) |
| 画布 JSON 字段、坐标步进、边、批注、分组、多段并列、校验顺序 | [reference/flow-json.md](reference/flow-json.md) |
| 参数里的表达式（按 `uiComponent`）、JS 代码注释、飞书卡片与失败原因 | [reference/expressions.md](reference/expressions.md) |
| 批注节点字段、HTTP 接口批注正文 | [reference/comment-node.md](reference/comment-node.md) |
| 常见骨架：Webhook 应答、定时落库、分支复制、改已有、分组 | [reference/recipes.md](reference/recipes.md)（节点名仍须用 CLI 核实） |

## 生成画布 JSON（步骤 6）

按 [flow-json.md](reference/flow-json.md) 写。下面是最容易写错的硬规则；坐标数值的细则只在 flow-json.md。

- **节点 id**：每个新节点（含批注、分组框、复制出来的节点）用 `n-` + 8 位 nanoid，流程内唯一。不要用 `n1` / `trigger` 这类可读名。已有草稿的旧 id 不要改。边 `id` = `{source}_{target}`。
- **顶层**：必写 `direction`（默认 `TB`；用户要横排才 `LR`；改已有沿用草稿）和 `errors`（先 `{}`）。
- **节点字段**：`name` / `bundleName` / `bundleVersion` / `icon` / `label` / `isTrigger` 从 `bundle nodes` / `node-properties` 原样拷贝，不要编造图标 URL。`summary` 写这颗节点在本流程里的职责，**≤8 字**（如「接收请求」「查询设备」），画布默认显示它，不要照抄目录 `summary`。
- **坐标**：按 `direction` 排，与控制台自动排版一致（卡片 248×63，首张 `{x:45,y:24}`；`TB` 主链 `y += 153`，`LR` 主链 `x += 388`），执行节点写 `sourcePosition` / `targetPosition`。扇出加长和兄弟间距见 flow-json.md「画布排列」。不要按出口 label 个数加长，也不要收得比表里更短。
- **分支**：以不交叉为准。能沿流向干净汇合才共用下游；否则各支路复制一份配置相同的节点（新 id）。不要复制触发器。
- **边**：同一对 source+target 只有一条边；接到同一下游的多个出口（如 Success+Failure）全部放进这条边的 `data.relations[]`。relation 对象从 `node-relations` 整份拷贝（至少 `name` + `label` + `description`）；MCP 自定义关系再带 `_id` / `icon` / `mcpKind`，并同步到源节点 `data.relations`。
- **表达式**按字段 `uiComponent` 选语法：`JsonExpressionInput` 默认整字段 `"={{msg.xxx}}"` 保留类型，要拼字符串才写 `"=前缀 {{msg.xxx}}"`（`=` 必须是第一个字符，`{{ }}` 里不运算）；`SqlEditor` 用 `#{}` / `${}`；文本及其他用 `{{ }}`。见 [expressions.md](reference/expressions.md)。
- **JS 节点** `parameters.code` 分段并写中文注释：顶部写入参/出参，每段用 `// --- 段名 ---` 隔开。
- **批注默认不加。** 例外：每个 HTTP 接口一张（只写接口说明和访问地址）；用户要求；分支条件或调用约定在 `summary` 里写不下、不写会误用。放在被说明盒子外侧，不连线。
- **分组默认不加。** 多于两段互不连线的逻辑（三段起）时每段一个框，或用户要求时才加。组内节点必须写 `parentNode`；框背景写 `groupColor: "#5b7c99"`、`groupOpacity: 0.06`（省略时控制台按 0.1 画，更深）。
- **两段及以上互不连线**时按下一节生成。

## 多段画布：分开生成再合并

一段 = 从一个触发器出发、彼此有边相连的那一组节点。例如 `GET /orders` 和 `POST /refund` 各是一条 Webhook → 处理 → 应答，就是两段。

| 怎么生成 | 何时 |
|---|---|
| 主代理一次写完 | 只有一段；或一段里的成功/失败分支、复制下游。分支不要拆给子任务 |
| 按段拆给子任务，再由主代理合并 | 两段及以上，且段与段之间没有边 |

当前客户端没有子任务能力时，由主代理逐段生成，规则相同。

拆开前，主代理先做完全画布共用的事：项目、流程、服务器、凭证定好（缺的才问），拉齐各节点的 `node-properties` / `node-relations`，定好 `direction`。然后为每一段准备：

- 一组预分配的 `n-` + nanoid（段内节点和要复制的下游都用这组）
- 这段要用的节点 schema（`icon` / `label` / `uiComponent` / relations）
- 用户已确认的凭证 `{type, name}`；选了「使用时再选」或没有槽位就不写 `credentials`

每段交给一个 `generalPurpose` 子任务，只返回 `{ "nodes": [], "edges": [] }`：

- 坐标从局部原点 `(0, 0)` 起，段内按 flow-json.md「画布排列」步进，不加 45/24 边距
- 只用分配的 id，边只连本段节点
- 不写顶层 `direction` / `errors` / `viewport`，不加批注和分组框
- 不调用 save-draft / test-run / deploy，不改选项目或凭证

**只有主代理写 `flow.json`。** 合并时：拼上各段 `nodes` / `edges`，检查 id 不重复、边不跨段；按 flow-json.md「多段并列」平移各段（同一深度共用流向坐标，层距取整图该层最大扇出）；顶层只写一份 `direction` 和 `errors`。然后由主代理加分组（多于两段时）和每个 HTTP 接口的批注，再照常做步骤 7–10。

## 环境里没有对应节点

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。

判定「没有」：

- `bundle list`（可加 `-k` 关键词）里没有能覆盖需求的软件包；或
- 包在，但 `bundle nodes` 展平结果里没有要用的节点类型。

**包在、只是缺某个接口的专用节点时**，先看同包有没有通用调用节点（类名以 `ApiCall` 结尾，或 `bundle doc` 里有「通用调用」）。有就用它，按厂商文档和 `bundle doc` 填 `method` / `path` / `query` / `headers` / `body`，这不算臆造。

确实没有时**立刻停止**编 JSON / validate / 试跑 / 发布，说明缺口，请用户用 `buildify-bundle-dev` 实现并发布后再从步骤 4 继续。用户明确说「那就去做这个 Bundle」之前，不要在本会话里写 Bundle 代码。

```markdown
## 缺少节点

当前工作区没有能实现「xxx」的软件包。`bundle list` / `bundle nodes` 中未见某某。

### 相近能力

| 节点 | 说明 |
| --- | --- |
| 真实节点名 | 一句话 |

没有相近能力就不要编这张表。请先用 buildify-bundle-dev 开发并发布，控制台和 `buildify bundle list` 能看到之后，我再继续编排。需要的话我可以按 bundle-dev 做这个节点。
```

相近但不完全匹配时：每个真实节点一个选项，再加「新做 Bundle」。未选定前不要往下写流程。

## 项目 / 流程 / 服务器 / 凭证：沿用已有，只问缺的

已经能确定的**直接用**，不要再问，也不要列成待确认。一次消息里只问还缺的项。

| | 改已有 | 新建，用户已给 | 还没有 |
|---|---|---|---|
| **项目** | 这条流程所在的项目 | 用户点的项目 | `project list`，让他选 |
| **流程** | 这一条，打开草稿改 | 用户给的名称 | 问新建还是改哪条；新建名没给时建议名放第一项 |
| **服务器** | 用户点名的；没点名用 `workflow published` 的 `summary.servers` 里部署成功的那台（只用来确定服务器，不输出发布表） | 用户点的那台 | `project workers` 列出让他选 |
| **凭证** | 草稿里该槽已写的 `{type, name}` | 用户点的那条 | 只问空槽 |

对用户只用名称；项目 id、workerId、hostname 留在内部。`-p` / `-w` 传 public id（`p-…` / `w-…`），不要传中文名称。

**让用户定的项用点选，不要让他手打名称。** 能弹选择题时（如 Cursor 的 AskQuestion），缺的每一项一道题，放在同一次提问里；建议值放第一项，标签末尾写「推荐」；离线服务器可以列出，标签写「离线，不能试跑」。用户点完即采用，不要再让他复述。

一项都不用问时，不要为了画布方向或是否发布再弹一题，直接用默认：竖排、试跑通过后发布。正在问别的缺口时，把这两项也放进同一次提问。

没有选择题界面时，同一条消息里给编号，用户只回编号（如 `项目 1，服务器 2`）：

```markdown
## 请选择

直接点选。没点到的「推荐」项会直接采用。

**项目**
1. 测试项目 — 用于个人的测试使用
2. 测试项目2 — 测试卷项目2

**服务器**
1. 本地java进程测试 — 测试专用 — 在线
2. 火山测试服务器 — fsdf — 在线
3. mac — 离线，不能试跑

**流程**（推荐）
1. 新建「当前时间 API」
2. 改已有「订单查询」

**画布**（推荐）
1. 竖排
2. 横排

**试跑之后**（推荐）
1. 发布
2. 只保存草稿
```

规则：

- 缺的时候不要自己挑第一条、唯一一条、或名称里带「本地/测试」的项。
- 新建名没给时，按需求起一个短名（如「当前时间 API」）放进流程题第一项并标「推荐」。不要另起一轮只问名字，也不要用没展示过的名字直接 create。
- 服务器：`workflow create --worker`、`test-run --worker`、`deploy --worker` 用同一台。离线的不能试跑或发布；用户点了离线的要说明并请改选在线的。
- Webhook 路径等节点参数按表单写进 JSON，校验 ERROR 再按节点汇总一次问，不要为每个字段单独打断一轮。

### 凭证

只处理还空着的槽。节点表单没有 `CredentialSelect` 就说「不需要访问凭证」，不要绑。有槽时先 `project credentials` 列出该类型实例，每条已有实例一个选项，再加「现在创建」和「使用时再选」。**即使只有一条也要用户点它**；列表为空也不要自动创建。

```markdown
## 请选择访问凭证

槽位 credentialsId · Mysql

1. 使用已有「生产只读」
2. 现在创建
3. 使用时再选（保存草稿，稍后再在控制台选）
```

| 选项 | 做什么 |
|---|---|
| **使用已有** | 写 `data.credentials.<槽> = {type, name}`，`type` / `name` 必须能在 `project credentials` 里找到 |
| **现在创建** | 按下面流程用 CLI 创建再绑上，不要让用户自己去控制台找入口 |
| **使用时再选** | **不写** `data.credentials`。校验留下的该槽 ERROR 写入顶层 `errors` 后只 save-draft，说明用户在控制台打开流程时再选。不要试跑、不要发布，除非用户之后补上凭证再说试跑 |

「现在创建」：

1. 必须已确认项目（`-p` 必填）。
2. `bundle cred-types` / `cred-properties` 取类型与表单；或直接跑 `buildify --json project create-credential -p … -b … --type …`（不传 name/label/data），用返回的 `data.userMessage` / `defaults` / `parameters`。
3. 名称、显示名做成可改的默认，写进「将使用」；每个参数的中文名放进「请填写」（密钥类标明「密钥」）。密钥不能做成选项。
4. 等用户确认。名称、显示名没改就用推荐值；参数没给齐不要创建。
5. 用 stdin 创建，不要 `--data` 上命令行、不要把 JSON 落到仓库：
   `printf '%s' '{"host":"…"}' | buildify --json project create-credential -p "$PROJ" -b "$BUNDLE" --type "$TYPE" --name "$NAME" --label "$LABEL" --file -`
6. 成功后只用返回的 `label` / `name` / `type` 告诉用户已创建，并写入对应槽位。密钥不要出现在回复里。

```markdown
## 创建访问凭证

名称和显示名不改就用「将使用」。请填写参数。

### 将使用

| 项 | 值 |
| --- | --- |
| 名称 | `mysql-prod` |
| 显示名 | 生产库 |

### 请填写

| 参数 | 说明 |
| --- | --- |
| 主机 | |
| 端口 | |
| 密码 | 密钥 |
```

## 校验闭环（步骤 7）

`workflow validate` 退出码 4 表示还有 ERROR。按 `issues[].path` / `issues[].nodeId` 定位，对照 `node-properties` 修 `data.parameters`，重跑直到 `valid: true`。不要跳过校验直接试跑。

每次校验后把表单 ERROR **写回画布顶层 `errors`**：全部通过 `"errors":{}`；未通过按节点 id 汇总，如 `"errors":{"n-k7mX2pL9":1}`（value 是该节点未通过字段数，不计 WARNING）。用户明确稍后自填或选了「使用时再选」时，也要写入当前汇总再 save-draft，不要为了消掉凭证 ERROR 去猜一条凭证。

WARNING 不影响退出码，但也要修：`data.icon` 缺失、边上 `relations[]` 缺 `label`、自定义关系缺 `icon` / `_id`，都从 `bundle nodes` / `node-relations` 原样补齐，否则控制台图标和出口文字不对。

## HTTP 接口

入口用当前环境的 Webhook 触发器，目录名通常是 `WebhookTriggerNode`，以 `bundle nodes` 为准。

**入口验证优先写在触发器上。** `node-properties` 里有「入站认证」（字段 `authType`）时用它，不要在下游再加一个做同样校验的节点：

| `authType` | 凭证槽 | 何时 |
|---|---|---|
| `none` | 无 | 用户没要求校验，或内网 / 网关已经鉴权 |
| `httpBasic` | `httpBasicAuth`（HttpBasicAuth） | HTTP Basic |
| `apiKey` | `apiKey`（HeaderAuth） | 自定义 Header |
| `jwtAuth` | `jwtAuth`（JwtAuth） | `Authorization: Bearer` |

按 IP 限制访问写触发器高级选项 `options.acl`，不要再单做一段 IP 判断。开了认证后凭证槽仍按「凭证」三选一，不要自己挑一条。表单里没有 `authType` 时，才在触发器下游加一个真实存在的校验节点；没有能校验的节点就按「环境里没有对应节点」处理。不要把不存在的 `authType` 写进参数。

**每个接口一张批注**，不进分组，正文只写接口说明和访问地址（见 [comment-node.md](reference/comment-node.md)）。访问地址：生产 `http://{externalHost}:{httpPort}{path}`，测试在 path 前加 `/@test`。`externalHost` / `httpPort` 取已确认服务器在 `project workers` 里的字段；缺了就只写方法和 `parameters.path`，注明完整地址是「服务器访问地址 + 路径」，并提示到控制台「节点管理」设置。不要编造域名。

### 试跑 HTTP 接口

入口是 Webhook 触发器时，步骤 9 按这个顺序做：

1. **取访问地址。** 用已确认服务器的 `externalHost` / `httpPort`（`test-run` 返回里若带访问地址，以它为准），拼成 `BASE=http://{externalHost}:{httpPort}`。字段缺失时不要猜 hostname、`localhost` 或内网 IP，按第 3 步处理，原因写「该服务器还没有访问地址」。
2. **先测通不通。** 只测连接，不调业务路径：

   ```bash
   curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$BASE/"
   ```

   退出码 0 就算通（404 / 401 等任何 HTTP 状态码都算）。6（域名解析失败）、7（连接被拒绝）、28（超时）、35 / 60（TLS）算不通。
3. **不通就停下**，不要 `test-run`，也不要换别的地址重试。告诉用户地址和原因，再点选下一步：

   ```markdown
   ## 服务器访问地址不通

   火山测试服务器的访问地址 `http://1.2.3.4:8080` 从本机连不上（连接超时）。

   请确认服务器在运行，且端口已在防火墙 / 安全组放行；地址不对的话，到控制台「节点管理」里修改这台服务器的访问地址。

   1. 已处理，重新检测（推荐）
   2. 换一台服务器
   3. 先只保存草稿
   ```

   「重新检测」：重新拉 `project workers` 取地址，从第 2 步再来。「换一台」：按「沿用已有，只问缺的」列出服务器。「只保存草稿」：停在步骤 8。
4. **通了再试跑。** 后台启动 `test-run`，在它超时前向测试地址发一次请求，再等它返回：

   ```bash
   buildify --json workflow test-run -p "$PROJ" -f ./flow.json --worker "$WKR" --timeout 60 > /tmp/test-run.json &
   sleep 3
   curl -sS -X GET -w '\n%{http_code}' --max-time 30 "$BASE/@test/api/orders/123"
   wait
   ```

   测试地址 = `BASE` + `/@test` + 触发器 `parameters.path`，方法与触发器一致；路径参数（如 `:id`）换成示例值，请求体按需求造一条最小样例。触发器开了入站认证时，不要猜密钥、不要从凭证里取明文：请用户提供，或请他自己调测试地址，再等 `test-run` 结果。
5. 结合 `test-run` 的 `nodes[].outputs` / `events` 和这次 HTTP 响应判断是否符合需求，按「发布与汇报」的试跑表汇报。

## 通知与失败告警

- 失败告警的渠道以用户点名为准。没点名就问，选项是本流程已经在用的通知方式。不要把成功路径上的钉钉、飞书、邮件全部复制到失败分支；成功路径已有的通知不要因此删掉或改格式。
- `HttpRequestNode` 走 Failure 时上游字段还在，另带 `msg.error`（`code`、`message`，有时有 `statusCode`）。用 JS 组装告警正文，把 `code` 和 `message` 写在一起（如 `HTTP_IO_ERROR：ConnectException`）。
- 飞书卡片 `lark_md` 只稳定支持加粗、换行、链接，`###` 和行首 `- ` 会原样显示。钉钉和飞书正文分开组装，失败告警 header `template` 用 `red`。细则见 [expressions.md](reference/expressions.md)「飞书卡片与失败原因」。
- 要试跑失败出口时，另用一份**不保存**的画布把请求地址改成连不上的地址再 `test-run -f`，草稿里仍是原地址。

## 发布与汇报

步骤 9 试跑成功（`data.success == true` 且 `reason` 不是 timeout）后才进入发布，发布到步骤 3 确认的那台服务器。草稿已在步骤 8 落库，**不要再传 flow.json**。

以下情况停在草稿，不问版本号、不 deploy：试跑失败或超时；用户说先不发布；确认时选了「只保存草稿」；凭证选了「使用时再选」。试跑后又改了 JSON，先 `save-draft` 再 deploy。

**先点选确认版本元数据。** 版本号默认用确认当下的本地时间 `v` + `yyyyMMdd-HHmmss`；用户指定了就用他的，不要改成 `v1.0.0`，也不要省略让服务端另起一版。发布说明按本流程写一句。

```markdown
## 准备发布

版本号 `v20261005-184620`，说明「首次上线 /test2 当前时间接口」。

1. 按此发布（推荐）
2. 发布，但不要说明
3. 先不发布
```

要改版本号或说明时，用户选「其他」或在编号后写出新内容。未选择前不要 deploy。

```bash
buildify --json workflow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v20261005-184620" --remark "首次上线 /test2 当前时间接口" --wait
```

`--version-name` 和 `--remark` 只写到这个发布版本，不改流程描述。`--wait` 在 CLI 内轮询到结束，**不要**再循环调 `workflow deployment`。返回的 `versionName` / `publishRemark` / `summary` 直接用来画表；失败时退出码 4，把 `summary.servers[].message` 原样告诉用户。

### 汇报格式

- 已保存、试跑、已发布都用下面的 Markdown 表格 + 状态图标，不要改成纯列表。
- 只用名称（项目名、流程名、版本名、`workerName`），不要甩 projectId / workerId / deploymentId，除非用户要排障。
- 不要输出节点信息（链路、节点表、`label` / `summary` / 触发类型 / `webhookPath`），响应里有 `summary.nodes` 也忽略。HTTP 接口的访问地址例外。
- 字段来自**这一次** `deploy --wait` 的返回，不要为了填表再请求。刚发布完不要调 `workflow published`；用户事后问线上版本时才用它画同一套表。

```markdown
## ✅ 已发布

| 项 | 内容 |
| --- | --- |
| 项目 | 测试项目 |
| 流程 | 当前时间 API |
| 版本号 | `v20261005-184620` |
| 发布说明 | 首次上线 /test2 当前时间接口 |
| 总体 | ✅ 成功 |
| 发布时间 | 2026-09-21 09:30:00 |
| 访问地址 | `GET http://1.2.3.4:8080/test2` |

### 服务器

| 服务器 | 描述 | 在线 | 部署 | 说明 |
| --- | --- | --- | --- | --- |
| 本地java进程测试 | 测试专用 | 🟢 在线 | ✅ 成功 | — |

### 凭证

未引用访问凭证
```

「访问地址」只在 HTTP 接口时写，用**正式地址**（不带 `/@test`），多个接口每个一行；没有 `externalHost` / `httpPort` 时写「服务器访问地址 + `/test2`」，并提示到「节点管理」设置。有凭证时「凭证」下只出这张表：

```markdown
| Bundle | 类型 | 名称 |
| --- | --- | --- |
| official/mysql | Mysql | 生产只读 |
```

图标优先用响应里的 `deployStatusIcon` / `onlineIcon`，没有则按下表：

| 含义 | 图标 | 何时 |
| --- | --- | --- |
| 成功 | ✅ | `deployStatus=success`；标题「已发布」 |
| 成功有警告 | ⚠️ | `success_with_warnings`；标题「已发布（有警告）」 |
| 失败 | ❌ | `failed`；标题「❌ 发布失败」，「部署」列写 `❌ 失败`，说明列写 `message` |
| 超时 | ⏰ | `timeout` |
| 部署中 / 待部署 | 🔄 / ⏳ | `running` / `pending` |
| 已取消 | 🚫 | `canceled` |
| 在线 / 离线 | 🟢 / ⚫ | `isOnline` |

保存草稿后：

```markdown
## 已保存

| 项 | 内容 |
| --- | --- |
| 项目 | 测试项目 |
| 流程 | 当前时间 API |
| 服务器 | 本地java进程测试 |
```

试跑后标题写「试跑通过」或「试跑未通过」，「结果」写一句结论，不贴节点输出。HTTP 接口加「测试地址」（带 `/@test`）和「HTTP 状态」两行；访问地址不通时不出这张表，改用「试跑 HTTP 接口」第 3 步的提示。

```markdown
## 试跑通过

| 项 | 内容 |
| --- | --- |
| 项目 | 测试项目 |
| 流程 | 当前时间 API |
| 服务器 | 火山测试服务器 |
| 测试地址 | `GET http://1.2.3.4:8080/@test/test2` |
| HTTP 状态 | 200 |
| 结果 | 返回了当前时间 |
```

## 工作区与密钥（步骤 1）

环境：Python 3.10+，已 `pip install buildify-cli`。执行 CLI，不要读它的源码。

`buildify --json key test`：

- 退出码 0：用返回的工作区。只有一把密钥时不必加 `--profile`。
- `data.reason=missing_api_key`：**停止编排**，把 `data.userMessage` 原样发给用户（控制台「空间设置 → 开放 API 密钥 → 创建」，明文只显示一次）。问一个简短 profile 名，用户发来完整 `keyId.secret` 后：

  ```bash
  printf '%s' "$KEY" | buildify config add-profile "$PROFILE"
  buildify --json key test
  ```

- `data.reason=profile_required`：**停止**，每个 profile 一个选项（名称、tenantId、密钥名，不含密钥），点一次。之后每条命令加 `--profile <name>`。不要 `config use`，除非用户明确要改默认工作区。

  ```markdown
  ## 请选择工作区

  1. acme — t-xxxx — 开放 API
  2. beta — t-yyyy — 另一把密钥
  ```

- `data.reason=workspace_key_missing`：仓库 `.buildify-workspace` 指向的工作区本机没有密钥。向用户要这个工作区的密钥并 `add-profile`，不要改用别的工作区。
- 项目 404 且响应带 `tenantId` / `profile`：先问是不是工作区错了，再决定要不要在这里建项目。

**密钥安全：** 不要 `--api-key`；不要写进仓库、`.env` 或 commit；不要在回复里回显明文。本 CLI 不能创建密钥。
