---
name: buildify-workflow-dev
description: >-
  Builds Buildify workflows from installed Bundle nodes with the buildify CLI
  and bundled scripts: discovers node schemas, generates the canvas flow.json
  from a short spec, lays it out, validates, saves drafts, test-runs (HTTP
  webhooks via /@test) and deploys to a worker. When no package or node covers
  the need, proposes a plan and has buildify-bundle-dev build and publish it,
  then resumes. Use when the user creates, edits, test-runs or publishes a
  Buildify workflow, or mentions 编排流程, 工作流, flow.json, 画布, Webhook 接口,
  HTTP 接口, 试跑, @test, 发布, 版本号, 凭证, 服务器, 节点管理, 批注, 节点分组,
  横排, 竖排, 多段, 独立接口, 入站认证, 访问地址, 飞书卡片, 失败告警, 缺少节点,
  验签, 回调, 微信支付, 支付宝, Stripe, 部署记录, 历史版本, 绑定服务器, 换服务器,
  删除流程, 改名, 改凭证, 删除凭证, 凭证被哪些流程使用, 切换项目, 换项目,
  建到哪个项目, 换到别的项目, 工作区, 切换工作区, 多个工作区, 更新 skill, skill 版本.
---

# Buildify 流程编排

用已安装的 Bundle 节点编排工作流：发现节点、写一份简表（spec）生成画布、校验、保存草稿、试跑，试跑通过后确认版本号再发布到已确认的服务器，并用表格汇报。

- 和 `buildify-bundle-dev` 分工：那个「做节点」，这个「用节点编流程」。没有对应软件包或节点时，先说明不存在，给出按官方文档实现的默认方案，确认后交给 bundle-dev 建包、开发和发布，发布后回来接着编排。
- 唯一接口是 `buildify` CLI（PyPI 包 `buildify-cli`）。不要猜 REST 路径，不清楚先 `buildify help`。机器可读输出一律加 `--json`，按退出码分支（见 [reference/cli.md](reference/cli.md)「退出码」）。
- 目录、生成画布、整理结果都用本 skill 的 `scripts/`（Node 18+，不用装依赖），**不要临时写 python / jq 去抽字段**。下文 `$S` 指 `<本 skill 目录>/scripts`。

## 工作流

复制清单并逐项勾选：

```
流程编排进度：
- [ ] 1. CLI 就绪：buildify --json key test，再 config profiles 看有几个工作区（见「工作区与密钥」）；同时 node $S/update-check.mjs（见「Skill 版本」）
- [ ] 2. 定工作区和项目（新建每次点选确认）、流程（见「沿用已有，只问缺的」「项目：新建必选，切换重选」）
- [ ] 3. 定服务器：改已有先 workflow workers（只要 deleteStatus 0）；画布默认 TB，试跑通过后默认发布
- [ ] 4. 发现节点：bundle list -k → node $S/catalog.mjs fetch -b 包 -n 节点,节点 …（一次拉齐要用的节点）；缺包或缺节点 → 见「环境里没有对应节点」
- [ ] 5. 凭证：只问空槽，三选一（reference/credentials.md）
- [ ] 6. 写 spec → node $S/build.mjs spec.json -o flow.json（补齐字段并排版）；WARNING 逐条处理
- [ ] 7. node $S/check.mjs flow.json --catalog-dir /tmp/buildify-catalog --fetch → workflow validate > validate.json → node $S/result.mjs validate validate.json --flow flow.json --write-errors
- [ ] 8. save-draft（新建先 workflow create）
- [ ] 9. test-run > test-run.json → node $S/result.mjs test-run test-run.json --flow flow.json（HTTP 接口先测访问地址，见 reference/http.md）
- [ ] 10. 确认版本号和发布说明 → workflow deploy --wait > deploy.json → node $S/result.mjs deploy deploy.json → 发布表
```

- **2–5 缺什么才问什么**，同一次提问里问完。缺口没回复前不要 `workflow create` / `save-draft` / `test-run` / `deploy`。
- **4**：`catalog.mjs` 打印每个节点的 `icon` / `label` / 触发器、参数（必填、`uiComponent`、枚举、默认值、显示条件）、凭证槽和出口，写参数就照它。`bundle doc` 只在参数含义仍不清时读。
- **8**：改已有就打开该草稿再 save-draft。新建用用户给的名称，没给就用展示过的建议名。
- **9**：凭证选了「使用时再选」则停在草稿，不试跑。用户选了「只保存草稿」可以试跑，但不进入步骤 10。
- **10**：只在试跑通过、且用户没选「只保存草稿」时进行。见「发布与汇报」。

