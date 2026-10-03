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
- [ ] 1. 确认 CLI 已配置（buildify --json key test；缺 key 则提示用户签发并保存到 ~/.buildifyrc）
- [ ] 2. 列出项目并请用户确认存放位置（project list → 展示 projectName）。用户没点名项目时列出候选项再等回复，禁止自作主张。确认项目后 `flow list`，问是**新建**还是**改已有**（新建给建议名可改）；未确认不要 `flow create`
- [ ] 3. 列出该项目全部 worker（workerName + 描述 + 在线状态）并请用户确认服务器。同一份确认里写上画布方向（没说横排则建议 `TB` 竖排，可改 `LR`）和试跑后是否发布（建议「试跑通过后发布」，可改「只保存草稿」）
- [ ] 4. 发现节点：`bundle list` → 只用到的包 `bundle nodes`。**当前环境没有对应软件包/节点时停止**，提示用户用 `buildify-bundle-dev` 实现并发布后再回来编流程；禁止臆造节点名。找到后再 **仅对将要放入画布的节点** 拉 `node-properties` / `node-relations`；`bundle doc` 只在参数含义不清时读
- [ ] 5. 按本流程实际用到的 bundle/类型列凭证。每个槽位请用户三选一：**使用已有** / **现在创建** / **使用时再选**。即使只有一条也不要直接绑；列表为空也不要自动创建。不要把密钥写进仓库或回显
- [ ] 6. 按 [reference/flow-json.md](reference/flow-json.md) 生成 canvas JSON。**两段及以上互不连线**（如两个独立接口，各有触发器）时按下文「多段画布」拆开生成再合并；只有一段、或一段里的成功/失败分支，本代理一次写完。**节点 `id` 用 `n-` + nanoid，流程内唯一**；顶层写 `errors`（先 `{}`）和 `direction`（默认 `TB` 竖排，用户要横排用 `LR`）；节点拷贝 `icon` / `label` / `isTrigger`；`summary` 写本流程职责且 **≤8 字**；**按 `direction` 排坐标并写执行节点 `sourcePosition` / `targetPosition`**：节点按约 240×88 的卡片占位，同层对齐。`TB` 主链同一 x、`y += 160`（卡片间净空约 72）、相邻列 `x` 相差 320（横向净空约 80）、锚点 bottom→top；`LR` 主链同一 y、`x += 360`（横向净空约 120，出口文字是横的）、相邻行 `y` 相差 160（竖向净空约 72）、锚点 right→left。一条边超过 2 个出口 label 时沿流向再加长（TB 每个 +36，LR 每个 +48）。沿流向不要再收：`TB` 的 `y` 步进不要小于 160，`LR` 的 `x` 步进不要小于 360。连线 label 画在**该边路径中点**，中点必须落在两张卡片之间、且只属于这一条边的空白里。**同一对 source+target 只有一条边**，接到同一下游的多个出口（如 Success+Failure）全部放进该边 `data.relations[]`，不要拆边；对象整份拷贝 `name`+`label`+`description`，MCP 自定义关系再带 `_id`/`icon`/`mcpKind`。**表达式按 `uiComponent` 写**：JSON（`JsonExpressionInput`）默认整字段 `"={{msg.xxx}}"` 以保留类型，只有要拼成字符串时才 `"=前缀 {{msg.xxx}}"`（`=` 必须在字符串最前，禁止 `this is ={{msg.title}}`，`{{ }}` 里不能运算）；SQL 用 `#{}` / `${}`，文本及其他用 `{{ }}`，见 [expressions.md](reference/expressions.md)。**JS 节点 `code` 分段并加中文注释**（入参/出参 + `// --- 段名 ---`），方便用户事后阅读。分支以不交叉为准：能干净汇合再共用；否则各支路沿主方向继续排，**必要时复制配置相同的节点**。**批注和分组按例外才加**（细则见下文「HTTP 接口」和 [flow-json.md](reference/flow-json.md)）。批注：用户要求，或分支/调用约定/`summary` 写不下且不写会误用，或**每个 HTTP 接口一张**（只写接口说明和访问地址）。分组：**多于两段**互不连线的独立逻辑（三段起）每段一个分组框；两段及以下默认不加，除非用户要求。分组背景写 `parameters.groupColor` 为 `#5b7c99`、`groupOpacity` 为 `0.06`（比控制台缺省 0.1 淡；不写就会更深）。批注放在被说明盒子外侧，按自身宽高留净空：单段 `TB` 时 `x = 最左外缘 - 批注宽 - 80`，单段 `LR` 时 `y = 最上外缘 - 批注高 - 80`（外缘含分组框，不含组内子节点）。多段时批注跟各自那段，放在不朝向相邻段的一侧。组内节点必须写 `parentNode` 指向分组框 id（只重叠坐标不算分组）；组内留白。框外下一节点按**框外缘**留空（竖向 +72、横向 +80，`LR` 沿流向 +120），不要用卡片步进贴着框
- [ ] 7. buildify flow validate -p <proj> -f ./flow.json → 按 issues 修复，把表单 ERROR **按节点 id 汇总写入 JSON 顶层 `errors`**（通过 `"errors":{}`，未通过 `"errors":{"n-k7mX2pL9":1}`），直到 valid=true 或用户明确稍后自填 / 选了「使用时再选」
- [ ] 8. 只用用户确认的流程：新建则 `flow create`（名称已确认），改已有则打开该草稿；save-draft
- [ ] 9. 凭证已绑定时 `flow test-run`，根据 nodes[].outputs / events 判断是否符合需求。选了「使用时再选」则停在草稿，不要试跑。选了「只保存草稿」时可以试跑，但不要进入步骤 10
- [ ] 10. 用户选了试跑后发布、且试跑成功后，请用户确认**版本号**和**发布说明**，再 `flow deploy --wait --version-name … --remark …`（不要再传 -f / published），用返回的 `summary` 画表格
```

## 多段画布：分开生成再合并

一段 = 从一个触发器出发、彼此有边相连的那一组节点。两段之间没有边，就是两个独立部分。例如 `GET /orders` 和 `POST /refund` 各是一条 Webhook → 处理 → 应答。

| 怎么生成 | 何时 |
|---|---|
| 本代理一次写完 | 只有一段；或一段里的成功/失败分支、复制下游。分支不要再拆给另一个子任务 |
| 按段拆开，再由本代理合并 | **两段及以上**、且段与段之间没有边 |

拆开前，本代理先做完全画布共用的事：确认项目 / 服务器 / 凭证，拉齐各节点的 `node-properties` / `node-relations`，定好顶层 `direction`。然后为**每一段**分配：

- 一组流程内唯一的 `n-` + nanoid（这段里的节点、以及这段若要复制的下游，都用这组 id）
- 这段要用的节点 schema（`icon` / `label` / `uiComponent` / relations），避免子任务再猜
- 用户已确认要绑定的凭证 `{type, name}`；选了「使用时再选」或没有槽位就不要写 `credentials`

每一段交给一个子任务（`generalPurpose`），只返回 `{ "nodes": [], "edges": [] }`：

- 坐标从局部原点 `(0, 0)` 起，段内用现有步进（`TB` 的 `y += 160`、列距 320；`LR` 的 `x += 360`、行距 160）
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

## 项目 / 流程 / 服务器 / 凭证：必须用户点选

这几项关系到**数据落到哪、改哪条流程、跑在哪台机器、用哪套密钥**。用户消息里没有点名项目或流程时，先 `project list` / 确认项目后 `flow list` 列出候选项，**用可读名称请用户选择并等回复**。未得到明确选择前，禁止 `flow create` / `save-draft` / `test-run` / `flow deploy`，也禁止往 JSON 里写 `data.credentials`（「使用时再选」除外：那时故意不写）。

不要默认第一项、唯一项、名称带「本地/测试」的项，或用户口语里含糊提到的环境。不要用需求摘要当流程名去 create。用户消息里已经点名了，仍要把完整名称回显请他确认一遍。

列出时带上 id，但**对用户说话用名称**：

| 选什么 | CLI | 展示字段 | 问法 |
|---|---|---|---|
| **项目**（流程存放位置） | `project list` | `projectName`、`remark`、`projectId` | 「流程将保存到哪个**项目**？例如「测试项目」」 |
| **流程**（新建或改已有） | 确认项目后 `flow list` | 流程名 | 「**新建**还是改已有？新建建议名「当前时间 API」（可改）」 |
| **服务器**（试跑/绑定 worker） | `project workers -p <proj>`（列出全部，不要只筛在线） | **对用户只显示** `workerName`、描述 `remark`、在线状态 `isOnline`。不要展示 hostname / workerId | 「在哪台**服务器**上试跑？例如「本地java进程测试」— 测试专用（在线）」 |
| **凭证**（节点密钥槽） | `project credentials -p <proj>`（可 `-b bundle` 收窄） | `label` 或 `name`、`type`、`bundleName`（**无密钥**） | 每个槽位三选一：**使用已有** / **现在创建** / **使用时再选** |

项目确认之后、开始写 JSON 之前，把下面几项写在**同一份清单**里。用户没提的给建议值，标「可改」；未回复前不要 create / save-draft / test-run / deploy。Webhook 路径等节点参数仍按表单写建议值进 JSON，校验 ERROR 再按节点汇总问，不要为每个字段单独打断一轮。

```
请确认，避免流程存错项目、改错流程或打到错误服务器/凭证：

