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

- 和 `buildify-bundle-dev` 分工：那个「做节点」，这个「用节点编流程」。
- 唯一接口是 `buildify` CLI（PyPI 包 `buildify-cli`），机器可读输出加 `--json`。下文 `$S` 指 `<本 skill 目录>/scripts`（Node 18+，不用装依赖）。

**省 token 的硬规则：**

- 脚本用法一律看 `node $S/<脚本>.mjs --help`（spec 格式看 `build.mjs --help`），**不要读 `scripts/` 源码，不要 grep 目录缓存文件**。
- **不要写 `node -e` / python / jq 去解析 CLI 的 JSON**；下面的脚本已经把要用的字段整理好了。不要把 `get-draft`、`test-run` 的原始输出读进对话。
- 脚本输出和 `catalog.mjs --hints` 仍说不清时才查文档：命令用法看 `buildify help <topic>`，节点用法看 `catalog.mjs doc -b 包 --node 节点`（整份文档按版本缓存一天，只打印那一节；`--section 硬规则` 看通用章节），不要读整份 `bundle doc`。

## 工作流

复制清单并逐项勾选：

```
流程编排进度：
- [ ] 1–3. node $S/prepare.mjs [-b 要用的包] [--flow 名称] → 定工作区、项目、流程、服务器（reference/workspace.md）
- [ ] 4. node $S/catalog.mjs find 关键词,同义词 → catalog.mjs fetch -b 包 -n 节点,节点 …；缺包或缺节点 → 「环境里没有对应节点」
- [ ] 5. 凭证：只问空槽，三选一（reference/credentials.md）
- [ ] 6. 写 spec → node $S/build.mjs spec.json -o flow.json；WARNING 逐条处理（改已有先 get-draft → draft.mjs）
- [ ] 7–8. node $S/ship.mjs flow.json -p P (-w W | --create 名称 --worker WKR)：check → validate → 保存
- [ ] 9. 有写库 / 发消息 / 调外部接口时先确认用测试数据 → node $S/trial.mjs flow.json -p P -w W --worker WKR
- [ ] 10. node $S/release.mjs --stamp → 点选确认版本号和说明 → node $S/release.mjs … --version-name V --remark … → 发布表
```

- **1–5 缺什么才问什么**，同一次提问里问完（点选题规则见 workspace.md）。缺口没回复前不要 create / 保存 / 试跑 / 发布。prepare 输出里有 `Skill:` 一行时按 [update.md](reference/update.md) 处理。
- **4**：`catalog.mjs fetch` 打印每个节点的 `icon` / `label` / 触发器、参数（必填、`uiComponent`、枚举、默认值、显示条件）、凭证槽和出口，写参数就照它；含义不清加 `--hints`。用 http 宏时不用拉 `WebhookTriggerNode` / `ValidateNode`，build 会自己补。
- **7–8**：凭证选了「使用时再选」时加 `--credentials-later`。退出码 1 按输出改 spec 重跑 build 再 ship；4 是新建或保存失败（冲突时按输出用 `latest-draft.json` 重放）。新建用用户给的名称，没给就用展示过的建议名。
- **9**：凭证选了「使用时再选」则停在草稿，不试跑。HTTP 流程退出码 5（地址不通）按 [http.md](reference/http.md) 问用户。
- **10**：只在试跑通过、且用户没选「只保存草稿」时进行。见「发布与汇报」。

## 按任务读取（勿一次全读）

| 场景 | 读 |
|---|---|
| 密钥、工作区、项目、服务器的选择与切换、复制到别的项目 | [reference/workspace.md](reference/workspace.md) |
| spec 骨架：定时拉取推送、HTTP 接口、分支、改已有、多段、分组、事务与幂等 | [reference/recipes.md](reference/recipes.md) |
| HTTP 接口规则（一个方法一条流程、跨域、认证、验签回调、入参校验）、访问地址、试跑 | [reference/http.md](reference/http.md) |
| 流程会写数据：事务、并发、跨系统、幂等 | [reference/data-consistency.md](reference/data-consistency.md) |
| 失败告警、钉钉 / 飞书通知 | [reference/alerts.md](reference/alerts.md) |
| 参数里的表达式（按 `uiComponent`）、JS 代码注释、飞书卡片与失败原因 | [reference/expressions.md](reference/expressions.md) |
| 凭证三选一、现在创建 | [reference/credentials.md](reference/credentials.md) |
| CLI 命令、退出码、改名 / 改服务器 / 改凭证 / 删除、部署记录、历史版本 | [reference/cli.md](reference/cli.md) |
| 画布 JSON 字段、边、分组、批注（手改 JSON 时） | [reference/flow-json.md](reference/flow-json.md) |
| 用户要求时才加的批注、HTTP 接口文档正文 | [reference/comment-node.md](reference/comment-node.md) |
| 保存 / 试跑 / 发布后的汇报表格与状态符号 | [reference/report.md](reference/report.md) |
| 没有软件包或缺节点 | [reference/missing-bundle.md](reference/missing-bundle.md) |
| Skill 版本提示、更新 skill | [reference/update.md](reference/update.md) |
| 没有 Node，只能手算坐标 | [reference/layout-manual.md](reference/layout-manual.md) |

