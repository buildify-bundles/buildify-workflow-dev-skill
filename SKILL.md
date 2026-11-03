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
  连线标签, 多段, 独立接口, 入站认证, 访问地址, 飞书卡片, 失败告警, 缺少节点,
  验签, 回调, 微信支付, 支付宝, Stripe,
  部署记录, 历史版本, 绑定服务器, 换服务器, 删除流程, 改名, 改凭证, 删除凭证,
  凭证被哪些流程使用.
  When no package or node covers the need, says so and proposes a default
  plan (buildify-bundle-dev conventions plus the vendor's official API docs,
  package name and icons); after one confirmation, or none when the user
  already asked for it, has buildify-bundle-dev create the package, develop
  and publish it, then resumes orchestration.
---

# Buildify 流程编排

用已安装的 Bundle 节点编排工作流：发现节点、写画布 JSON、校验、保存草稿、试跑，试跑通过后确认版本号再发布到已确认的服务器，并用表格汇报。

- 和 `buildify-bundle-dev` 分工：那个「做节点」，这个「用节点编流程」。本 skill 的规则不用来写 Bundle 源码。没有对应软件包或节点时，先说明不存在，给出按官方文档实现的默认方案，确认后交给 bundle-dev 建包、开发和发布（没装先安装），发布后回来接着编排。
- 唯一接口是 `buildify` CLI（PyPI 包 `buildify-cli`），它调 `buildify-open-api-server`。不要猜 REST 路径，不清楚先 `buildify help`。
- 机器可读输出一律加 `--json`，按退出码分支（见 [reference/cli.md](reference/cli.md)「退出码」）。

## 工作流

复制清单并逐项勾选：

```
流程编排进度：
- [ ] 1. CLI 就绪：buildify --json key test（见「工作区与密钥」）
- [ ] 2. 定项目、流程（见「沿用已有，只问缺的」）
- [ ] 3. 定服务器：改已有先 workflow workers（只要 deleteStatus 0）；画布方向默认 TB，试跑通过后默认发布
- [ ] 4. 发现节点：bundle list → bundle nodes → 只对要放进画布的节点拉 node-properties / node-relations；没有软件包或缺节点 → 默认方案确认一次，bundle-dev 建包、开发、发布后回到这一步（见「环境里没有对应节点」）
- [ ] 5. 凭证：只问空槽，三选一
- [ ] 6. 生成 flow.json：先写节点和连线，再 node scripts/layout.mjs 统一排版（见「生成画布 JSON」）
- [ ] 7. node scripts/check.mjs --fetch 查边、出口和图标；再 workflow validate 闭环，ERROR 按节点写回顶层 errors
- [ ] 8. save-draft（新建先 workflow create）
- [ ] 9. test-run（HTTP 接口先测访问地址，见「试跑 HTTP 接口」）
- [ ] 10. 确认版本号和发布说明 → workflow deploy --wait → 发布表
```

步骤补充：

- **2–5 缺什么才问什么**，同一次提问里问完。缺口没回复前不要 `workflow create` / `save-draft` / `test-run` / `deploy`。
- **4**：没有对应软件包或节点时停下编排，按「环境里没有对应节点」给方案、确认、开发发布，然后从这一步继续。`bundle doc` 只在参数含义不清时读。
- **8**：改已有就打开该草稿再 save-draft。新建用用户给的名称，没给就用展示过的建议名。
- **9**：凭证选了「使用时再选」则停在草稿，不试跑。用户选了「只保存草稿」可以试跑，但不进入步骤 10。
- **10**：只在试跑通过、且用户没选「只保存草稿」时进行。见「发布与汇报」。

## 按任务读取（勿一次全读）

