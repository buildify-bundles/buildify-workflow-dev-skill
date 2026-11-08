# buildify CLI

包：`buildify-cli`，命令：`buildify`，本文对应 **1.2.0**（`buildify version` 查看）。`buildify help` 打印与本文件对应的 `usage.md`。流程子命令是 **`workflow`**，不是 `flow`。流程 id 的选项仍是 `--flow` / `-w`。

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

选择顺序：`--api-key` / `BUILDIFY_OPENAPI_API_KEY` → `--profile` / `BUILDIFY_OPENAPI_PROFILE` → 仓库 `.buildify-workspace`（只有公开的 `tenantId`）→ `[openapi].current` → 唯一一把已存密钥。

`--json` 退出码 2 时按 `data.reason` 处理：

| reason | 做什么 |
|---|---|
| `missing_api_key` | 停下，按 [install.md](../install.md)「buildify-cli 密钥」的模板请用户创建并发来密钥，不要原样转发 `data.userMessage`（里面的菜单路径可能是旧的）。profile 名不必问，用工作区的简短英文名，没有就用 `default`，再用 stdin `add-profile`。 |
| `profile_required` | 列出 `data.profiles`（name、tenantId、keyName，无密钥），问一次用哪个。之后每条命令加 `--profile <name>`。不要 `config use`，除非用户明确要改默认工作区。 |
| `workspace_key_missing` | `.buildify-workspace` 指向的工作区本机没有密钥。向用户要**这个**工作区的密钥并 `add-profile`，不要改用别的工作区。 |

项目 404 的响应带 `tenantId` 和 `profile`。先问是不是工作区错了，再决定要不要在这里建项目。

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
| `key test` | 校验密钥并回显工作区（`tenantId` / `keyName`） |
| `config profiles` | 已存 profile，无密钥 |
| `bundle list [-k keyword]` | 可用 bundle。换几个同义词都查不到就停下编排，按 [missing-bundle.md](missing-bundle.md) 给默认方案、确认后交给 bundle-dev 建包开发发布再回来 |
| `bundle nodes -b NAME [-V ver]` | 节点目录（含 `icon` / `label` / `isTrigger` / `bundleVersion`）。目录 `summary` 是类型通用简述，不要当画布文案 |
| `bundle node-properties -b NAME -n NodeName [-V ver]` | 表单 schema（`schema.defaultValue` + `schema.properties[]`，每个字段带 **`uiComponent`**、`required`、`displayOptions`） |
| `bundle node-relations -b NAME -n NodeName [-V ver]` | 出口 relation 整份对象（`schema[]`） |