## 脚本速查

| 脚本 | 做什么 |
|---|---|
| `prepare.mjs` | 步骤 1–3：并行查密钥、版本、工作区、项目、服务器、凭证、同名流程；`--pin` 把项目固定到本仓库 |
| `catalog.mjs find / fetch / show / doc / cache` | 搜包；拉节点目录、表单、出口进持久缓存并打印摘要；按节看文档；查看或清理缓存 |
| `build.mjs` | spec → 画布（补齐字段、默认值、出口、凭证、http 宏、排版），并做本地预检 |
| `draft.mjs` | 把 `get-draft` 输出整理成 spec 视图；`--node` 看单个节点完整参数 |
| `ship.mjs` | check → validate → 新建（可选）→ save-draft |
| `trial.mjs` | 试跑；HTTP 流程自动测地址、发正常和不合法两条请求 |
| `release.mjs` | `--stamp` 出默认版本号；deploy --wait 并打印发布摘要 |
| `check.mjs` / `result.mjs` / `layout.mjs` | 单独检查画布 / 整理 CLI 输出（`--node` `--path` 看节点输出）/ 单独重排；一般由上面的脚本调用 |

退出码统一：0 通过；1 有 ERROR / 没通过（按输出修）；3 文件、参数或拉取失败；ship 的 4 是保存失败，trial 的 5 是地址不通，prepare 的 2 是密钥不可用。多工作区时每个脚本都加同一个 `--profile`（包括只读的 draft / check），目录缓存自动按 profile 分开；漏了时 build / draft 会提示该加哪个。

## 写 spec（步骤 6）

**写 spec，不手写画布 JSON。** spec 只写业务内容（节点 `key` / `bundle` / `name` / `summary` / `parameters` / `credentials` / `parent`，边 `[from, to, 出口]`），格式见 `build.mjs --help`，骨架见 recipes。HTTP 入口写 `http` 宏，触发器、入参校验、400 应答和接住各节点 Failure 的 500 应答由脚本展开。只有脚本表达不了的改动才手改 JSON，改完跑 `check.mjs --fix` 和 `layout.mjs`。

build 的 WARNING 都要处理：必填没填（只查当前显示的字段）、凭证槽没绑、JS 下游误用 `msg.output`、表达式写法、`summary` 超长、JS 没注释、SQL 用 `${}` 拼请求值、UPDATE / DELETE 没有 WHERE、多个节点分别写库、HTTP 接口有出口走不到应答。

