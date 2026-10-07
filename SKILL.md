---
name: buildify-workflow-dev
description: >-
  Authors Buildify workflows from installed Bundle nodes: discover capabilities,
  canvas JSON, validate, test-run, deploy. Notes stay off except one per HTTP
  API (description and URL). Prefer the webhook trigger's inbound auth. Group
  only when more than two separate segments; group fill opacity 0.06. Use when
  the user builds or publishes a flow, or mentions CommentNode,
  批注, notes 节点, commentMarkdown, 节点分组, parentNode, direction, 横排, 竖排,
  排版, 连线标签, 多段, 独立接口, 入口验证, 接口说明, 访问地址.
---

# Buildify Flow 编排

用已安装的 Bundle 节点编排工作流：发现能力、读节点表单与文档、引用已有凭证、生成 canvas JSON、
校验、保存草稿、同步试跑，试跑通过后**自动发布**到用户已确认的服务器，并汇总发布信息。

本 skill 与 `buildify-bundle-dev` 职责互斥：那个是「做节点」，这个是「用节点编流程」。
编排时若 `bundle list` / `bundle nodes` 里没有实现需求的软件包或节点，**停下来提示用户去 bundle-dev 实现并发布**，不要在本 skill 里编造节点或改写 Bundle 源码。

权威接口是 `buildify` CLI（`pip install buildify-cli`），它调 `buildify-open-api-server`。
不要直接猜 REST 路径，先 `buildify help`。

## 工作流

复制清单并逐项勾选：

