# buildify-workflow-dev

Agent Skill：用已安装的 Bundle 节点编排 Buildify 工作流。

与 `buildify-bundle-dev` 分工：那个是「做节点」，这个是「用节点编流程」。编排时发现没有对应的软件包或节点，会先告诉你不存在，并给出默认方案：按 `buildify-bundle-dev` 规范、对接服务的官方文档实现，附带软件包名称和图标。你确认一次后（已经说过「直接做」就不再问），它检查本机有没有 `buildify-bundle-dev`（没有或版本旧就按 <https://buildify.cn/buildify-bundle-dev/install.md> 安装或更新），用它创建软件包、开发和发布，然后回来接着编排。不用你去控制台建软件包。

技能目录名是 `buildify-workflow-dev`，仓库名是 `buildify-workflow-dev-skill`。装好后根目录必须直接有 `SKILL.md`（`name: buildify-workflow-dev`）。

## 安装

把下面这段发给编程 Agent（Cursor、Claude Code、Trae、通义灵码、CodeBuddy、Copilot 等），由它装到本机：

```
请读取并执行 https://raw.githubusercontent.com/buildify-bundles/buildify-workflow-dev-skill/main/install.md
把 buildify-workflow-dev skill 装到本机。
```

Agent 会自己判断客户端和目录（默认全局，已装过就原地更新），取文件、装好 `buildify` 命令行工具并校验，只在需要 buildify-cli 密钥时问你。想装到当前仓库给团队共享，就在这段话后面加一句「装到当前仓库」。

也可以自己克隆。目录名必须是 `buildify-workflow-dev`，不要用仓库名 `buildify-workflow-dev-skill`。

Cursor 全局（所有项目可用）：

```bash
git clone https://github.com/buildify-bundles/buildify-workflow-dev-skill.git ~/.cursor/skills/buildify-workflow-dev
```

项目级（随仓库共享给团队）：

```bash
git clone https://github.com/buildify-bundles/buildify-workflow-dev-skill.git .cursor/skills/buildify-workflow-dev
```

GitHub 克隆失败或超时时，把上面命令里的仓库地址换成 Gitee 备用地址 `https://gitee.com/buildify/buildify-workflow-dev-skill.git`，目标目录不变。例如 Cursor 全局：

```bash
git -c protocol.version=1 clone https://gitee.com/buildify/buildify-workflow-dev-skill.git ~/.cursor/skills/buildify-workflow-dev
```

报「不支持 git 协议」或 protocol error 时，就是因为 Gitee 不支持 git 协议 v2。上面这条命令里的 `-c protocol.version=1` 只对这一次克隆生效，不要改全局 git 配置。

其他客户端把同一目录放到各自 skills 路径即可：`~/.claude/skills/`、`~/.agents/skills/`、`~/.codebuddy/skills/`。

## 包含文件

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 主入口：编排清单、画布硬规则、多段画布、缺软件包或节点时的处理、项目/流程/服务器/凭证点选、HTTP 接口与试跑、失败告警、发布 |
| `reference/missing-bundle.md` | 缺软件包或节点：默认方案（bundle-dev 规范 + 官方文档、软件包信息、图标）、一次确认、交给 bundle-dev 建包开发发布后回来 |
| `reference/report.md` | 保存 / 试跑 / 发布后的汇报表格与状态符号 |
| `install.md` | 把 `buildify-workflow-dev` 装到各客户端 skills 目录 |
| `reference/cli.md` | `buildify` CLI 命令与退出码 |
| `reference/flow-json.md` | 画布 JSON：`n-` + nanoid、`errors`、`direction`（TB/LR）、排版脚本用法，以及没有 Node 时的手算间距 / 分组 / 多段 / 批注 |
| `scripts/layout.mjs` | 排版脚本：先连线，最后统一排版。`node scripts/layout.mjs flow.json [--direction TB\|LR] [--group <分组 id>] [-o out.json] [--check]` |
| `scripts/check.mjs` | 保存前检查：一对节点一条边、边 `id`、出口数组与 `name` / `label`、节点图标对照目录。`node scripts/check.mjs flow.json --fetch [--fix]` |
| `scripts/vendor/` | 内置的 `@dagrejs/dagre` 1.1.4（MIT，见 `dagre.LICENSE`），脚本不用 `npm install` |
| `reference/expressions.md` | 按组件写表达式：JSON 默认 `={{msg.xxx}}`、SQL `#{}` `${}`、文本 `{{ }}`；JS 节点分段注释；飞书 `lark_md` 与失败原因 |
| `reference/recipes.md` | 常见骨架 |
| `reference/comment-node.md` | 批注节点字段 |