## 按任务读取（勿一次全读）

| 场景 | 读 |
|---|---|
| 命令、参数、退出码、save-draft 冲突、改服务器、改/删凭证、删除、部署记录、历史版本 | [reference/cli.md](reference/cli.md) |
| spec 骨架：定时拉取推送、Webhook 校验应答、分支、改已有、分组、事务与幂等 | [reference/recipes.md](reference/recipes.md) |
| 画布 JSON 字段、边、分组、批注（手改 JSON 或读懂已有草稿时） | [reference/flow-json.md](reference/flow-json.md) |
| 参数里的表达式（按 `uiComponent`）、JS 代码注释、飞书卡片与失败原因 | [reference/expressions.md](reference/expressions.md) |
| 凭证三选一、现在创建 | [reference/credentials.md](reference/credentials.md) |
| HTTP 接口的访问地址、连通检测、试跑 | [reference/http.md](reference/http.md) |
| 用户要求时才加的批注、HTTP 接口文档正文 | [reference/comment-node.md](reference/comment-node.md) |
| 保存 / 试跑 / 发布后的汇报表格与状态符号 | [reference/report.md](reference/report.md) |
| 没有软件包或缺节点 | [reference/missing-bundle.md](reference/missing-bundle.md) |
| 没有 Node，只能手算坐标 | [reference/layout-manual.md](reference/layout-manual.md) |

## 脚本速查

| 命令 | 做什么 |
|---|---|
| `node $S/catalog.mjs fetch -b buildify/core -n A,B -b 包2 -n C [-V 版本] [--profile P]` | 并行拉 `bundle nodes` / `node-properties` / `node-relations` 存进 `/tmp/buildify-catalog`，打印摘要。没有 `-n` 只列包里的节点。`show` 只读缓存 |
| `node $S/build.mjs spec.json -o flow.json [--base draft.json] [--fetch]` | 按 spec 生成画布：`n-` + nanoid、边 id、目录字段、表单默认值、整份出口对象、凭证、分组框（只写标题）、多段原点、顶层 `direction` / `errors`，最后调 `layout.mjs`。`--base` 只改参数时旧 id 不变；切换 `name`/包名时换新 id 并改写边。参数键、出口名、凭证槽不对时 ERROR 且不写文件 |
| `node $S/layout.mjs flow.json [--direction TB\|LR] [--group 分组id] [--check]` | 单独重排（build 已自动跑） |
| `node $S/check.mjs flow.json --catalog-dir /tmp/buildify-catalog --fetch [--fix]` | 查边、出口、图标；按画布 `bundleVersion` 自动取版本一致的缓存，缺的再拉 |
| `node $S/result.mjs validate\|test-run\|deploy 文件 [--flow flow.json]` | 整理 CLI 输出；`--write-errors` 写回顶层 `errors`；`--node` / `--path` 看某个节点的输出 |
| `node $S/update-check.mjs [--force]` | 本 skill 有没有新版本，输出一行 JSON，24 小时内复用缓存；退出码总是 0 |

退出码统一：0 通过；1 有 ERROR / 没通过（按输出修）；3 文件、参数或拉取失败。多工作区时 `catalog.mjs` / `build.mjs --fetch` / `check.mjs --fetch` 都加 `--profile`，缓存目录也按工作区分开：`catalog.mjs` / `build.mjs` 加 `--dir /tmp/buildify-catalog/<profile>`，`check.mjs` 的 `--catalog-dir` 用同一个目录。缓存只按「包@版本」存，不分开会串用别的工作区的同名包。

## 生成画布（步骤 6）

**写 spec，不手写画布 JSON。** spec 只写业务内容（节点 `key` / `bundle` / `name` / `summary` / `parameters` / `credentials` / `parent`，边 `[from, to, 出口]`），格式见 `build.mjs` 文件头和 [recipes.md](reference/recipes.md)。改已有草稿用 `--base`（见 recipes「改已有流程」）。只有脚本表达不了的改动才手改 JSON，改完跑 `check.mjs --fix` 和 `layout.mjs`。

build 报的 WARNING 都要看：必填没填（含 Collection / Fixed 里的必填子字段，如 Webhook 的 `options.cors`）、JS 下游误用 `msg.output`、表达式写法、`summary` 超长、JS 没注释、凭证槽没绑。

下面是 spec 里仍要自己判断的规则：