| 场景 | 读 |
|---|---|
| 命令、参数、退出码、推荐循环、save-draft 冲突、改服务器、改/删凭证、删除、部署记录、历史版本 | [reference/cli.md](reference/cli.md) |
| 画布 JSON 字段、排版脚本、边、批注、分组、多段并列、校验顺序 | [reference/flow-json.md](reference/flow-json.md) |
| 参数里的表达式（按 `uiComponent`）、JS 代码注释、飞书卡片与失败原因 | [reference/expressions.md](reference/expressions.md) |
| 批注节点字段、HTTP 接口批注正文 | [reference/comment-node.md](reference/comment-node.md) |
| 常见骨架：Webhook 应答、定时落库、分支复制、改已有、分组 | [reference/recipes.md](reference/recipes.md)（节点名仍须用 CLI 核实） |
| 保存 / 试跑 / 发布后的汇报表格与状态符号 | [reference/report.md](reference/report.md) |
| 没有软件包或缺节点：默认方案、确认模板、建包、开发发布后回来 | [reference/missing-bundle.md](reference/missing-bundle.md) |

## 生成画布 JSON（步骤 6）

按 [flow-json.md](reference/flow-json.md) 写。下面是最容易写错的硬规则；坐标数值的细则只在 flow-json.md。

**先连线，最后统一排版。** 坐标不要手算：

1. 写齐 `nodes`（业务字段、`parentNode`）和 `edges`，顶层写 `direction` 和 `errors`。执行节点的 `position` 可以不写。
2. 结构定下来后运行本 skill 目录下的排版脚本（需要 Node 18+，不用装依赖）：

   ```bash
   node <本 skill 目录>/scripts/layout.mjs ./flow.json            # 原地写回
   node <本 skill 目录>/scripts/layout.mjs ./flow.json --check    # 只检查，坐标要变时退出 1
   ```

   脚本移植自控制台「自动排列」（`applyLayout.js`），算出的执行节点坐标、锚点、分组框尺寸、批注位置与控制台一致。退出码 3 是图结构有错（边指向不存在的节点、连到分组框或批注、`parentNode` 不是分组框），按提示修好再跑。
3. 之后每次增删节点或边、改 `parentNode`、换方向（`--direction TB|LR`），都重新跑一次，再进入步骤 7。

改已有草稿：只在用户要求重排、或增删了节点 / 边时才跑，并告诉用户整张画布会按自动排列重排。用户手动调过布局时先问再跑。改动只在某个分组里、或用户只要求整理某个分组时，用 `--group <分组 id>` 只排这个分组（同控制台分组右键「自动排列组内节点」），组外坐标不动。没有 Node 时按 flow-json.md「手算兜底」写坐标。