上面三条不要逐条手调：用 `node <skill 目录>/scripts/catalog.mjs fetch -b NAME -n A,B [-V ver]` 并行拉齐、存缓存并打印摘要。`-V` 是 `--bundle-version`，省略时取最新版。
| `bundle doc -b NAME` | README Markdown，参数含义不清时再读 |
| `bundle cred-types / cred-properties` | 凭证类型与表单，创建凭证前用 |
| `project list / create / get` | 项目 |
| `project update -p ID -n "新名称" [--remark 简介]` | 改项目名。不传 `--remark` 就保留原简介。先问用户 |
| `project delete -p ID` | 删项目。项目里还有流程时 HTTP 409。先问用户 |
| `project credentials -p ID [-b bundle]` | 可引用凭证元数据，无密钥 |
| `project create-credential -p ID -b bundle --type TYPE` | 仅当用户选「现在创建」。缺 name/label/data 时 `--json` 退出 3，`data.reason=credential_input_required`，返回默认名称和表单字段；确认后用 stdin `--file -` 创建。响应无密钥。不要 `--data` 上 argv |
| `project update-credential -p ID --credentials cred_… [--label 显示名] [--description 说明] [--bundle-version V] [--file -]` | 改凭证的显示名、说明、绑定的软件包版本或表单。至少传一项，没传的保持原值；`--description ''` 清空说明。表单用 stdin `--file -`，只合并传入的字段，空着或掩码的密钥字段保留原值。先问用户。`--json` 不弹确认；不要 `--data` 上 argv，不要回显密钥 |
| `project delete-credential -p ID --credentials cred_…` | 软删除凭证。还有流程引用时 HTTP 409。先用 `credential-workflows` 告诉用户哪些流程在用，再确认 |
| `project credential-workflows -p ID --credentials cred_… [--page 1] [--page-size 10]` | 分页列出引用这条凭证的流程，无密钥。权限同 `project credentials` |
| `project workers -p ID [--online-only]` | 服务器（worker）列表，含 `workerName` / `remark` / 在线状态 / `hostname`；服务端返回时还有 `externalHost` / `httpPort` / `publicIp`（试跑 HTTP 的候选访问地址，没有就问用户）。`hostname` 是机器名，不能当访问地址。给用户看时写 **workerName — 描述 — 在线/离线**（`remark` 为空写「无描述」），不展示 hostname |
| `workflow list -p ID` | 流程列表 |
| `workflow create -p ID -n "名称" --worker wkr_… [--remark 简介]` | 新建流程，`--worker` 必填（可重复），同时绑定服务器。返回的流程 id 用于 save-draft / deploy 的 `-w` |
| `workflow update -p ID -w WF -n "新名称" [--remark 简介]` | 改流程名。不传 `--remark` 就保留原简介。先问用户 |
| `workflow workers -p ID -w WF` | 已绑定的服务器，含 `workerName` / `remark` / 在线状态 / `deleteStatus`。0 已绑定，1 待移除。改已有流程时用它定服务器 |
| `workflow assign-workers -p ID -w WF --worker wkr_…` | 加服务器，可重复 `--worker`。已绑定的跳过。未发布只绑定（`needDeploy: false`）。已发布则把**当前线上版本**部署到新服务器（`needDeploy: true`，带 `deploymentId`），不是发布草稿，要告诉用户。不要自己轮询；响应里有 `warnings` 就原样说明。正在移除的服务器返回 409，把 `msg` 告诉用户 |
| `workflow unassign-workers -p ID -w WF --worker wkr_…` | 移除。未发布立刻解绑。已发布变成待移除并下线，绑定还在，直到服务器确认 |
| `workflow force-unassign-workers -p ID -w WF --worker wkr_…` | 立刻解绑。只在服务器已经不在、或普通移除停在待移除时，用户确认后再用 |
| `workflow delete -p ID -w WF` | 删流程。还有绑定（含待移除）时 HTTP 409。先问用户 |
| `workflow get-draft -p ID -w WF` | 草稿，画布在 `data.workflowJson`。`build.mjs --base` 直接吃整份响应 |
| `workflow save-draft -p ID -w WF -f flow.json` | 保存草稿；不传 `--version` 时自动先读乐观锁版本 |
| `workflow validate -p ID -f flow.json` | 无副作用语义校验；有 ERROR 时退出 4。输出落文件交给 `result.mjs validate`。图里的环允许，不要拆边去消；先确认环上有离开循环的出口，没有就补退出条件。只剩环且已有出口时仍可 save-draft / 试跑 / 发布 |
| `workflow test-run -p ID -f flow.json --worker wkr_… [--timeout 60] [-w WF]` | 阻塞直到完成或超时，默认跑整张图。输出落文件交给 `result.mjs test-run`。用户明确要单节点时才加 `--start-node` 和 `--inputs` |
| `workflow cancel-test --execution-id … --worker …` | 取消试跑 |
| `workflow deploy -p ID -w WF --worker wkr_… --version-name … [--remark 说明] --wait` | 发布已 save-draft 的草稿。不要再传 `-f`。`--worker` 必须已是 `deleteStatus` 0 的绑定 |
| `workflow published -p ID -w WF` | 线上版本及 `summary.servers`。用户事后问线上版本时画表。刚 `deploy --wait` 完不要再调。不要用它来选服务器 |
| `workflow deployments -p ID -w WF [--page N] [--page-size N] [--deployment deploy_…] [--begin "yyyy-MM-dd HH:mm:ss"] [--end "…"]` | 部署记录，新的在前。用户问历史时才调。权限 `project:workflow:view_deployment`。`--json` 的 `data` 是分页：`total` / `page` / `pageSize` / `data` / `hasNext` |
| `workflow deployment -p ID -w WF -d deploy_…` | 一次部署的状态。`--wait` 已在 CLI 内轮询，Agent 不要再循环调。`assign-workers` 返回了 `deploymentId` 且用户要看结果时，调一次即可 |
| `workflow versions -p ID -w WF [--page N] [--page-size N]` | 历史版本，新的在前，含草稿（`isDraft`）和仍绑在服务器上的版本（`isRunning`）。权限 `project:workflow:view_version` |
| `workflow get-version -p ID -w WF --version-id v-…` | 某一版的画布 `workflowJson`。只读，没有草稿锁的 `version`。要恢复成草稿先问用户，再走正常的 save-draft |

`-p` / `-w` 传 public id（`p-…` / `w-…`），不要传中文名称。

`--file -` 从 stdin 读 canvas JSON 或凭证 `data`。

## 推荐循环

每条命令单独执行，看完结果再走下一步（不要写成 shell 循环）：

```bash
S=<skill 目录>/scripts
node $S/build.mjs spec.json -o flow.json                          # 改已有加 --base draft.json
node $S/check.mjs flow.json --catalog-dir /tmp/buildify-catalog --fetch --fix
# 退出码 1：按输出改 spec 或 JSON 再跑，直到 0
buildify --json workflow validate -p "$PROJ" -f flow.json > validate.json
node $S/result.mjs validate validate.json --flow flow.json --write-errors
# 退出码 1：表单 ERROR 改参数再校验；只剩环时退出 0，但要确认环上有离开循环的出口
buildify --json workflow save-draft -p "$PROJ" -w "$WF" -f flow.json
buildify --json workflow test-run -p "$PROJ" -f flow.json --worker "$WKR" --timeout 60 > test-run.json
node $S/result.mjs test-run test-run.json --flow flow.json
buildify --json workflow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v20261005-184620" --remark "首次上线" --wait > deploy.json
node $S/result.mjs deploy deploy.json
```

多 profile 时每条加上 `--profile "$PROFILE"`。

`save-draft` 若冲突（退出码 4），`data` 是最新草稿：把它存成文件，用 `build.mjs --base` 在最新草稿上重放 spec 改动，不要盲着重试同一 version。

HTTP 接口的试跑在 save-draft 和 test-run 之间加一步连通检测，test-run 改成后台跑并请求测试地址，见 [http.md](http.md)。

`test-run` 的 HTTP 读超时 = 服务端 timeout + 30s。超时返回 `reason: "timeout"` 和已收到的部分事件，再用 `workflow cancel-test` 停 worker。

`workflow deploy` 在发布时传 `--version-name`（版本号）和 `--remark`（发布说明，写入该版本）。用户没有特殊指定版本号时，用确认当下的本地时间 `v` + `yyyyMMdd-HHmmss`（如 `v20261005-184620`），并写进 `--version-name`。默认 `--wait`。轮询走 `?statusOnly=true`，结束再 GET 一次完整摘要。刚发布完用这次返回的 `versionName` / `publishRemark` / `summary` 画表即可，不要再调 `workflow deployments`。

## 改项目、改服务器、改凭证、删除

这些命令会改运行位置、凭证或删数据。用户没提出来不要跑，能点选就点选，确认前不要执行。

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
