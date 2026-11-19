# buildify CLI

包：`buildify-cli`，命令：`buildify`，本文对应 **1.5.0**（`buildify version` 查看）。`buildify help` 只打印一屏命令目录，细节按主题看：`buildify help <topic>`（`config` `commands` `bundle` `project` `credentials` `workflow` `validate` `test` `deploy` `json` `exit`），只看要用的那个。流程子命令是 **`workflow`**，不是 `flow`。流程 id 的选项仍是 `--flow` / `-w`。

## 配置与工作区

密钥在控制台 **系统设置 → API Keys → buildify-cli 密钥** 创建，明文只在创建时显示一次，格式 `keyId.secret`。CLI 返回的 `data.userMessage` 里的菜单路径可能是旧的，告诉用户时以这里为准。一把密钥只属于一个工作区。本 CLI 不能创建密钥。

多个工作区就存多个 profile。`add-profile` **不改**默认工作区。

```bash
printf '%s' 'keyId.secret' | buildify config add-profile acme
buildify config set-key base_url https://openapi.buildify.cn
buildify --json key test
buildify --json config profiles
```

`config set-key api_key` 只更新**当前** profile；还没有 profile 时才写旧的单密钥。新密钥用 `add-profile`。不要 `--api-key`，不要把明文写进仓库、`.env` 或对话。保存后只展示 `config profiles` / `config show` 的掩码。

`config profiles` 返回 `current` 和每个 profile 的 `name` / `tenantId` / `tenantName` / `keyName` / `keyPrefix` / `current`。同一个 `tenantId` 可能存了多把密钥（多个 profile），按 `tenantId` 去重才是工作区数。`tenantName` 是工作区显示名（控制台里的名称），`key test` 成功后写进本机 profile（CLI 1.4.0）。对用户用 `tenantName`；还没有（1.3.x，或这把密钥还没成功 `key test`）才用 profile 名。`--profile` 仍传 profile 名，不要传显示名。新建流程时怎么选工作区见 [workspace.md](workspace.md)「多个工作区」。`prepare.mjs` 已经并行查好并去重，一般不用自己调。

选择顺序：`--api-key` / `BUILDIFY_OPENAPI_API_KEY` → `--profile` / `BUILDIFY_OPENAPI_PROFILE` → 仓库 `.buildify-workspace`（只有公开的 `tenantId`）→ `[openapi].current` → 唯一一把已存密钥。

`--json` 退出码 2 时按 `data.reason` 处理：

| reason | 做什么 |
|---|---|
| `missing_api_key` | 停下，按 [install.md](../install.md)「buildify-cli 密钥」的模板请用户创建并发来密钥，不要原样转发 `data.userMessage`（里面的菜单路径可能是旧的）。profile 名不必问，用工作区的简短英文名，没有就用 `default`，再用 stdin `add-profile`。 |
| `profile_required` | 列出 `data.profiles`（name、tenantName、tenantId、keyName，无密钥）。选项写显示名，问一次用哪个。之后每条命令加 `--profile <name>`（profile 名，不是显示名）。不要 `config use`，除非用户明确要改默认工作区。 |
| `workspace_key_missing` | `.buildify-workspace` 指向的工作区本机没有密钥。向用户要**这个**工作区的密钥并 `add-profile`，不要改用别的工作区。 |

项目 404 的响应带 `tenantId`、`tenantName` 和 `profile`。先问是不是工作区错了（对用户说 `tenantName`），再决定要不要在这里建项目。

`BUILDIFY_OPENAPI_NO_PROMPT=1` 关闭交互提示。与 `buildify-publish` 共用 `~/.buildifyrc`，section 不同，密钥不会互相覆盖。

## 退出码

| Code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 通用失败 |
| 2 | 缺配置 / 401 / 403 / 需要选择 profile |
| 3 | 本地问题（JSON 坏、文件不存在、创建凭证缺字段） |
| 4 | HTTP 4xx/5xx，**或 `workflow validate` 有 ERROR** |
| 5 | 网络 |

`--json` 时 stdout 只有一行 `{ok, code, msg, http_status, data}`。