- **节点 id**：每个新节点（含批注、分组框、复制出来的节点）用 `n-` + 8 位 nanoid，流程内唯一。不要用 `n1` / `trigger` 这类可读名。已有草稿的旧 id 不要改。边 `id` = `{source}_{target}`。
- **顶层**：必写 `direction`（默认 `TB`；用户要横排才 `LR`；改已有沿用草稿）和 `errors`（先 `{}`）。
- **节点字段**：`name` / `bundleName` / `bundleVersion` / `icon` / `label` / `isTrigger` 从 `bundle nodes` / `node-properties` 原样拷贝。**图标按节点类型逐个查目录**，不要凭名字猜（`JsFunctionNode` 是 `js.svg`，不是 `code.svg`；`HttpRequestNode` 是 `request.svg`），不要借用别的节点或软件包本身的图标，也不要写 URL。`summary` 写这颗节点在本流程里的职责，**≤8 字**（如「接收请求」「查询设备」），画布默认显示它，不要照抄目录 `summary`。
- **坐标**：交给排版脚本。`position`、`sourcePosition` / `targetPosition`、分组框 `style` 宽高都由脚本写，不要在脚本输出后再手动挪动。只有批注和多段时要给粗略的初始坐标，见 flow-json.md「画布排列」。
- **分支**：以不交叉为准。能沿流向干净汇合才共用下游；否则各支路复制一份配置相同的节点（新 id）。不要复制触发器。
- **循环允许，但必须有出口。** 用户要重试、轮询、等到条件满足时，从下游出口连回上游入口即可。不要为了消环拆边或复制节点。回连由控制台绕线，节点仍按主链排，不要把下游再挪到上游旁边。环上至少要有一条边离开循环（If / Switch 的另一支、失败出口、次数用尽、超时等）。所有出口都连回环内就是死循环：补上退出条件再保存，条件不清楚就问用户。
- **边**：每两个节点之间只有一条边，`id` 固定 `{source}_{target}`，不要按出口拆成 `…_Success` / `…_Failure` 两条。接到同一下游的多个出口（如 Success+Failure）全部放进这条边的 `data.relations[]` 数组。每个 relation 必须有 `name` 和 `label`，从 `node-relations` 整份拷贝；`description` 可选，可以照目录写，也可以改写成本流程里的含义（如「查不到也继续」）。MCP 自定义关系再带 `_id` / `icon` / `mcpKind`，并同步到源节点 `data.relations`。
- **表达式**按字段 `uiComponent` 选语法：`JsonExpressionInput` 默认整字段 `"={{msg.xxx}}"` 保留类型，要拼字符串才写 `"=前缀 {{msg.xxx}}"`（`=` 必须是第一个字符，`{{ }}` 里不运算）；`SqlEditor` 用 `#{}` / `${}`；文本及其他用 `{{ }}`。见 [expressions.md](reference/expressions.md)。
- **JS 节点** `parameters.code` 分段并写中文注释：顶部写入参/出参，每段用 `// --- 段名 ---` 隔开。
- **批注默认不加。** 例外：每个 HTTP 接口一张（正文见 comment-node.md 的接口说明）；用户要求；分支条件或调用约定在 `summary` 里写不下、不写会误用。不连线。HTTP 接口说明写 `parentNode` 挂到该段分组，初始坐标 `{0, 0}`，脚本把它放在组内靠左；这段还没有分组时先加一个框。其他批注不写 `parentNode`，初始坐标在被说明节点外侧（`TB` 左侧、`LR` 上方）。
- **分组默认不加。** 多于两段互不连线的逻辑（三段起）时每段一个框，有 HTTP 接口的段也加一个框（接口说明放在框内靠左），或用户要求时才加。组内节点必须写 `parentNode`；框的宽高和组内坐标交给脚本（标题在框内，左右留白 40，上留白 68，有回连时自动加宽）；框背景写 `groupColor: "#5b7c99"`、`groupOpacity: 0.06`。
- **两段及以上互不连线**时按下一节生成。

### 保存前检查边和图标

排版后、`workflow validate` 前跑一次：

```bash
node <本 skill 目录>/scripts/check.mjs ./flow.json --fetch          # 只报告
node <本 skill 目录>/scripts/check.mjs ./flow.json --fetch --fix    # 能确定的直接改回 flow.json
```

`--fetch` 按画布里用到的软件包调 `bundle nodes` / `bundle node-relations` 作对照，多工作区时加 `--profile <name>`。退出码 0 才往下走；1 表示还有 ERROR，3 是文件或拉目录失败。

它查的是 `workflow validate` 不一定能发现、但控制台会画错的地方：同一对节点出现两条边、边 `id` 不是 `{source}_{target}`、`relations` 不是数组或出口缺 `name` / `label`、出口名不在目录里、节点缺图标、图标和目录不一致、同类节点图标不同、图标写成 URL。`--fix` 会合并重复边、改正边 `id`、从目录补出口 `label` 和图标，不动 `description`；目录里没有的出口名不会自动猜，要按 `node-relations` 改。改完结构（合并了边）要重跑排版脚本。

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

- 不算坐标，`position` 不写（主代理合并后统一排版）
- 只用分配的 id，边只连本段节点
- 不写顶层 `direction` / `errors` / `viewport`，不加批注和分组框
- 不调用 save-draft / test-run / deploy，不改选项目或凭证