1) 项目（流程将出现在该项目下）
   - 测试项目（p-krjfxeic）— 用于个人的测试使用
   - 测试项目2（p-j4xza62z）— 测试卷项目2

2) 流程（新建或改已有）
   - 新建「当前时间 API」（建议名，可改）
   - 已有：当前时间 API；订单查询

3) 服务器（选定项目后再列；格式：名称 — 描述 — 在线状态）
   - 本地java进程测试 — 测试专用 — 在线
   - 火山测试服务器 — fsdf — 在线
   - mac — （无描述） — 离线

4) 画布方向（可改）
   - 建议竖排 TB（没说横排时用这个；要横排请改 LR）

5) 试跑后是否发布（可改）
   - 建议：试跑通过后发布
   - 或：只保存草稿（不试跑后的自动发布）

6) 访问凭证（每个需要的槽位三选一；没有 CredentialSelect 则写「本流程不需要凭证」）
   - 槽 credentialsId（Mysql）
     已有：生产只读（name=prod-ro）
     请选：使用已有「生产只读」 / 现在创建 / 使用时再选
```

规则：

- **项目**：create / save-draft 只用用户确认的那一个；回复时写清「已保存到项目「测试项目」」。
- **流程**：步骤 8 只用用户确认的那一个。新建用已确认的名称 `flow create`；改已有则打开该草稿再 save-draft。未确认不要 create，也不要用需求摘要当流程名。
- **服务器**：对用户展示 `workerName` + `remark`（没有描述就写「无描述」）+ **在线/离线**。内部用 `workerId`，不要把 id/hostname 甩给用户。`flow create --worker`、`flow test-run --worker`、`flow deploy --worker` 用同一组用户指定的 worker。离线的可以列出来，但不能拿来试跑或发布；用户点了离线的要说明并请改选在线的。
- **画布方向**：没说横排就建议 `TB`，写进清单让用户改成 `LR`。未回复前不要写 JSON。
- **试跑后是否发布**：建议「试跑通过后发布」。用户要「只保存草稿」则步骤 9 之后停，不要问版本号去 deploy。
- **凭证**：节点有 `CredentialSelect` 时，先列出该类型实例。**即使只有一条，也不要直接写入 JSON。** 每个槽位请用户三选一：

| 选项 | 做什么 |
|---|---|
| **使用已有** | 列出名称请点一条（只有一条也要用户说用它），再写 `data.credentials.<槽> = {type, name}` |
| **现在创建** | 走下面的 `create-credential`：展示默认 name/label 和表单，用户填完再建，再绑上 |
| **使用时再选** | **不写** `data.credentials`。校验会留下该槽 ERROR，写入顶层 `errors` 后只 save-draft。说明用户在控制台打开流程时再选。不要试跑、不要发布，除非用户之后补上凭证并再说试跑 |

- 列表为空时同样给「现在创建」和「使用时再选」，不要一发现空列表就自动创建。
- 选了「现在创建」→ 用 CLI 创建，**不要**让用户自己去控制台找入口（「使用时再选」除外）：
  1. 必须已确认**项目**（`-p` 必填）。
  2. `bundle cred-types` / `cred-properties` 取类型与表单；或直接跑
     `buildify --json project create-credential -p … -b … --type …`（不传 name/label/data），
     用返回的 `data.userMessage` / `defaults` / `parameters`。
  3. **把默认 name、label 原样展示给用户**（可改），并列出每个参数的中文名（密钥类标明「密钥」）。
  4. 等用户确认名称并提供参数值。未确认禁止调用创建。
  5. 用 stdin 创建，不要 `--data` 写在命令行、不要把 JSON 落到仓库、不要在回复里回显密钥：
     `printf '%s' '{"host":"…"}' | buildify --json project create-credential -p "$PROJ" -b "$BUNDLE" --type "$TYPE" --name "$NAME" --label "$LABEL" --file -`
  6. 成功后只用返回的 `label` / `name` / `type` 告诉用户已创建，并写入对应槽位。
- 本流程确实没有 `CredentialSelect` 时，明确说「不需要访问凭证」，不要随便绑一条。

**步骤 7 必须形成闭环**：`flow validate` 退出码 4 表示还有 ERROR。按 `issues[].path` 定位，改 JSON 后重跑，直到 `valid: true`。不要跳过校验直接试跑。用户选了「使用时再选」时，凭证槽的 ERROR 写进顶层 `errors` 后 save-draft 即可，不要为了消掉它去猜一条凭证。
每次校验后把表单 ERROR **写回画布顶层 `errors`**：全部通过 `"errors":{}`；未通过按节点 id 汇总，例如 `"errors":{"n-k7mX2pL9":1}`（key=节点 `id`，value=该节点未通过字段数）。用这个 key 找到 `nodes[]` 里对应项，对照 `node-properties` 修 `data.parameters`，再重跑校验并把新的 `errors` 写入 JSON。用户明确稍后自填或选了「使用时再选」时，仍要写入当前汇总再 save-draft。`issues[].nodeId` 与此同一套 id。
`data.icon` 缺失、以及边上 `relations[]` 缺 `label` / 自定义关系缺 `icon` 只记 WARNING（退出码仍为 0），但也要修：从 `bundle nodes` / `node-relations` 原样拷贝，否则控制台节点图标或连线出口文字/图标不正确。

## 环境里没有对应软件包 / 节点

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。

判定「没有」：

- `bundle list`（可加 `-k` 关键词）里没有能覆盖需求的软件包；或
- 包在，但 `bundle nodes` 展平结果里没有要用的节点类型。

此时**立刻停止**编 JSON / validate / 试跑 / 发布，向用户说明缺口，并请他用 `buildify-bundle-dev` 实现后发布，再回到本 skill 从步骤 4 继续。不要在本会话里偷偷写 Bundle 代码（除非用户明确说「那就去做这个 Bundle」）。

示例：

```
当前工作区没有能实现「xxx」的软件包/节点。