```
流程编排进度：
- [ ] 1. 确认 CLI 已配置（`buildify --json key test`）。`missing_api_key` 则请用户签发并用 `config add-profile` 保存；`profile_required` 则问一次工作区，之后命令加 `--profile`。细则见 [reference/cli.md](reference/cli.md)
- [ ] 2. 改已有：用这条流程所在的项目和这条流程，不要再问。新建：用户没点名项目才 `project list` 让他选；没说新建还是改哪条才 `workflow list` 问。已经点名的直接用
- [ ] 3. 服务器同样：流程上已绑定的、或用户已经点名的，直接用。都没有才列出 worker（名称 + 描述 + 在线状态）让他选。画布方向默认 `TB`，试跑后默认发布；只有还在问别的缺口时附一行，没提就用默认
- [ ] 4. 发现节点：`bundle list` → 只用到的包 `bundle nodes`。**当前环境没有对应软件包/节点时停止**，提示用户用 `buildify-bundle-dev` 实现并发布后再回来编流程；禁止臆造节点名。找到后再 **仅对将要放入画布的节点** 拉 `node-properties` / `node-relations`；`bundle doc` 只在参数含义不清时读
- [ ] 5. 凭证同样：草稿里该槽已经写了的、或用户已经点名的，直接沿用。只问还空着的槽，三选一：**使用已有** / **现在创建** / **使用时再选**。即使只有一条也不要直接绑；列表为空也不要自动创建。不要把密钥写进仓库或回显
- [ ] 6. 按 [reference/flow-json.md](reference/flow-json.md) 生成 canvas JSON。**两段及以上互不连线**（如两个独立接口，各有触发器）时按下文「多段画布」拆开生成再合并；只有一段、或一段里的成功/失败分支，本代理一次写完。**节点 `id` 用 `n-` + nanoid，流程内唯一**；顶层写 `errors`（先 `{}`）和 `direction`（默认 `TB` 竖排，用户要横排用 `LR`）；节点拷贝 `icon` / `label` / `isTrigger`；`summary` 写本流程职责且 **≤8 字**；**按 `direction` 排坐标并写执行节点 `sourcePosition` / `targetPosition`**，与控制台自动排版一致：卡片按 **248×63**，第一张从 `{x:45,y:24}` 起。`TB` 主链同一 x、`y += 153`（净空 90）、兄弟 `x += 298`（净空 50）、锚点 bottom→top；上一层出度 2 时下一层改为 `y += 183`，出度 ≥3 改为 `y += 199` 且兄弟 `x += 288`。`LR` 主链同一 y、`x += 388`（净空 140）、兄弟 `y += 135`（净空 72）、锚点 right→left；出度 2 不加长，出度 ≥3 改为 `x += 418` 且兄弟 `y += 119`。一层里有普通节点达到扇出时，下一层整层一起加长。不要按出口 label 个数再加长，也不要收到比这更短。出口文字由控制台摆在折线上（分叉时落在进入目标前的分支），不要为了拆开文字加大列距。**同一对 source+target 只有一条边**，接到同一下游的多个出口（如 Success+Failure）全部放进该边 `data.relations[]`，不要拆边；对象整份拷贝 `name`+`label`+`description`，MCP 自定义关系再带 `_id`/`icon`/`mcpKind`。**表达式按 `uiComponent` 写**：JSON（`JsonExpressionInput`）默认整字段 `"={{msg.xxx}}"` 以保留类型，只有要拼成字符串时才 `"=前缀 {{msg.xxx}}"`（`=` 必须在字符串最前，禁止 `this is ={{msg.title}}`，`{{ }}` 里不能运算）；SQL 用 `#{}` / `${}`，文本及其他用 `{{ }}`，见 [expressions.md](reference/expressions.md)。**JS 节点 `code` 分段并加中文注释**（入参/出参 + `// --- 段名 ---`），方便用户事后阅读。分支以不交叉为准：能干净汇合再共用；否则各支路沿主方向继续排，**必要时复制配置相同的节点**。**批注和分组按例外才加**（细则见下文「HTTP 接口」和 [flow-json.md](reference/flow-json.md)）。批注：用户要求，或分支/调用约定/`summary` 写不下且不写会误用，或**每个 HTTP 接口一张**（只写接口说明和访问地址）。分组：**多于两段**互不连线的独立逻辑（三段起）每段一个分组框；两段及以下默认不加，除非用户要求。分组背景写 `parameters.groupColor` 为 `#5b7c99`、`groupOpacity` 为 `0.06`（比控制台缺省 0.1 淡；不写就会更深）。批注放在被说明盒子外侧，按自身宽高留净空：单段 `TB` 时 `x = 最左外缘 - 批注宽 - 80`，单段 `LR` 时 `y = 最上外缘 - 批注高 - 80`（外缘含分组框，不含组内子节点）。多段时批注跟各自那段，放在不朝向相邻段的一侧。组内节点必须写 `parentNode` 指向分组框 id（只重叠坐标不算分组）；组内留白，首节点 `{x:40,y:60}`，组内比画布更紧（`TB` 的 `y += 119`、兄弟 `x += 292`；`LR` 的 `x += 344`、兄弟 `y += 111`）。框外下一节点按**框外缘**留空（竖向 +90，`LR` 沿流向 +140；并排的框 `TB` 间隙 50、`LR` 间隙 72），不要用组内步进贴着框
- [ ] 7. buildify workflow validate -p <proj> -f ./flow.json → 按 issues 修复，把表单 ERROR **按节点 id 汇总写入 JSON 顶层 `errors`**（通过 `"errors":{}`，未通过 `"errors":{"n-k7mX2pL9":1}`），直到 valid=true 或用户明确稍后自填 / 选了「使用时再选」
- [ ] 8. 改已有则打开该草稿再 save-draft。新建用用户给的名称，没给就用建议名；还有没回复的缺口时不要 `workflow create`
- [ ] 9. 凭证已绑定时 `workflow test-run`，根据 nodes[].outputs / events 判断是否符合需求。选了「使用时再选」则停在草稿，不要试跑。选了「只保存草稿」时可以试跑，但不要进入步骤 10
- [ ] 10. 用户选了试跑后发布、且试跑成功后，请用户确认**版本号**和**发布说明**，再 `workflow deploy --wait --version-name … --remark …`（不要再传 -f / published），用返回的 `summary` 画表格
```

## 多段画布：分开生成再合并

一段 = 从一个触发器出发、彼此有边相连的那一组节点。两段之间没有边，就是两个独立部分。例如 `GET /orders` 和 `POST /refund` 各是一条 Webhook → 处理 → 应答。

| 怎么生成 | 何时 |
|---|---|
| 本代理一次写完 | 只有一段；或一段里的成功/失败分支、复制下游。分支不要再拆给另一个子任务 |
| 按段拆开，再由本代理合并 | **两段及以上**、且段与段之间没有边 |

拆开前，本代理先做完全画布共用的事：项目、流程、服务器、凭证按下文「沿用已有」定好（缺的才问），拉齐各节点的 `node-properties` / `node-relations`，定好顶层 `direction`。然后为**每一段**分配：

- 一组流程内唯一的 `n-` + nanoid（这段里的节点、以及这段若要复制的下游，都用这组 id）
- 这段要用的节点 schema（`icon` / `label` / `uiComponent` / relations），避免子任务再猜
- 用户已确认要绑定的凭证 `{type, name}`；选了「使用时再选」或没有槽位就不要写 `credentials`

每一段交给一个子任务（`generalPurpose`），只返回 `{ "nodes": [], "edges": [] }`：

- 坐标从局部原点 `(0, 0)` 起，段内用画布步进但不要加边距 45/24（`TB` 主链 `y += 153`、兄弟 `x += 298`，出度 2 的下一层 `y += 183`；`LR` 主链 `x += 388`、兄弟 `y += 135`）
- 用本代理给的 id，边只连本段的节点
- 不写顶层 `direction` / `errors` / `viewport`，不加批注、不加分组框
- 不调用 save-draft / test-run / deploy，不改选项目或凭证

**只有本代理写 `flow.json`。** 合并时：拼上各段的 `nodes` 和 `edges`，检查 id 不重复、边不跨段；按 [flow-json.md](reference/flow-json.md)「多段并列」把每段平移到自己的位置；顶层只写一份 `direction` 和 `errors`。接口批注和分组在合并之后由本代理加，不要让子任务各贴一张。**多于两段**时每段套一个分组框（背景 `groupOpacity: 0.06`），并把段内坐标改成相对框的 `position`、写上 `parentNode`。每个 HTTP 接口再加一张批注（接口说明 + 访问地址）。然后照旧步骤 7–10。

## HTTP 接口

创建对外 HTTP 接口时，入口用当前环境里的 Webhook 触发器。目录名通常是 `WebhookTriggerNode`（口语 webTriggerNode），以 `bundle nodes` 为准，不要臆造。

**入口验证优先写在触发器上。** 先看 `node-properties`。表单有「入站认证」（字段 `authType`）时，用它校验调用方，不要再在下游加一个做同样校验的节点：

| `authType` | 凭证槽 | 何时 |
|---|---|---|
| `none` | 无 | 用户没要求校验，或内网 / 网关已经鉴权 |
| `httpBasic` | `httpBasicAuth`（HttpBasicAuth） | HTTP Basic |
| `apiKey` | `apiKey`（HeaderAuth） | 自定义 Header |
| `jwtAuth` | `jwtAuth`（JwtAuth） | `Authorization: Bearer` |

按 IP 限制访问时写触发器高级选项里的 `options.acl`，不要再单做一段 IP 判断。凭证槽仍按上文三选一，不要因为开了认证就自己挑一条。

**表单里没有「入站认证」/ `authType` 时，再单独实现**：在触发器下游加一个校验节点，节点必须是 `bundle nodes` 里真实存在的。没有能校验的节点就停下来，按「没有对应软件包」处理。不要把不存在的 `authType` 写进参数。

**每个接口一张批注**，不进分组。正文只写接口说明和访问地址，见 [comment-node.md](reference/comment-node.md)。访问地址的生产形式是 `http://{externalHost}:{httpPort}{path}`，测试在 path 前加 `/@test`。`externalHost`、`httpPort` 用已确认服务器在 `project workers` 里的字段；缺了就只写方法和 `parameters.path`，并注明完整地址是「服务器访问地址 + 路径」。不要编造域名。

