# 工作区、项目、流程、服务器、凭证

步骤 1–3 读这份。先跑 `node $S/prepare.mjs`（参数见 `--help`），按它的输出定下面这些项，**不要再逐条调 `key test` / `project list` / `project workers` / `project credentials` / `workflow list`**，也不要写 `node -e` 去解析它们的原始 JSON。

## 密钥（prepare 退出码 2）

执行 CLI，不要读它的源码。找不到 `buildify` 命令时由你装好：先试 `~/.local/bin/buildify`，没有就按 [install.md](../install.md)「装 buildify CLI」装（优先 `uv tool install -U buildify-cli`）。不用 `sudo`，不改系统 Python。

按输出里的 `reason`：

- `missing_api_key`：**停止编排**，按 [install.md](../install.md)「buildify-cli 密钥」的模板请用户到 **系统设置 → API Keys → buildify-cli 密钥** 创建并发来 `keyId.secret`，不要原样转发 `data.userMessage`。profile 名用工作区的简短英文名，没有就用 `default`。收到后 `printf '%s' "$KEY" | buildify config add-profile "$PROFILE"`，再跑 prepare。
- `profile_required`：没有默认工作区。输出里列了本机密钥（名称、tenantId、密钥名），新建流程时直接出「工作区 / 项目」题；其他场景每个 profile 一个选项，点一次。之后每条命令加 `--profile <name>`。不要 `config use`，除非用户明确要改默认工作区。
- `workspace_key_missing`：请用户在 `.buildify-workspace` 指向的那个工作区创建密钥发来，不要改用别的工作区。
- 输出写「缺少权限 …」：密钥有效，请用户到控制台给这把密钥补上这些权限，不要重建密钥。项目 404 且响应带 `tenantId` / `profile`：先问是不是工作区错了。

**密钥安全：** 不要 `--api-key`；不要写进仓库、`.env` 或 commit；不要在回复里回显明文。本 CLI 不能创建密钥。

## 沿用已有，只问缺的

已经能确定的**直接用**，不要再问，也不要列成待确认。一次消息里只问还缺的项。

| | 改已有 | 新建 |
|---|---|---|
| **项目** | 这条流程所在的项目 | prepare 输出「项目: 已定（来源）」就用它；「待选」才出题 |
| **流程** | 这一条，`get-draft` 后用 `draft.mjs` 看 | 用户给的名称；没给时建议名放进流程题第一项 |
| **服务器** | 用户点名的；没点名用 `workflow workers` 里 `deleteStatus` 为 0 的那台。不要用 `workflow published` 来选 | 用户点的那台；只有一台在线时直接用；标「仓库默认」的直接用 |
| **凭证** | 草稿里该槽已写的 `{type, name}` | 只问空槽，见 [credentials.md](credentials.md) |

对用户只用名称；项目 id、workerId、hostname 留在内部。`-p` / `-w` 传 public id（`p-…` / `w-…`），不要传中文名称。

**项目怎么定**（prepare 已按这个顺序判断，输出里写了来源）：用户点名（`-p`）→ 仓库 `.buildify-project` → 本次对话已确认（`--last`）→ 工作区只有一个项目。定下来后在 `workflow create` 前写一句：「将在 工作区 X / 项目 Y 创建流程「Z」，服务器 W」，用户想换再说。都不满足时出项目题，加一个选项「用这个并固定到本仓库」，用户选了就 `prepare.mjs --pin -p <项目id> [--worker <服务器id>]`。同一次对话新建第二条流程时带上 `--last <上次的项目id>`。

**让用户定的项用点选，不要让他手打名称。** 能弹选择题时（如 Cursor 的 AskQuestion），缺的每一项一道题，放在同一次提问里；建议值放第一项，标签末尾写「推荐」；离线服务器可以列出，标签写「离线，不能试跑」。没有选择题界面时，同一条消息里按项给编号，用户只回编号（如 `项目 1，服务器 2`）。

一项都不用问时，不要为了画布方向或是否发布再弹一题，直接用默认：竖排、试跑通过后发布。正在问别的缺口时，把这两项也放进同一次提问。

- 缺的时候不要自己挑第一条、或名称里带「本地/测试」的项（工作区只有一个项目、只有一台在线服务器除外）。
- 新建名没给时，按需求起一个短名（如「当前时间 API」）放进流程题第一项并标「推荐」。不要另起一轮只问名字。
- 服务器：`ship --create --worker`、`trial --worker`、`release --worker` 用同一台。离线的不能试跑或发布。
- 改已有先 `workflow workers`。只有一台已绑定且在线时直接用，多台再问。一台都没有时从 prepare 列出的服务器里选，用户点了之后先 `assign-workers`，再发布。`deploy` 报「未绑定」就是还没做这一步。
- 节点参数（如 Webhook 路径）按表单写进 spec，校验 ERROR 再按节点汇总一次问，不要为每个字段单独打断一轮。

## 多个工作区

prepare 按 `tenantId` 去重数工作区。工作区已定的情况：用户点名了工作区或 profile、设了 `BUILDIFY_OPENAPI_PROFILE`、仓库有 `.buildify-workspace` / `.buildify-project`、或本次对话已经在某个工作区建过流程。

- 没定时 prepare 输出「工作区 / 项目」候选（每项带 `--profile`），**不要默认用 `current`**。选项超过 12 个时拆两步：先出工作区题（profile 名和项目数），选完带 `--profile` 重跑 prepare 再出项目题。
- 某个工作区查不到项目时，选项里不列它，在题干里写一句原因，不要因此停下整个提问。
- 选定后，这条流程的每条 CLI 命令和脚本都加 `--profile <name>`（目录缓存会自动按 profile 分目录）。不要 `config use`。
- 改已有流程：默认工作区里找不到这条流程时，按工作区并行跑 `prepare.mjs --profile P --flow <名称>` 再定；同名流程在多个工作区都有时让用户点「工作区 / 项目 / 流程」。

## 切换项目、工作区

**切换项目**（「换到 X 项目」「建到别的项目」）：`prepare.mjs -p X`。匹配不到或有同名时让用户点选。服务器和凭证按项目隔离，之前选的**全部作废**，只把这两项再问一次。

**切换工作区**（「换到 emag」）：`prepare.mjs --profile <名称>`。项目、服务器、凭证全部作废，之后的命令改用新的 `--profile`，节点目录重新拉（步骤 4），缺包按「环境里没有对应节点」处理。

**把已有流程换到别的项目**：CLI 没有移动命令，改为复制重建，原流程不动：

1. 源项目 `workflow get-draft` 存成 `draft.json`。
2. 在目标项目点选服务器，每个凭证槽按三选一重选（[credentials.md](credentials.md)）。
3. spec 只写要重绑凭证的节点 `{ "id": "n-…", "credentials": {…} }`，跑 `build.mjs spec.json --base draft.json --no-layout -o flow.json`。选「使用时再选」的槽要从该节点 `data.credentials` 和 `parameters` 两处手动删掉。
4. `ship.mjs flow.json -p <目标> --create <同名> --worker …`，再照常试跑、确认版本号后发布。
5. 汇报里说明原流程还在原项目（已发布的仍在线），问要不要删除。

目标项目在另一个工作区时：第 1 步用源工作区的 `--profile`，之后都用目标工作区的；画布里钉的包或版本在目标工作区没有时（check 会报），列出缺的包问用户是改用目标工作区已有的版本，还是按「环境里没有对应节点」先补包。删除按 [cli.md](cli.md)「删除」的顺序先移除服务器再 `workflow delete`，确认前不执行。
