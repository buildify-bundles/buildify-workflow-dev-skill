# buildify CLI

包：`buildify-cli`，命令：`buildify`。`buildify help` 打印与本文件对应的 `usage.md`。流程子命令是 **`workflow`**，不是 `flow`。流程 id 的选项仍是 `--flow` / `-w`。

## 配置与工作区

密钥在控制台 **空间设置 → 开放 API 密钥 → 创建** 签发，明文只显示一次，格式 `keyId.secret`。一把密钥只属于一个工作区。本 CLI 不能创建密钥。

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
| `missing_api_key` | 把 `data.userMessage` 原样给用户。问一个简短 profile 名，再用 stdin `add-profile`。 |
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

## 命令

选定 profile 后，下面每条都加上同一个 `--profile`（只有一把密钥、或已由 `.buildify-workspace` / current 选定则不必）。

| CLI | 用途 |
|-----|------|
| `health` | 探活，无需密钥 |
| `key test` | 校验密钥并回显工作区（`tenantId` / `keyName`） |
| `config profiles` | 已存 profile，无密钥 |
| `bundle list [-k keyword]` | 可用 bundle。需求对应的包不在列表里 → 停止编排，请用户用 buildify-bundle-dev 实现并发布后再继续 |
| `bundle nodes -b NAME [-V ver]` | 节点目录（已展平 `groups_json[].nodes` + `nodes_json`，含 `icon` / `label` / `isTrigger`）。目录 `summary` 是类型通用简述，**不要**直接当作画布文案 |
| `bundle node-properties -b NAME -n NodeName` | 表单 schema → `data.parameters`；同时带回 `icon` / `label` / `summary` / `isTrigger` / **`uiComponent`**。按组件写表达式：JSON 默认 `"={{msg.xxx}}"`（要字符串才 `"=前缀 {{msg.xxx}}"`，禁止 `this is ={{msg.xxx}}`），SQL `#{}` `${}`，文本 `{{ }}`。画布 `data.summary` 仍按本流程职责自写，且 ≤8 字 |
| `bundle node-relations -b NAME -n NodeName` | 出口 relation 整份对象 → `edges[].data.relations[]`（`name`/`label`/`description`，自定义关系还有 `icon`/`_id`）。同一 source+target 一条边，多个出口接到同一下游时放进同一数组 |
| `bundle doc -b NAME` | README Markdown |
| `bundle cred-types / cred-properties` | 凭证类型与表单。创建凭证前用它们列出参数 |
| `project list / create / get` | 项目。用户没点名时 `list` 后放进确认清单的 **需要你选**（projectName 及 remark），禁止自行挑一个存放。已点名的标「待确认」 |
| `project credentials -p ID [-b bundle]` | 可引用凭证元数据，无密钥。每个槽位放进 **需要你选**，三选一：使用已有 / 现在创建 / 使用时再选。禁止默认第一条或唯一项 |
| `project create-credential -p ID -b bundle --type TYPE` | 仅当用户选「现在创建」。必须有项目。缺 name/label/data 时 `--json` 退出 3，`data.reason=credential_input_required`，返回默认名称和表单字段；确认后再 stdin `--file -` 创建。响应无密钥。不要 `--data` 上 argv |
| `project workers -p ID [--online-only]` | 创建流程和试跑需要 workerId。服务器放进 **需要你选**：**workerName — 描述 — 在线/离线**（`remark` 为空则「无描述」），不要展示 hostname |
| `workflow list / create` | 流程。确认项目后 `list`。「新建还是改已有」放进 **需要你选**；新建流程名放进 **已有默认**。禁止用需求摘要直接 create |
| `workflow get-draft / save-draft` | 草稿；save-draft 自动先读 `version`。流程 id 用 `-w` / `--flow` |
| `workflow validate -p ID -f flow.json` | 无副作用语义校验。把表单 ERROR 按节点 id 汇总写入画布 `errors`（通过 `{}`，未通过如 `{"n-k7mX2pL9":1}`） |
| `workflow test-run -p ID -f flow.json --worker wkr_…` | 阻塞直到完成或超时。默认跑整张图。用户明确要单节点时才加 `--start-node` 和 `--inputs` |
| `workflow cancel-test --execution-id … --worker …` | 取消试跑 |
| `workflow deploy -p ID -w WF --worker wkr_… [--version-name v20261005-184620] [--remark 说明] [--wait]` | 发布已 save-draft 的草稿。版本号和发布说明放进 **已有默认** 再发；用户没提就用默认。没指定版本时用 `v` + `yyyyMMdd-HHmmss`。不要再传 `-f` |
| `workflow published -p ID -w WF` | 事后查线上版本。刚 `deploy --wait` 完不要再调，那次响应已经够画表 |
| `workflow deployment -p ID -w WF -d deploy_…` | 一次部署的总体状态和每台服务器结果。`--wait` 已经在 CLI 内轮询，Agent 不要再循环调 |

`--file -` 从 stdin 读 canvas JSON 或凭证 `data`。

## 推荐循环

```bash
until buildify --json workflow validate -p "$PROJ" -f ./flow.json; do
  # 读 issues，按节点 id 汇总写入 JSON 顶层 errors（如 {"n-k7mX2pL9":1}），改 data.parameters
done
# valid=true 时写入 "errors": {}
buildify --json workflow save-draft -p "$PROJ" -w "$WF" -f ./flow.json
buildify --json workflow test-run -p "$PROJ" -f ./flow.json --worker "$WKR" --timeout 60
buildify --json workflow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v20261005-184620" --remark "首次上线" --wait
```

多 profile 时每条加上 `--profile "$PROFILE"`。

`save-draft` 若冲突（退出码 4），`data` 是最新草稿：在最新 JSON 上重放改动，不要盲着重试同一 version。

`test-run` 的 HTTP 读超时 = 服务端 timeout + 30s。超时返回 `reason: "timeout"` 和已收到的部分事件，再用 `workflow cancel-test` 停 worker。

`workflow deploy` 在发布时传 `--version-name`（版本号）和 `--remark`（发布说明，写入该版本）。用户没有特殊指定版本号时，用确认当下的本地时间 `v` + `yyyyMMdd-HHmmss`（如 `v20261005-184620`），并写进 `--version-name`。默认 `--wait`。轮询走 `?statusOnly=true`，结束再 GET 一次完整摘要。刚发布完用这次返回的 `versionName` / `publishRemark` / `summary` 画表即可。