**只有主代理写 `flow.json`。** 合并时：拼上各段 `nodes` / `edges`，检查 id 不重复、边不跨段；顶层只写一份 `direction` 和 `errors`。按需求顺序给第 i 段（从 0 起）的每个顶层节点写同一个粗略坐标（`TB` 为 `{x: i*1000, y: 0}`，`LR` 为 `{x: 0, y: i*1000}`），脚本靠它决定段的先后，也靠它把批注贴到正确的段。再由主代理加分组（多于两段时；有 HTTP 接口的段即使不到三段也要有框）和每个 HTTP 接口的批注（`parentNode` 指向该段的框），跑一次排版脚本，然后照常做步骤 7–10。段内层距、段间隙由脚本处理，不要手动平移。

## 环境里没有对应节点：先做 Bundle，再回来编排

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。`bundle list -k` 换两三个同义词都查不到是**缺软件包**；包在但 `bundle nodes` 里没有是**缺节点**。缺节点时先看同包有没有 `…ApiCall` 通用调用节点，有就按厂商官方文档填参数直接用。

确实没有时**立刻停止**编 JSON / validate / 试跑 / 发布，按 [reference/missing-bundle.md](reference/missing-bundle.md) 走：

1. **说明不存在，拟默认方案。** 节点、凭证、`…ApiCall` 通用节点按 buildify-bundle-dev 规范；接口按对接服务的官方开放文档实现并附链接（只认官方域名，找不到就请用户给文档）。缺软件包时一并拟好软件包信息（`命名空间/包名`、显示名、简介、可见性 `internal`）和图标（默认 `default.svg`）。
2. **确认一次。** 用户已明确要求直接开发（如「没有就直接做」「按官方文档做」，或已给出包名和节点要求）时不再问，按默认值开发并在回复里列出默认值。否则一次点选：按默认方案创建并开发（推荐）/ 调整 / 改用相近节点 / 先停下，图标作第二题。**不要**让用户去控制台建软件包，建包由 bundle-dev 的发布 CLI 完成。
3. **交给 bundle-dev。** 没装或版本旧（不支持 `bundle create`）就先装 / 更新。在「编排待续」里写明软件包信息和图标已由用户确认，bundle-dev 据此建命名空间和包、传图标、开发、发布，不再重复确认。
4. **回到步骤 4。** 用 CLI 重新查目录，取真实的 `bundleVersion` / `icon` / 表单 / relations 后继续编排，汇报里加「新增 Bundle」。

## 项目 / 流程 / 服务器 / 凭证：沿用已有，只问缺的

已经能确定的**直接用**，不要再问，也不要列成待确认。一次消息里只问还缺的项。

| | 改已有 | 新建，用户已给 | 还没有 |
|---|---|---|---|
| **项目** | 这条流程所在的项目 | 用户点的项目 | `project list`，让他选 |
| **流程** | 这一条，打开草稿改 | 用户给的名称 | 问新建还是改哪条；新建名没给时建议名放第一项 |
| **服务器** | 用户点名的；没点名用 `workflow workers` 里 `deleteStatus` 为 0 的那台（已绑定）。不要用 `workflow published` 来选服务器 | 用户点的那台 | `project workers` 列出让他选 |
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
- 改已有先 `workflow workers`。`deleteStatus` 0 是已绑定，才能 `deploy`；1 是待移除，不能拿来试跑或发布。只有一台已绑定且在线时直接用，多台再问。一台都没有时从 `project workers` 里选，用户点了之后先 `assign-workers`，再发布。`deploy` 报「未绑定」就是还没做这一步。
- 改名、加/换/移除服务器、改或删凭证、删除项目或流程都不是默认步骤。用户提出来才做，先点选确认。细则见「改名称、改服务器、改凭证、删除」。
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

`workflow validate` 退出码 4 表示还有 ERROR。按 `issues[].path` / `issues[].nodeId` 定位，对照 `node-properties` 修 `data.parameters`，重跑直到表单类 ERROR 清掉。不要跳过校验直接试跑。

**图里的环不算限制，但要核退出条件。** `issues` 里出现「环」/ cycle 时不要改边去消掉。出口连回上游入口是合法循环。只剩环导致 `valid: false` 时，先看环上有没有离开循环的边：有就照常 save-draft、试跑、发布；没有就补 If / Switch（或已有节点的另一出口）再问用户退出条件，不要带着死循环往下走。缺触发器、孤立节点、表单 ERROR 仍要修。

