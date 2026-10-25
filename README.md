# buildify-workflow-dev

Agent Skill：用已安装的 Bundle 节点编排 Buildify 工作流。

与 `buildify-bundle-dev` 分工：那个是「做节点」，这个是「用节点编流程」。编排时发现没有对应软件包，会先请你到管理后台「开发中心 → 软件包」创建软件，再检查本机有没有 `buildify-bundle-dev`，没有就按 <https://buildify.cn/buildify-bundle-dev/install.md> 安装；创建完成后再用它开发和发布，然后回来接着编排。

技能目录名是 `buildify-workflow-dev`，仓库名是 `buildify-workflow-dev-skill`。装好后根目录必须直接有 `SKILL.md`（`name: buildify-workflow-dev`）。

## 安装

把下面整段发给编程 Agent（Cursor、Claude Code、Trae、通义灵码、CodeBuddy、Copilot 等），由它装到本机：

```
请读取并执行 https://raw.githubusercontent.com/buildify-bundles/buildify-workflow-dev-skill/main/install.md
把 buildify-workflow-dev skill 装到本机。先问我：全局（所有项目）还是当前仓库；若本机有多个客户端，问要不要一起装。
```

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
git clone https://gitee.com/buildify/buildify-workflow-dev-skill.git ~/.cursor/skills/buildify-workflow-dev
```

其他客户端把同一目录放到各自 skills 路径即可：`~/.claude/skills/`、`~/.agents/skills/`、`~/.codebuddy/skills/`。

## 包含文件

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 主入口：编排清单、画布硬规则、多段画布、没有软件包时先到开发中心创建再交给 bundle-dev、项目/流程/服务器/凭证点选、HTTP 接口与试跑、失败告警、发布 |
| `reference/report.md` | 保存 / 试跑 / 发布后的汇报表格与状态符号 |
| `install.md` | 把 `buildify-workflow-dev` 装到各客户端 skills 目录 |
| `reference/cli.md` | `buildify` CLI 命令与退出码 |
| `reference/flow-json.md` | 画布 JSON：`n-` + nanoid、`errors`、`direction`（TB/LR）、排版脚本用法，以及没有 Node 时的手算间距 / 分组 / 多段 / 批注 |
| `scripts/layout.mjs` | 排版脚本：先连线，最后统一排版。`node scripts/layout.mjs flow.json [--direction TB\|LR] [-o out.json] [--check]` |
| `scripts/vendor/` | 内置的 `@dagrejs/dagre` 1.1.4（MIT，见 `dagre.LICENSE`），脚本不用 `npm install` |
| `reference/expressions.md` | 按组件写表达式：JSON 默认 `={{msg.xxx}}`、SQL `#{}` `${}`、文本 `{{ }}`；JS 节点分段注释；飞书 `lark_md` 与失败原因 |
| `reference/recipes.md` | 常见骨架 |
| `reference/comment-node.md` | 批注节点字段 |

## 依赖

- Python 3.10+
- `pip install buildify-cli`
- Node 18+（可选，跑排版脚本用；没有时 Agent 按 flow-json.md 手算坐标）
- 控制台签发的开放 API 密钥（`keyId.secret`），写入 `~/.buildifyrc`

```bash
printf '%s' 'keyId.secret' | buildify config add-profile <工作区别名>
buildify --json key test
```

多个工作区时用 `buildify --json config profiles` 看已存名称，之后的命令加 `--profile <名称>`。

## 排版脚本与控制台同步

`scripts/layout.mjs` 的布局函数逐行移植自控制台前端（`eventflow-cloud-frontend`）：

- `composables/applyLayout.js`：`doApplyLayout` 及其依赖（尺寸、扇出层距、同层对齐、多段并排、分组包络、批注跟随）
- `components/workflows/edges/routingMetrics.js`：`LOOP_METRICS`、`getGroupLoopInsets`（组内回连留白）

当前对齐到前端提交 `a6e7322`。前端改了这两个文件的常量或流程时，把改动同步到脚本里对应的函数，再用两边对同一批样例（TB / LR 主链、扇出 2 和 3、多段、三段分组、组内回环、批注）对比坐标和分组尺寸，必须完全一致。脚本只比前端多两步：排版前检查图结构，排版后把顶层节点平移到 `x ≥ 40`、`y ≥ 24`。

## 使用

对话里提到编排流程、工作流、试跑、发布、Webhook 接口、凭证、批注、节点分组、横排/竖排、入站认证、访问地址、飞书卡片、失败告警、缺少节点，或显式 `/buildify-workflow-dev` 即可触发。