## 项目 / 流程 / 服务器 / 凭证：沿用已有，只问缺的

这几项决定流程落在哪、改哪一条、跑在哪台机器、用哪套密钥。已经能确定的**直接用**，不要再问，也不要列成待确认。一次消息里只问还缺的项。

| | 改已有 | 新建，用户已经给了 | 还没有 |
|---|---|---|---|
| **项目** | 这条流程所在的项目 | 用户点的项目名 | `project list`，让他选 |
| **流程** | 这一条。打开草稿改，不要问新建还是改已有 | 用户给的名称 | 问新建还是改哪条。新建名没给时，建议名写在默认里 |
| **服务器** | 这条流程已绑定的那台 | 用户点的那台 | `project workers` 列出后让他选 |
| **凭证** | 草稿里该槽已经写了的 `{type, name}` | 用户点的那条 | 只问空槽 |

对用户只用名称。项目 id、workerId、hostname 留在内部。

**版式。** 对用户的话用下面这一套，不要改回「1) 2) 3)」或一整段破折号。一项都不用问时，不要发空表，按默认继续：画布竖排，试跑通过后发布。

- 二级标题点明这一步，下面一句说明回复什么
- 候选用表格。服务器状态写 🟢 在线 / ⚫ 离线
- 已经确定、不改就用的值放进 **将使用**，不要混进候选项
- 单元格里的 `|` 要转义