已查：bundle list / bundle nodes，未见 <包名> 或节点 <NodeName>。
（若有相近能力，列 1～3 个真实名称，问要不要改用；没有就不要编。）

请先用 buildify-bundle-dev 开发并发布该 Bundle（控制台可见、`buildify bundle list` 能列出），
然后再回来编排流程。需要的话我可以按 bundle-dev 帮你做节点。
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
| **表单 `errors` 写入 JSON** | 顶层 `errors` 按节点 id 汇总。通过写 `"errors":{}`；未通过写 `"errors":{"n-k7mX2pL9":1}`。`flow validate` 之后写回 canvas JSON 再 save-draft |
| **节点参数合法键** | `buildify bundle node-properties -b <bundle> -n <NodeName>`（顺带看 `uiComponent`，用来选表达式语法） |
| **没有对应软件包 / 节点** | 停止编排。提示用户用 `buildify-bundle-dev` 实现并发布，`bundle list` 能看到后再从步骤 4 继续。禁止臆造 name / bundleName |
| **节点图标 / 类型名** | `bundle nodes` 展平后的 `icon` / `label` / `isTrigger`（分组型来自 `groups_json[].nodes[]`，扁平型来自 `nodes_json`）；`node-properties` 也会带回这些字段。写入 `data.icon` / `data.label` 时**原样拷贝**，不要编造 URL，也不要把场景描述写进 `label` |
| **节点 summary（画布默认文案）** | **必写**。画布节点卡片默认显示 `data.summary`，不是 `label`。按本流程职责写**短词**，**≤8 字**（如「接收请求」「查询设备」「上传 OSS」），不要写路径/字段名/长句，也**不要照抄**目录通用 `summary` |
| **画布排列** | 顶层必写 `direction`。节点按约 **240×88** 占位，同层对齐。**默认 `TB`**（主链同一 `x`，`y += 160`，相邻列 `x` 相差 **320**，锚点 bottom→top）；横排用 **`LR`**（主链同一 `y`，`x += 360`，相邻行 `y` 相差 **160**，锚点 right→left）。卡片之间只留标签能放下的净空：竖向约 72，`LR` 沿流向约 120。一条边超过 2 个出口 label 时沿流向再加长（TB 每个 +36，LR 每个 +48）。连线 label 在**该边中点**：中点落在两卡片之间的空白，相邻边的中点分开约 ≥160，不要压卡片、不要挤在同一个出口上。能直连汇合且中点彼此分开时再共用下游；否则各支路沿主方向排。**必要时复制配置相同的节点**（**新 `n-` + nanoid**），避免交叉。不要复制触发器。细则见 [flow-json.md](reference/flow-json.md) |
| **多段画布** | 一段 = 从一个触发器连出去、彼此有边的那一组。**两段及以上且互不连线**（如两个独立接口）时，每段交给一个子任务，只返回 `{nodes, edges}`（局部原点、本代理预分配的 id）；本代理拼进同一份 `flow.json`，按外接矩形错开：`TB` 顶对齐、下一段 `x = 上一段最右卡片右缘 + 80`；`LR` 左对齐、下一段 `y = 上一段最下卡片下缘 + 72`。一段里的分支不要再拆。**多于两段**时合并后再给每段加分组框。见上文「多段画布」和 [flow-json.md](reference/flow-json.md)「多段并列」 |
| **HTTP 接口** | 入口用 Webhook 触发器（通常 `WebhookTriggerNode`）。**入口验证优先用表单「入站认证」`authType`**（及 `options.acl`）；表单没有该字段时才在下游单独做校验。每个接口一张批注：接口说明 + 访问地址。见上文「HTTP 接口」 |
| **批注便签** | **默认不加**，HTTP 接口除外（每接口一张，只写说明和访问地址）。其余仅当用户明确要求，或分支条件 / 调用约定 / 凭证用途等 **`summary` 写不下且不写会误用** 时才加。见 [flow-json.md](reference/flow-json.md)「批注节点」；字段见 [comment-node.md](reference/comment-node.md)。单段放在整图外侧：`TB` 时 `x = 最左外缘 - 宽 - 80`，`LR` 时 `y = 最上外缘 - 高 - 80`。多段时每张跟自己那段，放在不朝向相邻段的一侧。外缘用自由节点和**分组框**，不用组内子节点。不连线、`isLayoutNode: true`、不写 `parentNode`。禁止每个执行节点贴一张，禁止复述 `summary`。**不要用批注当分组框** |
| **节点分组** | **多于两段**互不连线的独立逻辑（三段起）才默认加，每段一个框；两段及以下默认不加，除非用户要求。分组框是 `type: group` 的布局节点；**组内组件必须写 `parentNode` 指向分组框 `id`**，`position` 相对分组框左上角。背景默认 `groupColor: "#5b7c99"`、`groupOpacity: 0.06`（范围 0.04–0.72；省略时控制台按 0.1，更深）。**留白不要贴边**（首节点 `{x:48,y:72}`，左/右 ≥40，上 ≥64，下 ≥40；组内排版跟顶层 `direction`）。框宽高 = 子节点包络 + 边距（卡片 240×88；单节点 **328×200**）。**框外按框外缘留空**：下一顶层盒子 `y = 框 y + height + 72`，`x = 框 x + width + 80`（`LR` 沿流向 +120）。不要用卡片步进贴着框。只重叠坐标、不写 `parentNode`，控制台不会真实分组。细则见 [flow-json.md](reference/flow-json.md)「节点分组」 |
| **连线 relation** | `buildify bundle node-relations -b <bundle> -n <NodeName>`。**同一 source+target 只有一条边**（`id`=`{source}_{target}`，`type: default`，`label: ""`，`zIndex: 2000`）。接到同一下游的多个出口（如 Success+Failure）全部放进这条边的 `data.relations[]`；去不同下游才拆成多条边。对象**整份**拷贝（至少 `name`+`label`+`description`）。MCP / RelationCollection 自定义关系还要拷 `_id`、`icon`、`mcpKind`，并同步到源节点 `data.relations`。结构见 [flow-json.md](reference/flow-json.md) |
| **项目 / 流程 / 服务器 / 凭证（必问）** | 见上文「必须用户点选」。用户没点名项目或流程时先 list 再请选。项目用 **projectName**；流程问新建还是改已有（建议名可改，未确认不要 create）；服务器用 **workerName + 描述 + 在线/离线**；凭证每个槽位三选一：**使用已有** / **现在创建** / **使用时再选**（即使只有一条也不要直接绑）。同一份确认里写画布方向（默认 TB）和试跑后是否发布。未确认不得写入 |
| **凭证引用格式** | 用户选了「使用已有」或「现在创建」后填 `data.credentials.<槽> = {type, name}`；`type`/`name` 必须能在 `project credentials` 里找到。选了「使用时再选」则不写该槽 |
| **创建访问凭证** | 仅当用户选「现在创建」。必须 `-p` 项目。先展示默认 name/label 和 `cred-properties` 字段，用户确认并给参数后再 `project create-credential`（stdin 传 data）。禁止臆造密钥、禁止 `--data` 上 argv、禁止回显明文。列表为空时不要自动创建，仍问「现在创建」或「使用时再选」 |
| **发布 / 上线** | 用户选了试跑后发布、且试跑成功后，先确认版本号、发布说明，再 `flow deploy --version-name --remark --wait`。用返回的 `summary` 画表格。不要再 `-f`，不要再 `published`。选了「只保存草稿」或「使用时再选」则停在草稿 |