- **默认易读。** 用户给了具体结构就照做，否则：主流程从触发器一路往下一条直线，分支短、尽快在应答或告警结束；一个节点只做一件事；能用现成节点就不用 JS（校验 `ValidateNode`，判断 `IfNode` / `SwitchNode`，改字段 `SetNode`，调接口 `HttpRequestNode`）；不加只透传的节点；不同接口、不同触发器各自一段。
- **`summary`**：这颗节点在本流程里的职责，**≤8 字**（如「接收请求」「查询设备」），不要照抄目录 `summary`。
- **参数**：只写要改的键，默认值脚本会补。表达式按字段 `uiComponent` 选语法：`JsonExpressionInput` 整字段 `"={{msg.xxx}}"` 保留类型；`SqlEditor` 值用 `#{}`、`${}` 只用于可信标识；文本及其他用 `{{ }}`。见 [expressions.md](reference/expressions.md)。
- **取值层级**：触发器字段在 `msg.xxx`；普通节点结果在 `msg.output.xxx`；**`JsFunctionNode` 的返回值就是下游的整个 `msg`**。
- **JS 节点** `code` 分段并写中文注释：顶部写入参 / 出参，每段 `// --- 段名 ---`。
- **分支**以不交叉为准：能沿流向干净汇合才共用下游，否则各支路复制一份（另起 key），不复制触发器。至少 3 个旁支汇到同一个没有出边的收尾节点时保持共用。
- **出口**：一对节点只连一条边，多个出口接同一下游写 `["a","b","Success,Failure"]`；想让某个出口的分支在左 / 上就把它的边写在前面。
- **循环允许，但必须有出口**（If / Switch 的另一支、失败出口、次数用尽、超时）。没有就补退出条件，条件不清楚就问用户。
- **默认不加批注、不写接口文档、不分组。** 用户要求时才加 `comment`（见 comment-node.md）。执行节点约 15 个以上或能清楚分出几块职责时按模块分组，组内节点写 `parent`，分组框只写标题。
- **方向** `direction` 默认 `TB`；用户要横排才 `LR`；改已有沿用草稿。
- **改已有草稿**：`get-draft` → `draft.mjs` 看节点 id 和改过的参数 → spec 用旧 `id` 只写要改的节点 → `build.mjs --base draft.json`。类型不变就沿用旧 id，不要 `remove` 再建同类型（ERROR）；换 `name` 或包名时仍写旧 id，build 分配新 id 并改写边。只改参数加 `--no-layout`；改动只在一个分组里用 `layout.mjs --group`；用户手动调过布局时先问再重排。详见 recipes「改已有流程」。
- **会写数据**的流程先按 [data-consistency.md](reference/data-consistency.md) 定事务和幂等；有失败告警按 [alerts.md](reference/alerts.md)。

## 环境里没有对应节点：先做 Bundle，再回来编排

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。`catalog.mjs find` 一次给齐两三个同义词都没命中是**缺软件包**；包在但 `catalog.mjs fetch -b 包` 列表里没有是**缺节点**。缺节点时先看同包有没有 `…ApiCall` 通用调用节点，有就按厂商官方文档填参数直接用。

确实没有时**立刻停止**写 spec / 保存 / 试跑 / 发布，按 [missing-bundle.md](reference/missing-bundle.md) 走：说明不存在并拟默认方案 → 确认一次（用户已要求直接做就不问）→ 交给 bundle-dev 建包、开发、发布 → 回到步骤 4 重新取真实的 `bundleVersion` / `icon` / 表单 / 出口，汇报里加「新增 Bundle」。不要让用户去控制台建软件包。

## 校验（步骤 7）

ship 输出的 ERROR 逐条改 spec 重跑，不要跳过校验直接试跑。**环不算错误**，只剩环时 ship 照常保存，但要确认环上有离开循环的边；没有就补退出条件。缺触发器、孤立节点、表单 ERROR、图标 / 出口 label 的 WARNING 都要修。

## 发布与汇报

试跑通过（`trial.mjs` 退出 0）后才发布，发到步骤 3 确认的那台服务器。以下情况停在草稿，不问版本号、不发布：试跑失败或超时；用户说先不发布；选了「只保存草稿」；凭证选了「使用时再选」。试跑后又改了画布，先 ship 再发布。

**先点选确认版本元数据。** 版本号用 `release.mjs --stamp` 的输出（确认当下的本地时间）；用户指定了就用他的，不要改成 `v1.0.0`，也不要省略。发布说明按本流程写一句。选项：按此发布（推荐）/ 发布，但不要说明 / 先不发布；要改时用户选「其他」写出来。未选择前不要发布。发布后**不要**再调 `workflow deployment` / `deployments` / `published`；失败时把服务器的 `message` 原样告诉用户。

保存、试跑、发布后都用 Markdown 表汇报，模板见 [report.md](reference/report.md)：服务器和凭证各成一节，服务器写名称和状态，凭证写显示名；单元格不放彩色 emoji；只写名称不写 id；不输出节点信息（HTTP 访问地址除外）。

改名、改服务器、改凭证、删除、查历史：用户没提出来不要跑，确认前不执行，见 [cli.md](reference/cli.md)。

**密钥安全：** 不要 `--api-key`；不要写进仓库、`.env` 或 commit；不要在回复里回显明文；不要 `config use`，除非用户明确要改默认工作区。