```markdown
## 请补充

回复要采用的名称即可。下表「将使用」里没提到的项会直接采用。

### 项目

| 名称 | 说明 |
| --- | --- |
| 测试项目 | 用于个人的测试使用 |
| 测试项目2 | 测试卷项目2 |

### 服务器

| 服务器 | 说明 | 状态 |
| --- | --- | --- |
| 本地java进程测试 | 测试专用 | 🟢 在线 |
| 火山测试服务器 | fsdf | 🟢 在线 |
| mac | — | ⚫ 离线，不能试跑或发布 |

### 将使用

| 项 | 值 |
| --- | --- |
| 流程 | 新建「当前时间 API」 |
| 画布 | 竖排 |
| 试跑之后 | 发布 |
```

改已有、只缺一个新槽时，不要再列出项目和流程：

```markdown
## 请选择访问凭证

槽位 `credentialsId` · Mysql。回复下面三种做法之一。

| 名称 | 类型 |
| --- | --- |
| 生产只读 | Mysql |

- **使用已有**「生产只读」
- **现在创建**
- **使用时再选**（保存草稿，稍后再在控制台选）
```

规则：

- 缺口还没回复前，不要 `workflow create` / `save-draft` / `test-run` / `workflow deploy`，也不要往 JSON 里写 `data.credentials`（用户选了「使用时再选」除外：那时故意不写）。
- 缺的时候不要自己挑第一条、唯一条、名称里带「本地/测试」的项。用户已经点了名，就用他点的，不要再列一遍候选项。
- 新建名没给时，用按需求起的短名当默认（如「当前时间 API」），写进「将使用」。不要另起一轮只问名字，也不要用没写给用户看过的名字直接 create。
- **项目**：save-draft 落在已经确定的那一个。保存后用下面的表，不要只写一句「已保存」。
- **流程**：改已有就打开该草稿。新建用用户给的名称；没给就用那行默认名。
- **服务器**：`workflow create --worker`、`test-run --worker`、`deploy --worker` 用同一台。离线的可以列出来，不能拿来试跑或发布；用户点了离线的要说明并请改选在线的。
- **画布方向**：没说横排就用 `TB`。
- **试跑后是否发布**：默认试跑通过后发布。用户要「只保存草稿」则步骤 9 之后停，不要问版本号去 deploy。
- **凭证**：只处理还空着的槽。先列出该类型实例，三选一。**即使只有一条，也不要直接写入 JSON。** 没有 `CredentialSelect` 就说「不需要访问凭证」，不要绑一条。Webhook 路径等节点参数仍按表单写进 JSON，校验 ERROR 再按节点汇总问，不要为每个字段单独打断一轮。

| 选项 | 做什么 |
|---|---|
| **使用已有** | 表格里点一条名称（只有一条也要用户说用它），再写 `data.credentials.<槽> = {type, name}` |
| **现在创建** | 走下面的 `create-credential`：展示默认 name/label 和表单，用户填完再建，再绑上 |
| **使用时再选** | **不写** `data.credentials`。校验会留下该槽 ERROR，写入顶层 `errors` 后只 save-draft。说明用户在控制台打开流程时再选。不要试跑、不要发布，除非用户之后补上凭证并再说试跑 |

- 列表为空时同样给「现在创建」和「使用时再选」，不要一发现空列表就自动创建。
- 选了「现在创建」→ 用 CLI 创建，**不要**让用户自己去控制台找入口（「使用时再选」除外）：
  1. 必须已确认**项目**（`-p` 必填）。
  2. `bundle cred-types` / `cred-properties` 取类型与表单；或直接跑
     `buildify --json project create-credential -p … -b … --type …`（不传 name/label/data），
     用返回的 `data.userMessage` / `defaults` / `parameters`。
  3. 用下面的版式：返回的 name、label 放进「将使用」；每个参数的中文名放进「请填写」（密钥类标明「密钥」）。
  4. 等用户确认。名称、显示名没提就用「将使用」；参数值没给齐不要创建。
  5. 用 stdin 创建，不要 `--data` 写在命令行、不要把 JSON 落到仓库、不要在回复里回显密钥：
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

**步骤 7 必须形成闭环**：`workflow validate` 退出码 4 表示还有 ERROR。按 `issues[].path` 定位，改 JSON 后重跑，直到 `valid: true`。不要跳过校验直接试跑。用户选了「使用时再选」时，凭证槽的 ERROR 写进顶层 `errors` 后 save-draft 即可，不要为了消掉它去猜一条凭证。
每次校验后把表单 ERROR **写回画布顶层 `errors`**：全部通过 `"errors":{}`；未通过按节点 id 汇总，例如 `"errors":{"n-k7mX2pL9":1}`（key=节点 `id`，value=该节点未通过字段数）。用这个 key 找到 `nodes[]` 里对应项，对照 `node-properties` 修 `data.parameters`，再重跑校验并把新的 `errors` 写入 JSON。用户明确稍后自填或选了「使用时再选」时，仍要写入当前汇总再 save-draft。`issues[].nodeId` 与此同一套 id。
`data.icon` 缺失、以及边上 `relations[]` 缺 `label` / 自定义关系缺 `icon` 只记 WARNING（退出码仍为 0），但也要修：从 `bundle nodes` / `node-relations` 原样拷贝，否则控制台节点图标或连线出口文字/图标不正确。