退出码 2 且 `msg` 含「缺少权限」：密钥有效，缺的是消息里的 scope（如 `project:workflow:view_deployment`、`project:workflow:view_version`）。请用户到控制台给这把密钥补上，不要当成 401 去重建。401 才是密钥无效。项目不在密钥允许范围内时返回 404 `项目不存在`。

## 命令

选定 profile 后，下面每条都加上同一个 `--profile`（只有一把密钥、或已由 `.buildify-workspace` / current 选定则不必）。

| CLI | 用途 |
|-----|------|
| `health` | 探活，无需密钥 |
| `key test` | 校验密钥并回显工作区（`tenantName` / `tenantId` / `keyName`），`missingScopes` 是编排还缺的权限（空数组表示查、存、试跑、发布都可以）。成功后把 `tenantName` 记到当前 profile |
| `config profiles` | 已存 profile，无密钥 |
| `bundle list [-k keyword]` | 可用 bundle。换几个同义词都查不到就停下编排，按 [missing-bundle.md](missing-bundle.md) 给默认方案、确认后交给 bundle-dev 建包开发发布再回来 |
| `bundle nodes -b NAME [-V ver]` | 节点目录（含 `icon` / `label` / `isTrigger` / `bundleVersion`，不含参数默认值）。目录 `summary` 是类型通用简述，不要当画布文案 |
| `bundle schema -b NAME -n A,B,C [-V ver]` | 一次取回多个节点的表单（`properties.defaultValue` + `properties.properties[]`，字段带 **`uiComponent`**、`required`、`displayOptions`）和出口（`relations[]`）。有一个名字不存在整次失败 |
| `bundle node-properties` / `node-relations -b NAME -n NodeName [-V ver]` | 单个节点的表单 / 出口，`bundle schema` 的旧拆分写法 |