## 自动发布与发布摘要

步骤 9 试跑成功（`data.success == true` 且 `reason` 不是 timeout）后，若用户在确认清单里选了**试跑通过后发布**，再发布到步骤 3 已确认的服务器。
用户选了「只保存草稿」，或凭证选了「使用时再选」：停在草稿，不要问版本号，不要 deploy。
草稿已在步骤 8 落库，**不要再传 flow.json**。

先确认（或让用户改）版本元数据，再 deploy：

```
准备发布，请确认版本信息（可改）：

- 版本号：v1.0.0          （用户没指定时给建议值，如 v1.0.0 或当前时间戳；不要擅自用时间戳直接发布）
- 发布说明：首次上线 /test2 当前时间接口   （根据本流程写一句，用户可改或说「不要说明」）
```

用户消息里已经写了版本号/说明，仍要回显一遍再发。未得到回复前不要 deploy。

```bash
buildify --json flow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v1.0.0" --remark "首次上线 /test2 当前时间接口" --wait
```

省略 `--version-name` 时服务端会生成 `vyyyyMMdd-HHmmss`；省略 `--remark` 则该版本没有发布说明。这两项只写到**该发布版本**，不会改流程创建时的描述。

`--wait` 的 JSON 含 `versionName`、`publishRemark` 和完整 `summary`。直接用它画表格。