- **默认易读。** 用户给了具体结构就照做，否则按这几条编排：
  - 主流程从触发器一路往下是一条直线，读的顺序就是执行顺序；分支短，尽快在应答或告警节点结束，不绕回主线。
  - 一个节点只做一件事，`summary` 用业务语言写它做什么（「校验参数」「查询订单」「返回结果」）。
  - 能用现成节点就不用 JS：校验用 `ValidateNode`，判断用 `IfNode` / `SwitchNode`，改字段用 `SetNode`，调接口用 `HttpRequestNode`。JS 只做组装报文这类现成节点做不了的事，一个 JS 节点不塞几段不相关的逻辑。
  - 不加只透传的 `EmptyNode` / `SetNode`，不为一个判断拆好几层 If。
  - 不同接口、不同触发器各自一段（见「HTTP 接口」一个方法一条流程），不合进一段再分流。
- **`summary`**：这颗节点在本流程里的职责，**≤8 字**（如「接收请求」「查询设备」），画布默认显示它，不要照抄目录 `summary`。
- **参数**：只写要改的键，默认值脚本会从表单补。表达式按字段 `uiComponent` 选语法：`JsonExpressionInput` 默认整字段 `"={{msg.xxx}}"` 保留类型，要拼字符串才写 `"=前缀 {{msg.xxx}}"`；`SqlEditor` 用 `#{}` / `${}`；文本及其他用 `{{ }}`。见 [expressions.md](reference/expressions.md)。
- **取值层级**：触发器字段在 `msg.xxx`；普通节点结果在 `msg.output.xxx`；**`JsFunctionNode` 的返回值就是下游的整个 `msg`**，取它返回的字段写 `msg.xxx`。
- **JS 节点** `parameters.code` 分段并写中文注释：顶部写入参/出参，每段用 `// --- 段名 ---` 隔开。
- **分支**：以不交叉为准。能沿流向干净汇合才共用下游；否则各支路复制一份配置相同的节点（spec 里另起一个 key）。不要复制触发器。至少 3 个旁支汇到同一个没有出边的收尾节点（如统一的失败返回）时保持共用，排版会把它放到尽头。
- **出口**：一对节点只连一条边，多个出口接同一下游写 `["a","b","Success,Failure"]`。想让某个出口的分支在左 / 上，就把它的边写在前面。出口说明可以改写成本流程里的含义（`description`）。
- **循环允许，但必须有出口。** 用户要重试、轮询、等到条件满足时，从下游出口连回上游入口即可，不要为了消环拆边或复制节点。环上至少要有一条边离开循环（If / Switch 的另一支、失败出口、次数用尽、超时等）。没有就补退出条件再保存，条件不清楚就问用户。
- **默认不加批注，也不写接口文档。** 接口的方法、路径、访问地址写在对话汇报里。用户明确要求「写接口文档 / 加说明 / 加批注」时才在 spec 里加 `comment`，正文写法见 comment-node.md。
- **默认不分组，特别复杂的流程按功能模块分组。** 执行节点大约 15 个以上，或一段里能清楚分出几块职责（如「接收校验」「下单扣款」「通知告警」）时，一个模块一个 `group`，组内节点写 `parent`。成功/失败分支跟着所在模块，不要为分支单独加框，也不要每个节点一个框。用户明确要求时照做，明确不要时不分。只改参数、不改结构时，不要为了补分组去重排已有画布。分组框只写标题，不设边框和背景色，走系统默认样式；用户明确要求时才写。
- **方向**：`direction` 默认 `TB`；用户要横排才 `LR`；改已有沿用草稿。
- **切换节点类型**：改已有时若换 `name` 或包名（`bundle`），spec 仍写旧节点 `id`，build 会分配**新的** `n-` id 并改写边，避开运行时按 id 缓存的旧节点；参数按新类型表单重建，不要写 `remove`。只改参数 / summary / 凭证时保持旧 id。

改已有草稿时 build 会整图重排。只在增删了节点 / 边、或用户要求重排时用 build / layout，并告诉用户整张画布会按自动排列重排；用户手动调过布局时先问。只改参数就加 `--no-layout`。改动只在某个分组里时用 `layout.mjs --group <分组 id>`，组外坐标不动。

### 多段画布

一段 = 从一个触发器出发、彼此有边相连的那一组节点（如 `GET /orders` 和 `POST /refund` 两个独立接口）。build 按 spec 里的先后自动给每段写粗略原点，排版脚本据此并排，不用手算。

段与段之间没有边、超过 3 段或有一段明显更长时，可以按段拆给 `generalPurpose` 子任务。主代理先定好项目、流程、服务器、凭证、方向并跑完 `catalog.mjs fetch`；每个子任务只返回本段的 spec 片段 `{ "nodes": [], "edges": [] }`（key 加段前缀避免重名，边只连本段，不加批注和分组，不调用 save-draft / test-run / deploy）。主代理合并成一份 spec 再跑 build。没有子任务能力时由主代理逐段写，规则相同。