上面几条不要手调：用 `node <skill 目录>/scripts/catalog.mjs fetch -b NAME -n A,B [-V ver]`，它用 `bundle schema` 一次拉齐、存缓存并打印摘要。`-V` 是 `--bundle-version`，省略时取最新版。
| `bundle doc -b NAME [--node NodeName]` | 使用说明 Markdown。用 `catalog.mjs doc -b NAME --node NodeName` 代替：整份每版本拉一次缓存一天，只打印那一节（约 2KB）；不要把整份（单个包可达 170KB）读进对话 |
| `bundle cred-types / cred-properties` | 凭证类型与表单，创建凭证前用 |
| `project list / create / get` | 项目 |
| `project update -p ID -n "新名称" [--remark 简介]` | 改项目名。不传 `--remark` 就保留原简介。先问用户 |
| `project delete -p ID` | 删项目。项目里还有流程时 HTTP 409。先问用户 |
| `project credentials -p ID [-b bundle]` | 可引用凭证元数据，无密钥 |
| `project create-credential -p ID -b bundle --type TYPE` | 仅当用户选「现在创建」。缺 name、显示名或 data 时 `--json` 退出 3，`data.reason=credential_input_required`。`missing` 里显示名的键是 `displayName`，建议值在 `defaults.displayName`（1.4.x 是 `defaults.label`）。命令行仍用 `--label` 传入显示名。确认后用 stdin `--file -` 创建。响应无密钥，显示名在 `displayName`。不要 `--data` 上 argv |
| `project update-credential -p ID --credentials cred_… [--label 显示名] [--description 说明] [--bundle-version V] [--file -]` | 改凭证的显示名、说明、绑定的软件包版本或表单。至少传一项，没传的保持原值；`--description ''` 清空说明。命令行仍是 `--label`，接口字段是 `displayName`（1.4.x 响应用 `label`）。表单用 stdin `--file -`，只合并传入的字段，空着或掩码的密钥字段保留原值。先问用户。`--json` 不弹确认；不要 `--data` 上 argv，不要回显密钥 |
| `project delete-credential -p ID --credentials cred_…` | 软删除凭证。还有流程引用时 HTTP 409。先用 `credential-workflows` 告诉用户哪些流程在用，再确认 |
| `project credential-workflows -p ID --credentials cred_… [--page 1] [--page-size 10]` | 分页列出引用这条凭证的流程，无密钥。权限同 `project credentials` |
| `project workers -p ID [--online-only]` | 服务器（worker）列表：`workerId` / `workerName` / `remark` / `isOnline` / `accessUrls`（HTTP 访问地址，按优先顺序，形如 `http://1.2.3.4:8008`；空数组就问用户）。给用户看时写 **workerName — 描述 — 在线/离线**（`remark` 为空写「无描述」） |
| `workflow list -p ID [-k 名称]` | 流程列表，`-k` 按名称过滤 |
| `workflow create -p ID -n "名称" --worker wkr_… [--remark 简介] [-f flow.json] [--validate]` | 新建流程，`--worker` 必填（可重复），同时绑定服务器。带 `-f` 时画布一起存成草稿，不用再 save-draft；加 `--validate` 时画布有 ERROR 就不建。返回流程 id 和草稿 `version` |
| `workflow update -p ID -w WF -n "新名称" [--remark 简介]` | 改流程名。不传 `--remark` 就保留原简介。先问用户 |
| `workflow workers -p ID -w WF` | 已绑定的服务器，含 `workerName` / `remark` / 在线状态 / `deleteStatus`。0 已绑定，1 待移除。改已有流程时用它定服务器 |
| `workflow assign-workers -p ID -w WF --worker wkr_…` | 加服务器，可重复 `--worker`。已绑定的跳过。未发布只绑定（`needDeploy: false`）。已发布则把**当前线上版本**部署到新服务器（`needDeploy: true`，带 `deploymentId`），不是发布草稿，要告诉用户。不要自己轮询；响应里有 `warnings` 就原样说明。正在移除的服务器返回 409，把 `msg` 告诉用户 |
| `workflow unassign-workers -p ID -w WF --worker wkr_…` | 移除。未发布立刻解绑。已发布变成待移除并下线，绑定还在，直到服务器确认 |
| `workflow force-unassign-workers -p ID -w WF --worker wkr_…` | 立刻解绑。只在服务器已经不在、或普通移除停在待移除时，用户确认后再用 |
| `workflow delete -p ID -w WF` | 删流程。还有绑定（含待移除）时 HTTP 409。先问用户 |
| `workflow get-draft -p ID -w WF` | 草稿，画布在 `data.workflowJson`。`build.mjs --base` 直接吃整份响应。存取的画布不带编辑器字段（节点 `initialized` / `sourcePosition` / `targetPosition`，边的坐标、`zIndex`、空 `label`），连接点朝向按顶层 `direction` |
| `workflow save-draft -p ID -w WF -f flow.json [--validate]` | 保存草稿；不传 `--version` 时自动先读乐观锁版本。`--validate` 在同一次请求里校验，有 ERROR 不保存、退出 4 |
| `workflow validate -p ID -f flow.json` | 无副作用语义校验；有 ERROR 时退出 4。输出落文件交给 `result.mjs validate`。图里的环允许，不要拆边去消；先确认环上有离开循环的出口，没有就补退出条件。只剩环且已有出口时仍可 save-draft / 试跑 / 发布 |
| `workflow test-run -p ID -f flow.json --worker wkr_… [--timeout 60] [-w WF]` | 阻塞直到完成或超时，默认跑整张图。输出落文件交给 `result.mjs test-run`。用户明确要单节点时才加 `--start-node` 和 `--inputs` |
| `workflow cancel-test --execution-id … --worker …` | 取消试跑 |
| `workflow deploy -p ID -w WF --worker wkr_… --version-name … [--remark 说明] --wait` | 发布已 save-draft 的草稿。不要再传 `-f`。`--worker` 必须已是 `deleteStatus` 0 的绑定 |
| `workflow published -p ID -w WF [--nodes]` | 线上版本、`summary.servers` 和 `webhookPaths`（触发器路径）。不加 `--nodes` 不返回节点表。用户事后问线上版本时画表。刚 `deploy --wait` 完不要再调。不要用它来选服务器 |
| `workflow deployments -p ID -w WF [--page N] [--page-size N] [--deployment deploy_…] [--begin "yyyy-MM-dd HH:mm:ss"] [--end "…"]` | 部署记录，新的在前。用户问历史时才调。权限 `project:workflow:view_deployment`。`--json` 的记录列表就是 `data`，`total` / `page` / `pageSize` / `hasNext` 在信封顶层 |
| `workflow deployment -p ID -w WF -d deploy_…` | 一次部署的状态。`--wait` 已在 CLI 内轮询，Agent 不要再循环调。`assign-workers` 返回了 `deploymentId` 且用户要看结果时，调一次即可 |
| `workflow versions -p ID -w WF [--page N] [--page-size N]` | 历史版本，新的在前，含草稿（`isDraft`）和仍绑在服务器上的版本（`isRunning`）。权限 `project:workflow:view_version` |
| `workflow get-version -p ID -w WF --version-id v-…` | 某一版的画布 `workflowJson`。只读，没有草稿锁的 `version`。要恢复成草稿先问用户，再走正常的 save-draft |