`flow published` **只在**用户事后问「现在线上是哪一版」时再调。

规则：

- 版本号、发布说明：deploy 前请用户确认或修改。`--version-name` 只作用于该发布版本；`--remark` 是发布说明，不是流程描述。未确认不要 deploy。
- 试跑失败、超时、用户明确说「先不要发布」、确认清单选了「只保存草稿」、或凭证尚未绑定（「使用时再选」）→ 停在草稿，不要 deploy。试跑后又改了 JSON，先 `save-draft` 再 deploy。
- `--wait` 会在 CLI 内轮询到结束，Agent **不要**再循环调 `flow deployment`。失败时退出码 4，把返回的 `summary.servers[].message` 原样告诉用户。
- 对用户说话只用名称：项目名、流程名、版本名、服务器表格里的 `workerName`。不要甩 projectId / workerId / deploymentId，除非用户要排障。
- **汇报必须用下方 Markdown 表格 + 状态图标**，不要改回纯列表。优先用响应里的 `deployStatusIcon` / `onlineIcon`；没有则按下表映射。
- **不要输出节点相关信息**：不要写链路、节点表、`label` / `summary` / 触发类型 / `webhookPath`。响应里即使有 `summary.nodes` 也忽略。

发布完成后**原样按这个结构输出**（字段来自 **这一次** `flow deploy --wait` 的 `data` / `data.summary`，不要为了填表再请求）：