## 环境里没有对应节点：先做 Bundle，再回来编排

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。`bundle list -k` 换两三个同义词都查不到是**缺软件包**；包在但 `catalog.mjs fetch -b 包` 列表里没有是**缺节点**。缺节点时先看同包有没有 `…ApiCall` 通用调用节点，有就按厂商官方文档填参数直接用。

确实没有时**立刻停止**写 spec / validate / 试跑 / 发布，按 [reference/missing-bundle.md](reference/missing-bundle.md) 走：说明不存在并拟默认方案（buildify-bundle-dev 规范 + 官方文档，缺包时带软件包信息和图标）→ 确认一次（用户已要求直接做就不问）→ 交给 bundle-dev 建包、开发、发布 → 回到步骤 4 用 CLI 重新取真实的 `bundleVersion` / `icon` / 表单 / 出口，汇报里加「新增 Bundle」。不要让用户去控制台建软件包。

## 项目 / 流程 / 服务器 / 凭证：沿用已有，只问缺的

已经能确定的**直接用**，不要再问，也不要列成待确认。一次消息里只问还缺的项。**新建流程时的项目例外**：每次都要点选确认，见本节末「项目：新建必选，切换重选」。

| | 改已有 | 新建，用户已给 | 还没有 |
|---|---|---|---|
| **项目** | 这条流程所在的项目 | 用户点的项目，仍放进项目题第一项确认 | `project list`，让他选 |
| **流程** | 这一条，打开草稿改 | 用户给的名称 | 问新建还是改哪条；新建名没给时建议名放第一项 |
| **服务器** | 用户点名的；没点名用 `workflow workers` 里 `deleteStatus` 为 0 的那台。不要用 `workflow published` 来选 | 用户点的那台 | `project workers` 列出让他选 |
| **凭证** | 草稿里该槽已写的 `{type, name}` | 用户点的那条 | 只问空槽，见 [credentials.md](reference/credentials.md) |

对用户只用名称；项目 id、workerId、hostname 留在内部。`-p` / `-w` 传 public id（`p-…` / `w-…`），不要传中文名称。

**查候选要一次查齐。** 项目还没定、又要在选项里标出每个项目的服务器或凭证时，在**一条** shell 命令里并行查（`&` + `wait`，输出各自落文件）`project workers -p … --online-only` 和 `project credentials -p … -b <所需包>`，不要逐个项目一轮一轮查。

**让用户定的项用点选，不要让他手打名称。** 能弹选择题时（如 Cursor 的 AskQuestion），缺的每一项一道题，放在同一次提问里；建议值放第一项，标签末尾写「推荐」；离线服务器可以列出，标签写「离线，不能试跑」。用户点完即采用。没有选择题界面时，同一条消息里按项给编号，用户只回编号（如 `项目 1，服务器 2`）。

一项都不用问时，不要为了画布方向或是否发布再弹一题，直接用默认：竖排、试跑通过后发布。正在问别的缺口时，把这两项也放进同一次提问。

- 缺的时候不要自己挑第一条、唯一一条、或名称里带「本地/测试」的项。
- 新建名没给时，按需求起一个短名（如「当前时间 API」）放进流程题第一项并标「推荐」。不要另起一轮只问名字，也不要用没展示过的名字直接 create。
- 服务器：`workflow create --worker`、`test-run --worker`、`deploy --worker` 用同一台。离线的不能试跑或发布；用户点了离线的要说明并请改选在线的。
- 改已有先 `workflow workers`。只有一台已绑定且在线时直接用，多台再问。一台都没有时从 `project workers` 里选，用户点了之后先 `assign-workers`，再发布。`deploy` 报「未绑定」就是还没做这一步。
- 节点参数（如 Webhook 路径）按表单写进 spec，校验 ERROR 再按节点汇总一次问，不要为每个字段单独打断一轮。

### 项目：新建必选，切换重选

- **新建流程时项目每次都出一道选择题**，和服务器、凭证、流程名放在同一次提问里。第一项是本次对话最近用的项目（标签写「名称 — 上次使用，推荐」；没有就用用户点名的那个），其余列出 `project list` 里的项目。只有一个项目时也要出题。题干写明工作区（用 profile 名称呼，CLI 不返回工作区显示名）。
- 同一次对话里接着新建第二条流程，也要再出这道题，不要默认沿用上一条的项目。改已有流程时沿用它所在的项目，不出题。
- 项目没定时，按上面「查候选要一次查齐」并行查各项目的 `project workers` 和 `project credentials`，同一次提问就能给出各项目对应的服务器和凭证。
- `workflow create` 前在消息里写一句：「将在 工作区 X / 项目 Y 创建流程「Z」，服务器 W」。