每次校验后把表单 ERROR **写回画布顶层 `errors`**：全部通过 `"errors":{}`；未通过按节点 id 汇总，如 `"errors":{"n-k7mX2pL9":1}`（value 是该节点未通过字段数，不计 WARNING）。用户明确稍后自填或选了「使用时再选」时，也要写入当前汇总再 save-draft，不要为了消掉凭证 ERROR 去猜一条凭证。

WARNING 不影响退出码，但也要修：`data.icon` 缺失、边上 `relations[]` 缺 `label`、自定义关系缺 `icon` / `_id`，都从 `bundle nodes` / `node-relations` 原样补齐，否则控制台图标和出口文字不对。图标用错、重复边这几类 validate 不一定能发现，靠 `scripts/check.mjs`（见「保存前检查边和图标」）。

## HTTP 接口

入口用当前环境的 Webhook 触发器，目录名通常是 `WebhookTriggerNode`，以 `bundle nodes` 为准。

**认证先用这个触发器里已有的方式。** 对得上就写 `authType`，不要新做触发器，也不要在下游再验一遍。`node-properties` 里有「入站认证」时用它：

| `authType` | 凭证槽 | 何时 |
|---|---|---|
| `none` | 无 | 用户没要求校验，或内网 / 网关已经鉴权 |
| `httpBasic` | `httpBasicAuth`（HttpBasicAuth） | HTTP Basic |
| `apiKey` | `apiKey`（HeaderAuth） | 自定义 Header，含固定 Token、签名放在某个 Header 里但**不依赖原始报文体** |
| `jwtAuth` | `jwtAuth`（JwtAuth） | `Authorization: Bearer` |

按 IP 限制访问写这个触发器的高级选项 `options.acl`，不要再单做一段 IP 判断。开了认证后凭证槽仍按「凭证」三选一，不要自己挑一条。

**对不上表里的方式，再另做处理。** 典型是微信支付、支付宝、Stripe 这类要按原始报文体计算签名的回调：`Content-Type: application/json` 时，`WebhookTriggerNode` 把 `request().body()` 解析成对象，原始字节回不来；表单体会收成字段。不要把这种验签写成 `apiKey` 或 `jwtAuth`，也不要在 `WebhookTriggerNode` 后面串一个验签节点。

1. 先 `bundle list` / `bundle nodes` 找这个渠道自己的回调触发器。有就用它当入口。
2. 没有就按「环境里没有对应节点」交给 bundle-dev，做这个渠道的**触发器**。它自己 `Route.create`，用 `request().body()` 读原始字符串，并在触发器里验签。验签失败按该渠道官方文档直接写回，不把请求送进流程。
3. 返回要两种都支持，编排时按渠道文档选一种：
   - **直接返回**：验签通过后立刻按文档要求的状态码、Content-Type 和正文写回，流程在后台继续。
   - **处理完再返回**：先不结束连接，下游接核心包的 `WebhookResponseNode` 写回。触发消息的 eventId 用这次 HTTP 的 `getRequestId()`，`WebhookResponseNode` 靠消息头 `__correlationId` 找到这条连接。
4. 编排时这个触发器就是入口，后面只接业务。选了处理完再返回时，Success 末端接 `WebhookResponseNode`。

表单里没有 `authType`、需求也对不上上表、又不是原文验签时，才在触发器下游加一个真实存在的校验节点；没有能校验的节点就按「环境里没有对应节点」处理。不要把不存在的 `authType` 写进参数。