```markdown
## ✅ 已发布

| 项 | 内容 |
| --- | --- |
| 项目 | 测试项目 |
| 流程 | 当前时间 API |
| 版本号 | `v1.0.0` |
| 发布说明 | 首次上线 /test2 当前时间接口 |
| 总体 | ✅ 成功 |
| 发布时间 | 2026-09-21 09:30:00 |

### 服务器

| 服务器 | 描述 | 在线 | 部署 | 说明 |
| --- | --- | --- | --- | --- |
| 本地java进程测试 | 测试专用 | 🟢 在线 | ✅ 成功 | — |

### 凭证

*本流程未引用访问凭证*
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

失败时标题用 `## ❌ 发布失败`，服务器表「部署」列写 `❌ 失败`，说明列填 `message`。有凭证时改成表格，列：Bundle、类型、名称（`label` 优先，无密钥）。单元格里的 `|` 要转义。

`flow published` 只用来事后查询线上版本，同样用这套表格（仍不展示节点）。编排刚发布完不必再调。

## 工具（执行，勿读源码）

环境：Python 3.10+，已 `pip install buildify-cli`。

```bash
buildify help
printf '%s' 'keyId.secret' | buildify config set-key api_key
buildify --json key test
```

步骤 1 `key test` 若退出码 2 且 `data.reason=missing_api_key`：**停止编排**，把 `data.userMessage` 原样发给用户
（控制台「空间设置 → 开放 API 密钥 → 创建」，明文只显示一次）。用户把完整 `keyId.secret` 发过来后：

```bash
printf '%s' "$KEY" | buildify config set-key api_key
buildify --json config show    # 只看掩码
buildify --json key test
```

**密钥安全：** 不要 `--api-key`、不要写进仓库 / `.env` / commit、不要在后续回复里回显明文；保存后只展示 `config show` 的掩码。本 CLI 不能创建密钥。

机器可读输出一律加 `--json`，按退出码分支：`0` 成功，`2` 鉴权，`3` 本地 JSON/文件，`4` HTTP 4xx 或 validate 有 ERROR，`5` 网络。
