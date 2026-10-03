---
name: buildify-workflow-dev-install
description: >-
  Installs the buildify-workflow-dev Agent Skill from GitHub into the correct
  client skills directory. Use when the user asks to install, clone, or set up
  the buildify-workflow-dev skill, or pastes https://github.com/buildify-bundles/buildify-workflow-dev-skill.
---

# 安装 buildify-workflow-dev（给 Agent）

用户把本文件、仓库地址或「安装 workflow-dev skill」发给你时，**你来执行安装**，不要只把命令贴回去。

- GitHub：<https://github.com/buildify-bundles/buildify-workflow-dev-skill>
- 备用（clone 失败或超时）：<https://gitee.com/buildify/buildify-workflow-dev-skill>

## 规则

- 目录名必须是 `buildify-workflow-dev`，不能用仓库名 `buildify-workflow-dev-skill`。根目录直接有 `SKILL.md`（`name: buildify-workflow-dev`）。
- 用 `git clone` / `git pull`，不要手抄文件，不要改 `SKILL.md`。
- **禁止**写入 `~/.cursor/skills-cursor/`。
- 没问清「全局还是当前仓库」以及「装哪些客户端」之前不要 clone。用户已经说了就按他说的装。
- 探测到多个客户端就问装哪几个。不要默认只装当前这一个，也不要偷偷全装。
- 密钥不要写进仓库，不要回显明文。

## 1. 问清楚

未指定时问：全局（本机所有项目，推荐）还是当前仓库；本机有多个客户端时装哪几个。Windows 把 `~` 换成 `%USERPROFILE%`。

## 2. 路径

`DEST` = 下表目录 + `buildify-workflow-dev`。先看当前对话是哪个产品，再看工作区或家目录里有没有对应文件夹。

| 客户端 | 全局 | 当前仓库 |
|---|---|---|
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` 或 `.agents/skills/` |
| 通义灵码 | `~/.lingma/skills/` | `.lingma/skills/` |
| Trae 国内版（含豆包编程 / MarsCode） | `~/.trae-cn/skills/` | `.trae/skills/` |
| Trae 国际版 | `~/.trae/skills/` | `.trae/skills/` |
| Qoder 国内版 | `~/.qoder-cn/skills/` | `.qoder/skills/` |
| Qoder 国际版 | `~/.qoder/skills/` | `.qoder/skills/` |
| CodeBuddy | `~/.codebuddy/skills/` | `.codebuddy/skills/` |

表里没有的：已有 `~/.<name>/skills/`（或工作区 `.<name>/skills/`）且里面是 `技能名/SKILL.md` 这种布局，就装到那里。否则用 `~/.agents/skills/` 与 `.agents/skills/`。不要发明路径。

Trae 国内版全局必须是 `~/.trae-cn/skills/`。Qoder 国内版全局必须是 `~/.qoder-cn/skills/`。

Cursor 有 user Agent Store 时，全局再同步一份到该 store 的 `skills/buildify-workflow-dev/`。没有 store 就只装 `~/.cursor/skills/`。

用户要「团队一份、多家 Agent 都能读」时，再加一份 `<workspace>/.agents/skills/buildify-workflow-dev`。多个客户端：clone 到第一个 `DEST`，其余 `cp -R`。

## 3. Clone

先 `mkdir -p` 父目录。

目录不存在：先 GitHub，失败或超时再 Gitee。

```bash
git clone --depth 1 https://github.com/buildify-bundles/buildify-workflow-dev-skill.git "$DEST" \
  || git clone --depth 1 https://gitee.com/buildify/buildify-workflow-dev-skill.git "$DEST"
```

目录已是 git 仓库：origin 是上面两个地址之一（含 `git@`）才 `git -C "$DEST" pull --ff-only`。其他地址停下问用户，不要覆盖，也不要改 remote。

目录存在但不是 git 仓库：已有 `SKILL.md` 就问要不要删掉重装；没有就不要往里塞文件。

克隆后若多了一层 `buildify-workflow-dev-skill/`，把内容挪到 `DEST` 根下。

## 4. 校验

```bash
test -f "$DEST/SKILL.md"
test -d "$DEST/reference"
grep -E '^name: buildify-workflow-dev$' "$DEST/SKILL.md"
ls "$DEST/reference"
```

必须能看到 `cli.md`、`flow-json.md`、`expressions.md`、`recipes.md`、`comment-node.md`。缺了就告诉用户路径和 `ls` 结果，不要假装成功。

## 5. 依赖

只装 skill 可以到此结束。用户要马上编排流程时再做：

1. Python 3.10+（`python3 --version`）。不够就提示升级，不要改系统 Python。
2. `python3 -m pip install -U buildify-cli`，然后 `buildify help`。
3. `buildify --json key test`。退出码 0 即可用。退出码 2 且 `data.reason=missing_api_key` 时，把 `data.userMessage` 原样发给用户，问一个简短 profile 名，等用户发来完整密钥（`keyId.secret`）后再写入。`profile_required` 时列出 profile 让用户选，之后命令加 `--profile`：

```bash
printf '%s' "$KEY" | buildify config add-profile "$PROFILE"
buildify --json config profiles
buildify --json key test
```

本 CLI 不能创建密钥。不要把密钥写入 `.env`、仓库或后续回复。

## 6. 汇报

每个客户端一行，路径写绝对路径：装到了哪里、`SKILL.md` 是否确认、`buildify-cli` 与 API 密钥的状态。下一步是新开对话，提到编排流程，或输入 `/buildify-workflow-dev`。当前对话可能还没刷新 skill 列表。不要在这时开始编流程。