**多个工作区时新建**（`config profiles` 按 `tenantId` 去重后不止一个，见「工作区与密钥」）：

- 工作区已经定了就只列它的项目：用户点名了工作区或 profile、设了 `BUILDIFY_OPENAPI_PROFILE`、仓库有 `.buildify-workspace`，或本次对话已经在某个工作区建过流程（仍按上面规则把它放第一项确认）。
- 没定时**不要默认用 `current`**。在一条 shell 命令里并行查每个工作区的 `project list --profile P`，项目题的选项写成「工作区 / 项目」（如「emag / 订单中心」），同一工作区的项目排在一起，`current` 那个工作区排最前，但不标「推荐」，除非本次对话用过。
- 选项超过 12 个时拆成两步：先一道工作区题（每个工作区一项，标签写 profile 名和项目数），选完再出项目题，服务器、凭证和项目放在同一轮问。
- 某个工作区 `project list` 失败（401、缺权限）时，选项里不列它，在题干里写一句「工作区 X 暂时查不到项目：原因」，不要因此停下整个提问。
- 选定后，这条流程的每条 CLI 命令和脚本都加 `--profile <name>`，节点目录缓存用 `/tmp/buildify-catalog/<profile>`（见「脚本速查」）。不要 `config use`。

**切换项目**（用户说「换到 X 项目」「建到别的项目」）：按名称在 `project list` 里匹配，匹配不到或有同名时让用户点选。服务器和凭证按项目隔离，之前选的**全部作废**，对新项目重查 `project workers` / `project credentials`，只把这两项再问一次。同一工作区内换项目，节点目录缓存不用重拉。

**切换工作区**（用户说「换到 emag」「建到另一个工作区」）：按 profile 名匹配，匹配不到就列出 profile 让他点。项目、服务器、凭证全部作废，按上面的多工作区规则重新选；之后的命令改用新的 `--profile`，节点目录换到新工作区的缓存目录重新拉（步骤 4），因为不同工作区装的包和版本可能不同，缺包按「环境里没有对应节点」处理。

**把已有流程换到别的项目**：CLI 没有移动命令，改为复制重建，原流程不动：

1. 源项目 `workflow get-draft` 存成 `draft.json`。
2. 在目标项目点选服务器，每个凭证槽按三选一重选（[credentials.md](reference/credentials.md)），再 `workflow create` 同名流程。
3. spec 只写要重绑凭证的节点 `{ "id": "n-…", "credentials": {…} }`，跑 `node $S/build.mjs spec.json --base draft.json --no-layout -o flow.json`。选「使用时再选」的槽要从该节点 `data.credentials` 和 `parameters` 两处手动删掉，再跑 `check.mjs`。
4. 照常 validate / save-draft / 试跑 / 确认版本号后发布。
5. 汇报里说明原流程还在原项目（已发布的仍在线），问要不要删除。

目标项目在另一个工作区时：第 1 步用源工作区的 `--profile`，之后都用目标工作区的；第 3 步后跑 `check.mjs --fetch --profile <目标>`（缓存目录用目标工作区的），画布里钉的包或版本在目标工作区没有时，列出缺的包问用户是改用目标工作区已有的版本（`--base` 换版本后重跑 build），还是按「环境里没有对应节点」先补包。删除按 [cli.md](reference/cli.md)「删除」的顺序先移除服务器再 `workflow delete`，确认前不执行。

## 校验闭环（步骤 7）

`check.mjs` 退出码 1 就按输出改（`--fix` 能合并重复边、补出口 label 和图标）。`workflow validate` 的输出落到文件，用 `result.mjs validate … --write-errors` 读：它只列 `issues`、按节点汇总表单 ERROR 写回顶层 `errors`（环不计入）。对照 `catalog.mjs` 摘要改 spec 重跑 build，或改 JSON，再校验，直到退出码 0。不要跳过校验直接试跑。

**环不算错误，但要核退出条件。** 只剩环时 `result.mjs` 退出 0 并提示核对：环上有离开循环的边就照常 save-draft、试跑、发布；没有就补 If / Switch（或已有节点的另一出口）再问用户退出条件。缺触发器、孤立节点、表单 ERROR 仍要修。WARNING（图标、出口 label、自定义出口 `icon` / `_id`）也要修。