`-p` / `-w` 传 public id（`p-…` / `w-…`），不要传中文名称。

`--file -` 从 stdin 读 canvas JSON 或凭证 `data`。

凭证 JSON 的显示名从 CLI **1.5.0** 起是 `displayName`（`project credentials`、创建响应、发布摘要 `summary.credentials` 都是）。1.4.x 仍是 `label`。节点类型、出口和边的 `label` 没有改。创建和修改的命令行参数仍是 `--label`。

## 推荐循环

日常编排用脚本把多条命令合成一步，每条单独执行，看完结果再走下一步（不要写成 shell 循环）：

```bash
S=<skill 目录>/scripts
node $S/prepare.mjs -b buildify/mysql                              # 步骤 1–3：密钥、项目、服务器、凭证、流程
node $S/catalog.mjs find 钉钉,dingtalk                              # 步骤 4：搜包
node $S/catalog.mjs fetch -b buildify/core -n WebhookTriggerNode,ValidateNode
node $S/build.mjs spec.json -o flow.json                           # 改已有：get-draft → draft.mjs → --base draft.json
node $S/ship.mjs flow.json -p "$PROJ" -w "$WF"                     # check --fix → validate → save-draft（新建用 --create 名称 --worker，画布随 create 一起存）
node $S/trial.mjs flow.json -p "$PROJ" -w "$WF" --worker "$WKR"    # test-run；HTTP 自动测地址、发请求
node $S/release.mjs --stamp                                        # 默认版本号，给用户确认
node $S/release.mjs -p "$PROJ" -w "$WF" --worker "$WKR" --version-name v20261005-184620 --remark "首次上线"
```

每个脚本的参数和退出码看 `--help`。多 profile 时每条加上 `--profile "$PROFILE"`，目录缓存自动按 profile 分开。

**缓存：** 节点目录、表单、出口和文档存在持久缓存目录（macOS `~/Library/Caches/buildify/catalog`，Linux `~/.cache/buildify/catalog`，可用 `BUILDIFY_CATALOG_DIR` 改），跨会话复用：

- 正式版本发布后不能覆盖，一直复用；`-SNAPSHOT` 版本 10 分钟后重拉。
- 不写版本时 1 小时内复用上次查到的最新版本；文档 1 天内复用（`bundle doc set` 可以不改版本覆盖文档）。
- 刚发布了新包或新版本、怀疑拿到旧数据时加 `--refresh`。`catalog.mjs cache [--profile P]` 看位置和大小，`--clear` 清空。

脚本背后的 CLI 规则（直接调命令时才要关心）：