**每个接口一张批注**，挂在该接口的分组里靠左（见 [comment-node.md](reference/comment-node.md)）。这段还没有分组时先加一个框，执行节点和批注都写它的 `parentNode`，框标题用接口短名。正文按该文件的接口说明写：方法、路径、是否认证、有则写请求头 / 参数 / 示例 / 错误码，最后写访问地址。访问地址：生产 `http://{externalHost}:{httpPort}{path}`，测试在 path 前加 `/@test`。`externalHost` / `httpPort` 取已确认服务器在 `project workers` 里的字段；缺了就只写方法和 `parameters.path`，注明完整地址是「服务器访问地址 + 路径」，并提示到控制台「节点管理」设置。不要编造域名，不要把凭证密钥写进批注。

### 试跑 HTTP 接口

入口是 Webhook 触发器或渠道回调触发器时，步骤 9 按这个顺序做：

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

   「重新检测」：重新拉 `project workers` 取地址，从第 2 步再来。「换一台」：按「沿用已有，只问缺的」列出服务器；新服务器还没绑定（`workflow workers` 里没有 `deleteStatus` 0）时，确认后先 `assign-workers`，再继续试跑和发布。「只保存草稿」：停在步骤 8。
4. **通了再试跑。** 后台启动 `test-run`，在它超时前向测试地址发一次请求，再等它返回：

   ```bash
   buildify --json workflow test-run -p "$PROJ" -f ./flow.json --worker "$WKR" --timeout 60 > /tmp/test-run.json &
   sleep 3
   curl -sS -X GET -w '\n%{http_code}' --max-time 30 "$BASE/@test/api/orders/123"
   wait
   ```

   测试地址 = `BASE` + `/@test` + 触发器 `parameters.path`，方法与触发器一致；路径参数（如 `:id`）换成示例值，请求体按需求造一条最小样例。触发器开了入站认证时，不要猜密钥、不要从凭证里取明文：请用户提供，或请他自己调测试地址，再等 `test-run` 结果。
5. 结合 `test-run` 的 `nodes[].outputs` / `events` 和这次 HTTP 响应判断是否符合需求，按 [report.md](reference/report.md)「试跑后」汇报。

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

`--version-name` 和 `--remark` 只写到这个发布版本，不改流程描述。`--wait` 在 CLI 内轮询到结束，**不要**再循环调 `workflow deployment`，也不要接着拉 `workflow deployments`。返回的 `versionName` / `publishRemark` / `summary` 直接用来画表；失败时退出码 4，把 `summary.servers[].message` 原样告诉用户。`--worker` 必须已经是 `deleteStatus` 0 的绑定；报「未绑定」就先按「改名称、改服务器、改凭证、删除」加上再发。

### 汇报

保存草稿、试跑、发布后都用 Markdown 表汇报，模板、状态符号映射和禁写项见 [reference/report.md](reference/report.md)。要点：服务器用表不用列表；表格单元格不放彩色 emoji；只写名称不写 id；不输出节点信息（HTTP 访问地址除外）。用户事后问部署记录或历史版本时，用同一份状态符号，见 report.md「事后查询」。

## 改名称、改服务器、改凭证、删除

这些命令会改运行位置、凭证或删数据。用户没提出来就不要跑。能点选就点选，确认前不要执行。命令和 409 含义见 [reference/cli.md](reference/cli.md)。