## HTTP 接口

入口用当前环境的 Webhook 触发器（通常是 `WebhookTriggerNode`，以目录为准）。

**一个方法一条流程。** 触发器 `methods` 默认只勾一个方法。需求里同时有查询（GET）和提交（POST）时，各建一个触发器，各自校验、各自应答：可以是同一张画布的两段（见「多段画布」），也可以是两条流程。不要在一个触发器里勾 `GET` + `POST`，再用 `JsFunctionNode` / `IfNode` / `SwitchNode` 按 `msg.method` 分流。只有用户明确要求一条流程处理多个方法，或协议本身要求同一地址支持多个方法（如渠道回调用 GET 验证地址、用 POST 推送消息）时才合在一起，并在汇报里写明原因。

**默认不开跨域。** `options.cors` 是必填块，用户没提跨域、没说浏览器前端要直接调时写 `{"enabled": false, "allowedOrigins": "*", "allowedMethods": [与 methods 相同]}`。`enabled: false` 时这些值不生效，不要为 CORS 单独问用户。用户明确要求时才设 `enabled: true`：

- `allowedOrigins` 写用户给的具体域名，每行一个；没给就和其他缺口放在同一次提问里问，不要默认填 `*`。
- `allowCredentials` 默认 `false`，要带 Cookie 才开，开了 `allowedOrigins` 就不能是 `*`。
- `allowedMethods` 与 `methods` 一致；`allowedHeaders` 只写前端实际会发的 Header（开了认证就加 `Authorization` 或 API Key 的 Header 名）。
- 汇报里开了才写一行允许的来源，没开不提。

**认证先用这个触发器里已有的方式。** 对得上就写 `authType`，不要新做触发器，也不要在下游再验一遍：

| `authType` | 凭证槽 | 何时 |
|---|---|---|
| `none` | 无 | 用户没要求校验，或内网 / 网关已经鉴权 |
| `httpBasic` | `httpBasicAuth`（HttpBasicAuth） | HTTP Basic |
| `apiKey` | `apiKey`（HeaderAuth） | 自定义 Header，含固定 Token、签名放在某个 Header 里但**不依赖原始报文体** |
| `jwtAuth` | `jwtAuth`（JwtAuth） | `Authorization: Bearer` |

按 IP 限制访问写高级选项 `options.acl`，不要再单做一段 IP 判断。开了认证后凭证槽仍按三选一，不要自己挑一条。

**对不上表里的方式，再另做处理。** 微信支付、支付宝、Stripe 这类要按原始报文体验签的回调，`WebhookTriggerNode` 拿不到原始字节，不要写成 `apiKey` / `jwtAuth`，也不要在后面串验签节点。先找这个渠道自己的回调触发器；没有就按「环境里没有对应节点」做一个**触发器**（要求见 missing-bundle.md「验签回调」）。选了「处理完再返回」时，Success 末端接核心包的 `WebhookResponseNode`。

表单里没有 `authType`、需求也对不上上表、又不是原文验签时，才在触发器下游加一个真实存在的校验节点。不要把不存在的 `authType` 写进参数。

**默认校验入参，不合法不往下走。** 读库、调外部接口、改数据之前，先接核心包的 `ValidateNode`（以目录为准），只校验下游真正用到的字段，防止缺参数或参数不合法时误读、误改资源：

- 字段路径不加 `msg.`：路径参数 `pathParams.id`、查询 `query.page`、请求体 `body.userId`。同一字段可写多条，按「必填 → 类型 → 格式 / 范围」排，如 id 用 `pattern` 限成数字或 UUID、分页大小 `max` 封顶、状态用 `oneOf` 限定取值。可选字段打开 `skipIfMissing`，必填不要开。
- `Invalid` 出口接一个 `WebhookResponseNode` 返回 400，正文带 `msg.output.errors`（每项有 `field`、`check`、`code`、`message`），触发器 `responseMode` 用 `WebhookNode`。`Failure` 是规则本身写错（如正则不合法），按流程已有的失败处理接，不要当成 400。
- `keepOtherFields` 保持默认 `true`，下游照旧从 `msg.pathParams` / `msg.query` / `msg.body` 取入参，校验结果在 `msg.output`。
- 不要用 `JsFunctionNode` 手写一套 if 代替 `ValidateNode`；它表达不了的跨字段规则（如结束时间晚于开始时间）才在后面补 JS 或 If。
- 只有用户明确说不需要，或接口确实没有入参（如「返回当前时间」）时才省掉。汇报里列出校验了哪些字段、什么规则。

访问地址、连通检测和试跑步骤见 [reference/http.md](reference/http.md)。