- `save-draft` 冲突（退出码 4）时 `data` 是最新草稿：用 `build.mjs --base` 在最新草稿上重放 spec 改动，不要盲着重试同一 version。`ship.mjs` 会把它存成 `latest-draft.json`。
- `test-run` 的 HTTP 读超时 = 服务端 timeout + 30s。超时返回 `reason: "timeout"` 和已收到的部分事件，再用 `workflow cancel-test` 停 worker。
- `workflow deploy` 传 `--version-name` 和 `--remark`，默认 `--wait`（轮询走 `?statusOnly=true`，结束再取一次完整摘要）。刚发布完用这次返回的 `versionName` / `publishRemark` / `summary` 画表，不要再调 `workflow deployments`。
- 发布相关的返回只给枚举（`deployStatus`：`success` / `success_with_warnings` / `failed` / `timeout` / `running` / `canceled` / `pending`；`isOnline`；`deleteStatus`），不再带图标和中文标签，按 [report.md](report.md)「状态映射」换成符号（`result.mjs deploy` 已经换好）。

**少读长输出：** `buildify help` 只看相关的 `help <topic>`；文档用 `catalog.mjs doc --node` / `--section` 只看一节，且只在脚本输出与 `catalog.mjs --hints` 仍说不清时读；`bundle list` 一定带 `-k`（或用 `catalog.mjs find`）；`get-draft` 用 `draft.mjs` 看，`test-run` 用 `result.mjs` 看，不要把原始 JSON 读进对话。

## 改项目、改服务器、改凭证、删除

这些命令会改运行位置、凭证或删数据。用户没提出来不要跑，能点选就点选，确认前不要执行。

- **换项目 / 换工作区**：没有移动流程的命令。按 [workspace.md](workspace.md)「把已有流程换到别的项目」在目标项目复制重建，原流程保留，问过用户才删。跨工作区时读源草稿用源 `--profile`，其余都用目标 `--profile`。
- **改名**：`project update` / `workflow update` 必传 `-n`。用户没说要改简介就不传 `--remark`，原简介会留下。
- **加服务器**：`assign-workers` 加的是绑定。流程已发布时顺带把**当前线上版本**发到新服务器（不是草稿），告诉用户这一点；草稿仍要按推荐循环 save-draft / 试跑 / deploy。`needDeploy: false` 表示没有新的部署。用户要看这次结果时再调一次 `workflow deployment -d`。
- **移除服务器**：`unassign-workers`。没发布过的立刻解绑；已发布的变成待移除并下线，绑定还在，服务器确认前 `workflow delete` 返回 409「当前流程存在关联部署服务器」。
- **强制移除**：只在用户说明服务器已经不在、或普通移除一直停在待移除时才用 `force-unassign-workers`。它立刻删掉绑定，离线服务器下次同步时丢掉这个流程。
- **删除**：`project delete` 在项目还有流程时返回 409「项目存在流程,请先删除流程」。要删流程就先移除服务器，待移除消不掉时再问要不要强制移除，然后才能 `workflow delete`。
- **改凭证**：`credentialsId` 从 `project credentials` 取，对用户只说凭证的显示名。只传用户要改的项；改表单时只把要改的字段用 stdin `--file -` 传，空着的密钥保留原值。改表单会影响所有引用它的流程，改前用 `credential-workflows` 列出来告诉用户。密钥不要回显。
- **删凭证**：先 `credential-workflows` 看谁在用。`delete-credential` 返回 409 表示还有流程在用：告诉用户是哪些流程，问是先给它们换凭证还是不删，不要自己改那些流程。
- **凭证被哪些流程使用**：只读，直接 `credential-workflows`，按流程名列表汇报，`hasNext` 为真且用户还要看时再翻页。

## 部署记录与历史版本

刚 `deploy --wait` 完不要查。用户问过去的发布、哪一版在跑、或要看某一版画布时才查，表格见 [report.md](report.md)「事后查询」。`--page` 从 1 起，`--page-size` 最大 100，默认 10。时间参数带空格，要加引号。

`workflow versions` 里 `isDraft: true` 是当前草稿，`isRunning: true` 是仍绑在某台服务器上的版本。`get-version` 的 `workflowJson` 不能当作 save-draft 的锁版本：用户要恢复成草稿时先确认，再把这份画布走正常的 validate / save-draft，不要直接 deploy。退出码 2 且 `msg` 含「缺少权限」时缺的是 `project:workflow:view_deployment` 或 `project:workflow:view_version`，请用户给密钥补权限。
