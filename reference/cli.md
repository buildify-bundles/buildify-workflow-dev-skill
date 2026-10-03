# buildify CLI

包：`buildify-cli`，命令：`buildify`。`buildify help` 打印与本文件等价的 `usage.md`。

## 配置

密钥在控制台 **空间设置 → 开放 API 密钥 → 创建** 签发，明文只显示一次，格式 `keyId.secret`。
本 CLI 不能创建密钥。

```bash
printf '%s' 'keyId.secret' | buildify config set-key api_key   # 推荐：stdin，避免 argv / 历史
buildify config set-key base_url https://openapi.buildify.cn   # 或本地 http://127.0.0.1:40100
buildify --json key test
```

TTY 下直接 `buildify config set-key api_key` 会打印获取步骤并用隐藏输入写入 `~/.buildifyrc`（权限 600）。
`--json` 且未配置密钥时退出码 2，`data.reason=missing_api_key`，把 `data.userMessage` 原样给用户，
收到密钥后用上面的 stdin 命令保存。**不要** `--api-key`、不要把明文写进仓库或回显到对话。

优先级：命令行 `--base-url` / `--api-key` → 环境变量 `BUILDIFY_OPENAPI_*` → `~/.buildifyrc` 的 `[openapi]`。
与 `buildify-publish` 共用 rc 文件，section 不同，密钥不会互相覆盖。
`BUILDIFY_OPENAPI_NO_PROMPT=1` 关闭交互提示。

## 退出码

| Code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 通用失败 |
| 2 | 缺配置 / 401 / 403 |
| 3 | 本地问题（JSON 坏、文件不存在） |
| 4 | HTTP 4xx/5xx，**或 `flow validate` 有 ERROR** |
| 5 | 网络 |

`--json` 时 stdout 只有一行 `{ok, code, msg, http_status, data}`。

## 命令

| CLI | 用途 |
|-----|------|
| `health` | 探活，无需密钥 |
| `key test` | 校验密钥并回显工作区 |
| `bundle list [-k keyword]` | 可用 bundle。需求对应的包不在列表里 → 停止编排，请用户用 buildify-bundle-dev 实现并发布后再继续 |
| `bundle nodes -b NAME [-V ver]` | 节点目录（已展平 `groups_json[].nodes` + `nodes_json`，含 `icon` / `label` / `isTrigger`）。目录 `summary` 是类型通用简述，**不要**直接当作画布文案 |
| `bundle node-properties -b NAME -n NodeName` | 表单 schema → `data.parameters`；同时带回 `icon` / `label` / `summary` / `isTrigger` / **`uiComponent`**。按组件写表达式：JSON 默认 `"={{msg.xxx}}"`（要字符串才 `"=前缀 {{msg.xxx}}"`，禁止 `this is ={{msg.xxx}}`），SQL `#{}` `${}`，文本 `{{ }}`。画布 `data.summary` 仍按本流程职责自写，且 ≤8 字 |
| `bundle node-relations -b NAME -n NodeName` | 出口 relation 整份对象 → `edges[].data.relations[]`（`name`/`label`/`description`，自定义关系还有 `icon`/`_id`）。同一 source+target 一条边，多个出口接到同一下游时放进同一数组 |
| `bundle doc -b NAME` | README Markdown |
| `bundle cred-types / cred-properties` | 凭证类型与表单。创建凭证前用它们列出参数 |
| `project list / create / get` | 项目。用户没点名时 `list` 后必须把 **projectName**（及 remark）列给用户确认，禁止自行挑一个存放 |
| `project credentials -p ID [-b bundle]` | 可引用凭证元数据，无密钥。列出 `label`/`name`/`type` 后每个槽位请用户三选一：使用已有 / 现在创建 / 使用时再选。禁止默认第一条或唯一项 |
| `project create-credential -p ID -b bundle --type TYPE` | 仅当用户选「现在创建」。必须有项目。缺 name/label/data 时 `--json` 退出 3 并返回默认名称和表单字段；确认后再 stdin `--file -` 创建。响应无密钥 |
| `project workers -p ID [--online-only]` | 创建流程和试跑需要 workerId。对用户列出 **workerName — 描述 — 在线/离线**（`remark` 为空则「无描述」），不要展示 hostname |
| `flow list / create` | 流程。确认项目后 `list`，问新建还是改已有；新建名称须用户确认，禁止用需求摘要直接 create |
| `flow get-draft / save-draft` | 草稿；save-draft 自动先读 `version` |
| `flow validate -p ID -f flow.json` | 无副作用语义校验。把表单 ERROR 按节点 id 汇总写入画布 `errors`（通过 `{}`，未通过如 `{"n-k7mX2pL9":1}`） |
| `flow test-run -p ID -f flow.json --worker wkr_…` | 阻塞直到完成或超时 |
| `flow cancel-test --execution-id … --worker …` | 取消试跑 |
| `flow deploy -p ID -w WF --worker wkr_… [--version-name v1.0.0] [--remark 说明] [--wait]` | 发布已 save-draft 的草稿。发布前请用户确认版本号和发布说明。不要再传 `-f` |
| `flow published -p ID -w WF` | 事后查线上版本。刚 `deploy --wait` 完不要再调，那次响应已经够画表 |
| `flow deployment -p ID -w WF -d deploy_…` | 一次部署的总体状态和每台服务器结果 |

`--file -` 从 stdin 读 canvas JSON。

## 推荐循环

```bash
until buildify --json flow validate -p "$PROJ" -f ./flow.json; do
  # 读 issues，按节点 id 汇总写入 JSON 顶层 errors（如 {"n-k7mX2pL9":1}），改 data.parameters
done
# valid=true 时写入 "errors": {}
buildify --json flow save-draft -p "$PROJ" -w "$WF" -f ./flow.json
buildify --json flow test-run -p "$PROJ" -f ./flow.json --worker "$WKR" --timeout 60
buildify --json flow deploy -p "$PROJ" -w "$WF" --worker "$WKR" \
  --version-name "v1.0.0" --remark "首次上线" --wait
```

`save-draft` 若 409，`data` 是最新草稿：在最新 JSON 上重放改动，不要盲着重试同一 version。

`test-run` 的 HTTP 读超时 = 服务端 timeout + 30s。超时返回 `reason: "timeout"` 和已收到的部分事件，再用 `cancel-test` 停 worker。

`flow deploy` 在发布时可改 `--version-name`（版本号）和 `--remark`（发布说明，写入该版本）。默认 `--wait`。轮询走 `?statusOnly=true`，结束再 GET 一次完整摘要。刚发布完用这次返回的 `versionName` / `publishRemark` / `summary` 画表即可。