## 环境里没有对应软件包 / 节点

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。

判定「没有」：

- `bundle list`（可加 `-k` 关键词）里没有能覆盖需求的软件包；或
- 包在，但 `bundle nodes` 展平结果里没有要用的节点类型。

此时**立刻停止**编 JSON / validate / 试跑 / 发布，向用户说明缺口，并请他用 `buildify-bundle-dev` 实现后发布，再回到本 skill 从步骤 4 继续。不要在本会话里偷偷写 Bundle 代码（除非用户明确说「那就去做这个 Bundle」）。

示例：

```markdown
## 缺少节点

当前工作区没有能实现「xxx」的软件包。`bundle list` / `bundle nodes` 中未见某某。

### 相近能力

| 节点 | 说明 |
| --- | --- |
| 真实节点名 | 一句话 |

没有相近能力就不要编这张表。请先用 buildify-bundle-dev 开发并发布，控制台和 `buildify bundle list` 能看到之后，我再继续编排。需要的话我可以按 bundle-dev 做这个节点。
```

相近但不完全匹配时：列出真实节点，请用户选「改用现有」或「新做 Bundle」。未选定前不要往下写流程。

### 按任务读取（勿一次全读）

| 场景 | 读 / 做 |
|---|---|
| **命令与退出码** | [reference/cli.md](reference/cli.md)，或 `buildify help` |
| **写 / 改流程 JSON** | [reference/flow-json.md](reference/flow-json.md)。节点 `id` 用 **`n-` + nanoid**（如 `n-k7mX2pL9`），流程内唯一；顶层必写 `errors` 和 `direction`（默认 `TB`）；不要用 `n1` / `trigger` 这类可读名 |
| **参数里的表达式** | 先看该字段 `uiComponent`。JSON（`JsonExpressionInput`）默认整字段 `"={{msg.xxx}}"`，保留数字/布尔/对象/数组；要拼成字符串才写 `"=前缀 {{msg.xxx}}"`。`=` 必须是引号内第一个字符，禁止 `"this is ={{msg.title}}"`，`{{ }}` 里不能运算。变量缺失或中间层为空会变成 `""`。SQL（`SqlEditor`）用 `#{msg.xxx}` / `${msg.xxx}`；文本及其他用 `{{msg.xxx}}`。细则 [reference/expressions.md](reference/expressions.md)，权威 [JSON 表达式](https://docs.buildify.cn/concepts/json_expr.html)。**禁止**把 JSON 的 `=` 前缀写法写进 SQL |
| **JS 节点代码** | `JsFunctionNode` 的 `parameters.code` **必须分段 + 中文注释**，方便用户事后在控制台阅读。顶部说明入参/出参；每步用空行和 `// --- 段名 ---` 分开；关键取值、分支、`return` 旁写短注释。不要挤成一行、不要复述代码的废话注释。示例见 [expressions.md](reference/expressions.md)「JS 节点代码」 |
| **常见骨架** | [reference/recipes.md](reference/recipes.md)，节点名仍须用 CLI 向当前环境核实 |
| **节点 id（`n-` + nanoid）** | 每个节点（含批注、分组框、复制出来的节点、组内子节点）抽 `n-` + 8 位 nanoid，本流程内不重复。边的 `source` / `target` 引用同一 id。生成方式见 [flow-json.md](reference/flow-json.md) |
| **表单 `errors` 写入 JSON** | 顶层 `errors` 按节点 id 汇总。通过写 `"errors":{}`；未通过写 `"errors":{"n-k7mX2pL9":1}`。`workflow validate` 之后写回 canvas JSON 再 save-draft |
| **节点参数合法键** | `buildify bundle node-properties -b <bundle> -n <NodeName>`（顺带看 `uiComponent`，用来选表达式语法） |
| **没有对应软件包 / 节点** | 停止编排。提示用户用 `buildify-bundle-dev` 实现并发布，`bundle list` 能看到后再从步骤 4 继续。禁止臆造 name / bundleName |
| **节点图标 / 类型名** | `bundle nodes` 展平后的 `icon` / `label` / `isTrigger`（分组型来自 `groups_json[].nodes[]`，扁平型来自 `nodes_json`）；`node-properties` 也会带回这些字段。写入 `data.icon` / `data.label` 时**原样拷贝**，不要编造 URL，也不要把场景描述写进 `label` |
| **节点 summary（画布默认文案）** | **必写**。画布节点卡片默认显示 `data.summary`，不是 `label`。按本流程职责写**短词**，**≤8 字**（如「接收请求」「查询设备」「上传 OSS」），不要写路径/字段名/长句，也**不要照抄**目录通用 `summary` |
| **画布排列** | 顶层必写 `direction`，间距与控制台自动排版一致。卡片 **248×63**，第一张 `{x:45,y:24}`。**默认 `TB`**（主链同一 `x`，`y += 153`，兄弟 `x += 298`，锚点 bottom→top；出度 2 的下一层 `y += 183`，出度 ≥3 为 `y += 199` 且兄弟 `x += 288`）。横排用 **`LR`**（主链同一 `y`，`x += 388`，兄弟 `y += 135`，锚点 right→left；出度 ≥3 的下一层 `x += 418` 且兄弟 `y += 119`）。扇出加长作用于下一层整层，不要按 label 个数再加，也不要再收短。出口文字由控制台摆在折线上。能直连汇合再共用下游；否则各支路沿主方向排。**必要时复制配置相同的节点**（**新 `n-` + nanoid**），避免交叉。不要复制触发器。细则见 [flow-json.md](reference/flow-json.md) |
| **多段画布** | 一段 = 从一个触发器连出去、彼此有边的那一组。**两段及以上且互不连线**（如两个独立接口）时，每段交给一个子任务，只返回 `{nodes, edges}`（局部原点、本代理预分配的 id）；本代理拼进同一份 `flow.json`，按外接矩形错开：`TB` 顶对齐、下一段 `x = 上一段最右外缘 + 50`；`LR` 左对齐、下一段 `y = 上一段最下外缘 + 72`。同一深度共用流向坐标，层距取整图该层最大扇出。一段里的分支不要再拆。**多于两段**时合并后再给每段加分组框。见上文「多段画布」和 [flow-json.md](reference/flow-json.md)「多段并列」 |
| **HTTP 接口** | 入口用 Webhook 触发器（通常 `WebhookTriggerNode`）。**入口验证优先用表单「入站认证」`authType`**（及 `options.acl`）；表单没有该字段时才在下游单独做校验。每个接口一张批注：接口说明 + 访问地址。见上文「HTTP 接口」 |
| **批注便签** | **默认不加**，HTTP 接口除外（每接口一张，只写说明和访问地址）。其余仅当用户明确要求，或分支条件 / 调用约定 / 凭证用途等 **`summary` 写不下且不写会误用** 时才加。见 [flow-json.md](reference/flow-json.md)「批注节点」；字段见 [comment-node.md](reference/comment-node.md)。单段放在整图外侧：`TB` 时 `x = 最左外缘 - 宽 - 80`，`LR` 时 `y = 最上外缘 - 高 - 80`。多段时每张跟自己那段，放在不朝向相邻段的一侧。外缘用自由节点和**分组框**，不用组内子节点。不连线、`isLayoutNode: true`、不写 `parentNode`。禁止每个执行节点贴一张，禁止复述 `summary`。**不要用批注当分组框** |
| **节点分组** | **多于两段**互不连线的独立逻辑（三段起）才默认加，每段一个框；两段及以下默认不加，除非用户要求。分组框是 `type: group` 的布局节点；**组内组件必须写 `parentNode` 指向分组框 `id`**，`position` 相对分组框左上角。背景默认 `groupColor: "#5b7c99"`、`groupOpacity: 0.06`（范围 0.04–0.72；省略时控制台按 0.1，更深）。**留白不要贴边**（首节点 `{x:40,y:60}`，左/右 40，上 60，下 36）。组内更紧：`TB` 的 `y += 119`、兄弟 `x += 292`；`LR` 的 `x += 344`、兄弟 `y += 111`（出度 ≥3 才再加长）。框宽高 = 子节点包络 + 边距（单节点 **328×162**，且不小于 315×162）。**框外按框外缘留空**：下一顶层盒子 `y = 框 y + height + 90`（水平居中），`LR` 沿流向 `x = 框 x + width + 140`（垂直居中）。并排无连线的框：`TB` 间隙 50，`LR` 间隙 72。不要用组内步进贴着框。只重叠坐标、不写 `parentNode`，控制台不会真实分组。细则见 [flow-json.md](reference/flow-json.md)「节点分组」 |
| **连线 relation** | `buildify bundle node-relations -b <bundle> -n <NodeName>`。**同一 source+target 只有一条边**（`id`=`{source}_{target}`，`type: default`，`label: ""`，`zIndex: 2000`）。接到同一下游的多个出口（如 Success+Failure）全部放进这条边的 `data.relations[]`；去不同下游才拆成多条边。对象**整份**拷贝（至少 `name`+`label`+`description`）。MCP / RelationCollection 自定义关系还要拷 `_id`、`icon`、`mcpKind`，并同步到源节点 `data.relations`。结构见 [flow-json.md](reference/flow-json.md) |
| **项目 / 流程 / 服务器 / 凭证** | 见上文「沿用已有，只问缺的」。改已有用这条流程的项目、流程本身、已绑定的服务器和草稿里已写的凭证，不要再问。新建时用户已经点名的直接用。只问还没有的项；空凭证槽三选一：**使用已有** / **现在创建** / **使用时再选**，不要预选唯一项 |
| **凭证引用格式** | 用户选了「使用已有」或「现在创建」后填 `data.credentials.<槽> = {type, name}`；`type`/`name` 必须能在 `project credentials` 里找到。选了「使用时再选」则不写该槽 |
| **创建访问凭证** | 仅当用户选「现在创建」。必须 `-p` 项目。先展示默认 name/label 和 `cred-properties` 字段，用户确认并给参数后再 `project create-credential`（stdin 传 data）。禁止臆造密钥、禁止 `--data` 上 argv、禁止回显明文。列表为空时不要自动创建，仍问「现在创建」或「使用时再选」 |
| **发布 / 上线** | 用户选了试跑后发布、且试跑成功后，先确认版本号、发布说明，再 `workflow deploy --version-name --remark --wait`。用返回的 `summary` 画表格。不要再 `-f`，不要再 `published`。选了「只保存草稿」或「使用时再选」则停在草稿 |

## 自动发布与发布摘要

步骤 9 试跑成功（`data.success == true` 且 `reason` 不是 timeout）后，若用户在确认清单里选了**试跑通过后发布**，再发布到步骤 3 已确认的服务器。
用户选了「只保存草稿」，或凭证选了「使用时再选」：停在草稿，不要问版本号，不要 deploy。
草稿已在步骤 8 落库，**不要再传 flow.json**。

先把版本元数据按「将使用」回显，再 deploy。用户没指定版本号时，默认值用确认当下的本地时间：`v` + `yyyyMMdd-HHmmss`。发布说明按本流程写一句。

```markdown
## 准备发布

回复「发布」即按此发布。要改版本号或说明，直接写出新的；不要说明请回复「不要说明」。

| 项 | 值 |
| --- | --- |
| 版本号 | `v20261005-184620` |
| 发布说明 | 首次上线 /test2 当前时间接口 |
```

用户消息里已经写了版本号或说明，仍用这张表回显一次。未得到回复前不要 deploy。用户只说「发布」或「可以」，没改这两项，就用表里的值。

```bash
buildify --json workflow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v20261005-184620" --remark "首次上线 /test2 当前时间接口" --wait
```

没有特殊指定时必须带上 `--version-name`，值为上面确认过的 `v` + `yyyyMMdd-HHmmss`，不要改成 `v1.0.0`，也不要省略让服务端另起一版。用户指定了别的版本号就传用户的。省略 `--remark` 则该版本没有发布说明。这两项只写到**该发布版本**，不会改流程创建时的描述。

`--wait` 的 JSON 含 `versionName`、`publishRemark` 和完整 `summary`。直接用它画表格。

`workflow published` **只在**用户事后问「现在线上是哪一版」时再调。

规则：

- 版本号、发布说明：放在「准备发布」表里回显后再 deploy。用户没指定版本号时，默认是确认当下的本地时间 `v` + `yyyyMMdd-HHmmss`（如 `v20261005-184620`）。用户回复没改这两项，就用表里的值。`--version-name` 只作用于该发布版本；`--remark` 是发布说明，不是流程描述。这张表未回复不要 deploy。
- 试跑失败、超时、用户明确说「先不要发布」、确认清单选了「只保存草稿」、或凭证尚未绑定（「使用时再选」）→ 停在草稿，不要 deploy。试跑后又改了 JSON，先 `save-draft` 再 deploy。
- `--wait` 会在 CLI 内轮询到结束，Agent **不要**再循环调 `workflow deployment`。失败时退出码 4，把返回的 `summary.servers[].message` 原样告诉用户。
- 对用户说话只用名称：项目名、流程名、版本名、服务器表格里的 `workerName`。不要甩 projectId / workerId / deploymentId，除非用户要排障。
- **汇报必须用下方 Markdown 表格 + 状态图标**，不要改回纯列表。优先用响应里的 `deployStatusIcon` / `onlineIcon`；没有则按下表映射。
- **不要输出节点相关信息**：不要写链路、节点表、`label` / `summary` / 触发类型 / `webhookPath`。响应里即使有 `summary.nodes` 也忽略。

发布完成后**原样按这个结构输出**（字段来自 **这一次** `workflow deploy --wait` 的 `data` / `data.summary`，不要为了填表再请求）：

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

### 服务器

| 服务器 | 描述 | 在线 | 部署 | 说明 |
| --- | --- | --- | --- | --- |
| 本地java进程测试 | 测试专用 | 🟢 在线 | ✅ 成功 | — |

### 凭证

未引用访问凭证
```

有凭证时只出下面这张表，不要再写「未引用」：

```markdown
| Bundle | 类型 | 名称 |
| --- | --- | --- |
| official/mysql | Mysql | 生产只读 |
```

图标约定（与 API `*Icon` 字段一致）：

| 含义 | 图标 | 何时 |
| --- | --- | --- |
| 成功 | ✅ | `deployStatus=success`；标题写「已发布」 |
| 成功有警告 | ⚠️ | `success_with_warnings`；标题「已发布（有警告）」 |
| 失败 | ❌ | `failed`；标题「发布失败」，说明列写 `message` |
| 超时 | ⏰ | `timeout` |
| 部署中 / 待部署 | 🔄 / ⏳ | `running` / `pending` |
| 已取消 | 🚫 | `canceled` |
| 在线 / 离线 | 🟢 / ⚫ | `isOnline` |

失败时标题用 `## ❌ 发布失败`，服务器表「部署」列写 `❌ 失败`，说明列填 `message`。保存草稿后用同一套表头，标题写「已保存」，不要再写节点：

```markdown
## 已保存

| 项 | 内容 |
| --- | --- |
| 项目 | 测试项目 |
| 流程 | 当前时间 API |
| 服务器 | 本地java进程测试 |
```

试跑结束后用同一套表。通过时标题写「试跑通过」，未通过写「试跑未通过」，「结果」列写一句结论。不要贴节点输出。

`workflow published` 只用来事后查询线上版本，同样用这套表格（仍不展示节点）。编排刚发布完不必再调。

## 工具（执行，勿读源码）

环境：Python 3.10+，已 `pip install buildify-cli`。

```bash
buildify help
printf '%s' 'keyId.secret' | buildify config add-profile "$PROFILE"
buildify --json key test
```

步骤 1 `buildify --json key test`：

- 退出码 0：使用返回的工作区。只有一把密钥时不必加 `--profile`。
- `data.reason=missing_api_key`：**停止编排**，把 `data.userMessage` 原样发给用户（控制台「空间设置 → 开放 API 密钥 → 创建」，明文只显示一次）。问一个简短 profile 名，用户把完整 `keyId.secret` 发来后：

```bash
printf '%s' "$KEY" | buildify config add-profile "$PROFILE"
buildify --json config profiles    # 无密钥
buildify --json key test
```

- `data.reason=profile_required`：**停止**，用表格问一次用哪个工作区（名称、tenantId、密钥名，无密钥）。之后每条命令加 `--profile <name>`。不要 `config use`，除非用户明确要改默认工作区。

```markdown
## 请选择工作区

| 名称 | 工作区 | 密钥 |
| --- | --- | --- |
| acme | t-xxxx | 开放 API |
```
- `data.reason=workspace_key_missing`：仓库 `.buildify-workspace` 指向的工作区本机没有密钥。向用户要这个工作区的密钥并 `add-profile`，不要改用别的工作区。
- 项目 404 且响应带 `tenantId` / `profile`：先问是不是工作区错了，再决定要不要在这里建项目。

**密钥安全：** 不要 `--api-key`、不要写进仓库 / `.env` / commit、不要在后续回复里回显明文。`add-profile` 不改默认工作区。`config set-key api_key` 只更新当前 profile。本 CLI 不能创建密钥。

机器可读输出一律加 `--json`，按退出码分支：`0` 成功，`2` 鉴权，`3` 本地 JSON/文件，`4` HTTP 4xx 或 validate 有 ERROR，`5` 网络。