## 数据一致性与事务

流程会写数据时，编排前先判断是哪种场景；只读流程不用管。先用 `catalog.mjs` 核实当前数据库包有哪些节点（如 `buildify/mysql` 的 `TransactionExecuteNode`：同一事务里按顺序执行多条 SQL，**任一步 SQL 报错**才整体回滚；`ExecuteSqlNode`：单条语句，写入输出 `output.affectedRows`，查询输出 `output.data` / `output.rowCount`）。

- **同一个库，多条写入要一起成功**（下单时写订单、扣库存、写流水）：放进一个 `TransactionExecuteNode` 的 `steps`，不要串几个 `InsertNode` / `UpdateNode` / `ExecuteSqlNode`，中途失败时前面写进去的收不回来。`Failure` 接失败应答或告警。
- **影响 0 行不算失败。** 条件不满足（库存不够、状态不对）时 `UPDATE` 只是 0 行，事务照常提交。后一步要依赖前一步时，在 SQL 里接上，如 `INSERT … SELECT … FROM DUAL WHERE ROW_COUNT() > 0`；事务后再查一次结果，用 `IfNode` 决定应答。见 recipes「事务与幂等」。
- **并发抢同一份数据**（扣库存、领券、改状态）：用带条件的更新 `UPDATE stock SET qty = qty - #{msg.body.qty} WHERE id = #{msg.body.skuId} AND qty >= #{msg.body.qty}`，再按影响行数或回查结果分支。不要先 SELECT、在 JS 里判断、再 UPDATE。
- **跨系统，进不了一个事务**（本地库 + 支付 / 第三方接口 / 发消息）：先写一条「处理中」记录，再调外部，成功改「成功」；外部调用的 `Failure` 把状态改「失败」并告警。外部成功、本地更新失败时记待补偿并告警，不要静默丢掉。要不要自动冲正（如退款）由用户定，和其他缺口放在同一次提问里问。
- **会被重复触发**（支付回调、Webhook 重试、定时任务重跑）：按业务唯一键（订单号、回调交易号）做幂等，配唯一索引，写入用条件判断（`NOT EXISTS`、按状态的条件更新）。处理过的直接返回成功，不重复扣款、发货、通知。
- SQL 参数一律 `#{}` 绑定，`${}` 只用于表名这类可信标识。
- 数据库包没有事务节点时，不要用 JS 或多个节点拼「假事务」：说明一致性风险，按「环境里没有对应节点」补节点，或请用户确认接受风险。
- 汇报里加一行「数据一致性」：哪几步在同一事务里、幂等键、失败怎么补偿。

## 通知与失败告警

- 失败告警的渠道以用户点名为准。没点名就问，选项是本流程已经在用的通知方式。不要把成功路径上的钉钉、飞书、邮件全部复制到失败分支；成功路径已有的通知不要因此删掉或改格式。
- `HttpRequestNode` 走 Failure 时上游字段还在，另带 `msg.error`（`code`、`message`，有时有 `statusCode`）。用 JS 组装告警正文，把 `code` 和 `message` 写在一起（如 `HTTP_IO_ERROR：ConnectException`）。
- 飞书卡片 `lark_md` 只稳定支持加粗、换行、链接。钉钉和飞书正文分开组装，失败告警 header `template` 用 `red`。见 [expressions.md](reference/expressions.md)「飞书卡片与失败原因」。
- 要试跑失败出口时，另用一份**不保存**的画布把请求地址改成连不上的地址再 `test-run -f`，草稿里仍是原地址。

## 发布与汇报

试跑成功（`result.mjs test-run` 退出 0）后才进入发布，发布到步骤 3 确认的那台服务器。草稿已在步骤 8 落库，**不要再传 flow.json**。

以下情况停在草稿，不问版本号、不 deploy：试跑失败或超时；用户说先不发布；选了「只保存草稿」；凭证选了「使用时再选」。试跑后又改了 JSON，先 `save-draft` 再 deploy。

**先点选确认版本元数据。** 版本号默认用确认当下的本地时间 `v` + `yyyyMMdd-HHmmss`（`date '+v%Y%m%d-%H%M%S'`）；用户指定了就用他的，不要改成 `v1.0.0`，也不要省略。发布说明按本流程写一句。选项：按此发布（推荐）/ 发布，但不要说明 / 先不发布；要改版本号或说明时用户选「其他」写出来。未选择前不要 deploy。

```bash
buildify --json workflow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v20261005-184620" --remark "首次上线 /test2 当前时间接口" --wait > deploy.json
node $S/result.mjs deploy deploy.json
```