- **改名**：`project update` / `workflow update` 必传 `-n`。用户没说要改简介就不传 `--remark`，原简介会留下。
- **加服务器**：`workflow assign-workers`，多台就重复 `--worker`。已经绑定的会跳过。流程还没发布时只是绑上，`needDeploy` 为 false。已经发布过时，会把**当前线上版本**部署到新服务器（`needDeploy: true`，带 `deploymentId`），不是把草稿发出去。告诉用户这一点。不要自己轮询；用户要看这次结果时再调一次 `workflow deployment -d`。响应里有 `warnings` 就原样说明。正在移除的服务器会 409，把 `msg` 告诉用户，等移除完成或改走强制移除。
- **移除服务器**：`workflow unassign-workers`。没发布过的立刻解绑。已发布的变成待移除并下线，绑定还在，服务器确认前 `workflow delete` 会 409。
- **强制移除**：只在用户说明服务器已经不在，或普通移除一直停在待移除时才用 `workflow force-unassign-workers`。它立刻删掉绑定，离线服务器下次同步时丢掉这个流程。
- **删除**：`project delete` 只在项目里没有流程时能成功，否则 409。`workflow delete` 只在没有任何绑定（含待移除）时能成功，否则 409。要删流程就先移除服务器，待移除消不掉时再问要不要强制移除，然后才能删。
- **改凭证**：`project update-credential -p … --credentials cred_…`，`credentialsId` 从 `project credentials` 取。只传用户要改的项（`--label` / `--description` / `--bundle-version`）；改表单时只把要改的字段用 stdin `--file -` 传，没传或空着的密钥保留原值。改表单会影响所有用它的流程，确认前先 `project credential-workflows` 把这些流程列给用户。密钥不要回显。
- **删凭证**：先 `project credential-workflows` 看谁在用。有流程在用时删除会 409：告诉用户是哪些流程，问是先给它们换凭证还是不删，不要自己改那些流程。没人用时确认后 `project delete-credential`。
- **凭证被哪些流程使用**：只读，直接 `project credential-workflows`，按流程名列表汇报，`hasNext` 为真且用户还要看时再翻页。

## 部署记录与历史版本

刚 `deploy --wait` 完不要查这两类。用户问过去的发布、哪一版在跑、或要看某一版画布时才查。

- `workflow deployments`：部署记录，新的在前。翻页用 `--page`，默认一页 10 条，`hasNext` 为真且用户还要看时再取下一页。
- `workflow versions`：历史版本，含当前草稿（`isDraft`）和仍绑在服务器上的版本（`isRunning`）。
- `workflow get-version --version-id v-…`：那一版的 `workflowJson`。只读，没有 save-draft 用的乐观锁 `version`。用户要恢复成草稿时先确认，再把这份画布走正常的 validate / save-draft（锁版本仍由 save-draft 自己读当前草稿）。不要直接 deploy。
- 退出码 2 且 `msg` 含「缺少权限」：密钥是有效的，缺的是消息里的 scope（部署记录要 `project:workflow:view_deployment`，历史版本要 `project:workflow:view_version`）。请用户到控制台给这把密钥补权限，不要当成密钥失效去重建。

## 工作区与密钥（步骤 1）

执行 CLI，不要读它的源码。

找不到 `buildify` 命令时由你装好，不要让用户去装：先试 `~/.local/bin/buildify`（可能只是不在 `PATH` 里），没有就按 [install.md](install.md)「装 buildify CLI」的顺序装（优先 `uv tool install -U buildify-cli`，Python 版本不够也能装）。不用 `sudo`，不改系统 Python。

`buildify --json key test`：

- 退出码 0：用返回的工作区。只有一把密钥时不必加 `--profile`。
- `data.reason=missing_api_key`：**停止编排**，请用户到控制台 **系统设置 → API Keys → buildify-cli 密钥** 创建一把并发来完整的 `keyId.secret`（只在创建时显示一次；有多个工作区时在要编排的那个里创建）。说明照 [install.md](install.md)「buildify-cli 密钥」里的模板写，不要原样转发 `data.userMessage`，里面的菜单路径可能是旧的。profile 名不必问，用工作区的简短英文名，没有就用 `default`。收到后：

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

- `data.reason=workspace_key_missing`：仓库 `.buildify-workspace` 指向的工作区本机没有密钥。请用户在这个工作区的 **系统设置 → API Keys → buildify-cli 密钥** 创建一把发来，再 `add-profile`，不要改用别的工作区。
- 项目 404 且响应带 `tenantId` / `profile`：先问是不是工作区错了，再决定要不要在这里建项目。密钥不在允许的项目范围内时，项目也会 404。
- 退出码 2 且 `msg` 含「缺少权限」：密钥有效，缺的是消息里的 scope。请用户在控制台给这把密钥补上，不要当成 401 去重建密钥。

**密钥安全：** 不要 `--api-key`；不要写进仓库、`.env` 或 commit；不要在回复里回显明文。本 CLI 不能创建密钥。