## 依赖

- `buildify-cli` 1.2.0+（Python 3.10+）。安装时 Agent 会自己装，优先用 `uv tool install buildify-cli`，本机 Python 版本不够也不用管
- Node 18+（可选，跑排版和检查脚本用；没有时 Agent 按 flow-json.md 手算坐标、人工核对边和图标）
- buildify-cli 密钥（`keyId.secret`）：控制台 **系统设置 → API Keys → buildify-cli 密钥** 创建，只在创建时显示一次。发给 Agent 即可，它会写入 `~/.buildifyrc`；自己配置用下面的命令

```bash
printf '%s' 'keyId.secret' | buildify config add-profile <工作区别名>
buildify --json key test
```

多个工作区时用 `buildify --json config profiles` 看已存名称，之后的命令加 `--profile <名称>`。

## 排版脚本与控制台同步

`scripts/layout.mjs` 的布局函数逐行移植自控制台前端（`eventflow-cloud-frontend`）：

- `composables/applyLayout.js`：`doApplyLayout`、`doApplyGroupLayout` 及其依赖（尺寸、回边拆分与分支顺序、主链加权、拉直短错位、扇出与出口文字层距、同层对齐、外层过宽扇出拆排、共用收尾节点后置、多段并排、分组包络、批注放进空白）
- `components/workflows/edges/routingMetrics.js`：`LOOP_METRICS`、`LABEL_METRICS`、`SMOOTH_JOG`、`isWrapRects`、`hasOpenWrapGap`、`getGroupLoopInsets`（组内回连留白、标签层距、拉直阈值）
- `components/workflows/edges/edgeLabelSize.js`：出口文字胶囊尺寸。脚本没有 canvas，用它无 canvas 时的字数估算分支；`relationHasCustomIcon` 取自 `utils/mcpServerDefaults.js`

当前对齐到前端 `fbe744b`（2026-11-04，批注不再盖住节点）。各层都不折行，互不连线的几段沿交叉轴依次排开（竖排左右、横排上下，间隙 64 / 72）。回边（深度优先遍历里连回栈中上游的边）不参与分层，同一节点的出边按出口首次出现的顺序插进 Dagre。竖排普通层距 **74**，扇出 **104 / 120**（带出口文字的扇出、汇合约 120）；横排 **140**，扇出 **170**。拆排只在外层做，要求至少 6 个且全是叶子的下游、宽度超过 8 张卡片的 1.3 倍，默认卡片下 11 个起拆。分组留白左右 **48**、上 **84**、下 **48**，组内回环与边框留 **96**。批注先放进节点范围左上角的空白，放不下贴在节点外侧（竖排右侧、横排下方），不改高度。前端改了这几个文件的常量或流程时，把改动同步到脚本里对应的函数，再用两边对同一批样例（TB / LR 主链 3–40 张含长出口名和多出口、扇出 2–40 个含汇合、共用收尾、三段分组、一段分成几个模块分组、组内和顶层回环、嵌套分组和 `--group`、批注）对比坐标和分组尺寸，必须完全一致。脚本只比前端多三处：排版前检查图结构，统计重算的分组数和挪动的批注数，整图排版后把顶层节点平移到 `x ≥ 40`、`y ≥ 24`。前端的 `syncComputedPositions` 只服务于画布渲染，脚本不需要。

## 使用

对话里提到编排流程、工作流、试跑、发布、Webhook 接口、凭证、批注、节点分组、横排/竖排、入站认证、访问地址、飞书卡片、失败告警、缺少节点、验签、回调、微信支付、支付宝、Stripe、改凭证、删除凭证，或显式 `/buildify-workflow-dev` 即可触发。

直接用中文说需求即可，例如：

- 「做一个 HTTP 接口 `GET /orders/:id`，查 MySQL 订单表返回 JSON」
- 「每小时把新订单同步到飞书多维表格，失败发飞书告警」
- 「收微信支付回调，验签后更新订单状态」
- 「打开『订单查询』这条流程，加一个按手机号查询的分支」
- 「把『订单查询』试跑一下，没问题就发布」

Agent 会查节点、生成并排版画布、校验、保存草稿、试跑，确认版本号后发布，只在项目、服务器、凭证缺的时候让你点选。默认竖排、不写接口文档和批注、只有特别复杂的流程才按功能模块分组、试跑通过后发布；要改就在需求里说「横排」「写一份接口文档」「按模块分组」「只保存草稿」。