`--wait` 在 CLI 内轮询到结束，**不要**再调 `workflow deployment` / `deployments` / `published`。失败时把服务器的 `message` 原样告诉用户。

保存草稿、试跑、发布后都用 Markdown 表汇报，模板和状态符号见 [reference/report.md](reference/report.md)：服务器用表不用列表；表格单元格不放彩色 emoji；只写名称不写 id；不输出节点信息（HTTP 访问地址除外）。

## 改名称、改服务器、改凭证、删除、历史

这些命令会改运行位置、凭证或删数据，用户没提出来就不要跑，确认前不要执行。部署记录、历史版本只在用户问过去的发布或某一版画布时才查。命令、409 含义和注意事项都在 [reference/cli.md](reference/cli.md)「改项目、改服务器、改凭证、删除」「部署记录与历史版本」。

## 工作区与密钥（步骤 1）

执行 CLI，不要读它的源码。找不到 `buildify` 命令时由你装好：先试 `~/.local/bin/buildify`，没有就按 [install.md](install.md)「装 buildify CLI」装（优先 `uv tool install -U buildify-cli`）。不用 `sudo`，不改系统 Python。

`buildify --json key test`：

- 退出码 0：再跑 `buildify --json config profiles`，按 `tenantId` 去重数工作区（同一个 `tenantId` 的多个 profile 算一个，用 `current` 那个，否则用列表里第一个）。只有一个工作区时不必加 `--profile`。不止一个时，`key test` 成功只说明默认（`current`）那把密钥能用，**不代表用户要用这个工作区**；新建流程按「多个工作区时新建」选，改已有流程按用户点名的流程所在的工作区：默认工作区里找不到这条流程时，并行查其他工作区的 `project list` / `workflow list` 再定，都没有才说不存在；同名流程在多个工作区都有时让用户点「工作区 / 项目 / 流程」。
- `data.reason=missing_api_key`：**停止编排**，按 [install.md](install.md)「buildify-cli 密钥」的模板请用户到 **系统设置 → API Keys → buildify-cli 密钥** 创建并发来 `keyId.secret`，不要原样转发 `data.userMessage`。profile 名用工作区的简短英文名，没有就用 `default`。收到后 `printf '%s' "$KEY" | buildify config add-profile "$PROFILE"` 再 `key test`。
- `data.reason=profile_required`：没有默认工作区。新建流程时直接按「多个工作区时新建」出「工作区 / 项目」题，不要先单独问一轮工作区；其他场景每个 profile 一个选项（名称、tenantId、密钥名），点一次。之后每条命令加 `--profile <name>`。不要 `config use`，除非用户明确要改默认工作区。
- `data.reason=workspace_key_missing`：请用户在 `.buildify-workspace` 指向的那个工作区创建密钥发来，不要改用别的工作区。
- 项目 404 且响应带 `tenantId` / `profile`：先问是不是工作区错了。退出码 2 且 `msg` 含「缺少权限」：密钥有效，请用户补上消息里的 scope，不要重建密钥。

**密钥安全：** 不要 `--api-key`；不要写进仓库、`.env` 或 commit；不要在回复里回显明文。本 CLI 不能创建密钥。

## Skill 版本（步骤 1）

`node $S/update-check.mjs` 和 `key test` 一起跑，按输出的 JSON 处理，同一次对话只提示一次：

- `updateAvailable` 为 true、`required` 为 false：在第一条回复开头说一句，然后照常编排，不要停下等回答：

  > buildify-workflow-dev 有新版本 {latest}（当前 {current}）：{notes 用「；」连起来}。说「更新 skill」我来更新。

  这次的汇报表最后加一行「Skill 版本」：`{current}，可更新到 {latest}`。
- `required` 为 true：当前版本太旧，按它编排可能出错。**停止编排**，说明当前版本、最新版本和要点，请用户确认更新；确认后更新再继续，用户坚持不更新就照常编排，汇报里写明版本过旧。
- `checked` 为 `failed` / `skipped`、已是最新，或本机没有 Node：什么都不说。

**用户说「更新 skill」时：** 对输出里的 `skillDir` 按 [install.md](install.md)「取文件」原地更新（git 仓库 `pull --ff-only`；不是 git 仓库或 pull 失败就先备份再重装），再跑一次 `node $S/update-check.mjs --force` 确认 `updateAvailable` 为 false。用表格汇报旧版本、新版本和要点，并提醒：新版说明要在**新开的对话**里才生效。当前对话里是否接着编排，由用户决定。不要顺手装别的客户端，也不要改用户的 git 配置。
