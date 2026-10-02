---
name: buildify-flow-dev-install
description: >-
  Installs the buildify-flow-dev Agent Skill from GitHub into the correct
  client skills directory. Use when the user asks to install, clone, or set up
  the buildify-flow-dev skill, or pastes https://github.com/buildify-bundles/buildify-workflow-dev-skill.
---

# 安装 buildify-flow-dev（给 Agent）

用户把本文件、仓库地址或「安装 flow-dev skill」发给你时，**你来执行安装**，不要只把命令贴回去让用户自己跑。

仓库：<https://github.com/buildify-bundles/buildify-workflow-dev-skill>

## 用户可以这样触发

把下面整段发给任意编程 Agent（Cursor、Claude Code、Trae、通义灵码、CodeBuddy、Copilot 等）：

```
请读取并执行 https://raw.githubusercontent.com/buildify-bundles/buildify-workflow-dev-skill/main/install.md
把 buildify-flow-dev skill 装到本机。先问我：全局（所有项目）还是当前仓库；若本机有多个客户端，问要不要一起装。
```

## 硬性规则

- Skill **目录名必须是** `buildify-flow-dev`，不能用仓库名 `buildify-workflow-dev-skill`。
- 目标目录根下必须直接有 `SKILL.md`（frontmatter `name: buildify-flow-dev`）。
- 用 `git clone` / `git pull`，不要手抄文件、不要改 `SKILL.md` 内容。
- **禁止**写入 `~/.cursor/skills-cursor/`（Cursor 内置 skill 目录）。
- 未问清「全局 vs 当前项目」以及「装哪些客户端」之前不要 clone。用户已经说了就按他说的装。
- 不要默认只装 Cursor；按第 1 节探测，表里没有的用 `.agents/skills/` 兜底。
- 密钥不要写进仓库、不要 `--api-key`、不要在回复里回显明文。

## 进度清单

复制并逐项勾选：

```
安装进度：
- [ ] 1. 识别客户端，确定目标路径
- [ ] 2. 询问（或确认）全局 vs 当前项目
- [ ] 3. clone 或 pull 到 buildify-flow-dev/
- [ ] 4. 校验 SKILL.md 与 reference/
- [ ] 5. 检查 Python + buildify-cli；缺密钥则提示签发
- [ ] 6. 向用户汇报安装位置和下一步
```

## 1. 识别客户端

按下面顺序判断，不要只认 Cursor：

1. **当前对话产品名**（系统提示、窗口名、工具命名空间）。
2. **工作区目录**：是否有 `.cursor/`、`.claude/`、`.trae/`、`.lingma/`、`.codebuddy/`、`.qoder/`、`.iflow/`、`.qwen/`、`.agents/` 等。
3. **家目录探测**（有哪个装哪个；Windows 把 `~` 换成 `%USERPROFILE%`）：

```bash
ls -d ~/.cursor ~/.claude ~/.codex ~/.agents ~/.trae ~/.trae-cn ~/.traecli \
  ~/.lingma ~/.qoder ~/.qoder-cn ~/.codebuddy ~/.iflow ~/.qwen ~/.minimax \
  ~/.gemini ~/.copilot ~/.codeium ~/.continue ~/.cline ~/.kilocode ~/.roo \
  ~/.windsurf ~/.factory ~/.config/opencode ~/.config/agents ~/.kiro \
  ~/.junie ~/.goose ~/.openhands 2>/dev/null
```

对不上或探测到多个 → **问用户装哪几个**，不要默认只装当前这一个、也不要偷偷装遍所有客户端。

未指定范围时问：

```
buildify-flow-dev 装到哪里？

1) 全局 — 本机所有项目都能用（推荐个人使用）
2) 当前仓库 — 写入该客户端的项目 skills 目录（可提交给团队）

本机已检测到：Cursor、通义灵码、Trae 国内版（举例）
要只装当前客户端，还是检测到的都装一份？
```

## 2. 目标路径

`DEST` =「该客户端的全局或项目根」+ `/buildify-flow-dev`。目录名始终是 `buildify-flow-dev`。

**项目级优先写原生目录**（当前正在用的客户端）。若用户要「团队一份、多家 Agent 都能读」，再额外写一份到 `<workspace>/.agents/skills/buildify-flow-dev`（Cursor / Codex / Copilot / Gemini / OpenCode / Cline / Amp 等会扫这个通用目录）。

同时装多个客户端时：clone 一份到第一个 `DEST`，其余 `cp -R`（或再 clone），不要用仓库名当文件夹。

### 国内（含国内发行版）

用户口头名（通义灵码、Trae、豆包编程/MarsCode、腾讯云代码助手、心流、千问、华为云、海螺、Kimi）按此表对路径。豆包编程 / MarsCode 走 **Trae 国内版**。

| 客户端 | 识别线索 | 全局 | 当前仓库 |
|---|---|---|---|
| **通义灵码 Lingma** | 灵码、`.lingma/` | `~/.lingma/skills/` | `.lingma/skills/` |
| **Trae 国内版** | Trae CN、`~/.trae-cn/` | `~/.trae-cn/skills/` | `.trae/skills/` |
| **Trae 国际版** | Trae、`~/.trae/` 且无 `-cn` | `~/.trae/skills/` | `.trae/skills/` |
| **Trae CLI** | TraeCode CLI | `~/.traecli/skills/` | `.traecli/skills/` |
| **Qoder** | Qoder 国际 | `~/.qoder/skills/` | `.qoder/skills/` |
| **Qoder 国内版** | Qoder CN | `~/.qoder-cn/skills/` | `.qoder/skills/` |
| **CodeBuddy** 腾讯云代码助手 | CodeBuddy、`.codebuddy/` | `~/.codebuddy/skills/` | `.codebuddy/skills/` |
| **iFlow 心流** | iFlow、`.iflow/` | `~/.iflow/skills/` | `.iflow/skills/` |
| **Qwen Code 千问** | Qwen Code、`.qwen/` | `~/.qwen/skills/` | `.qwen/skills/` |
| **MiniMax 海螺** | MiniMax Code | `~/.minimax/skills/` | `.minimax/skills/` |
| **Kimi Code CLI** | Kimi、月之暗面 | `~/.agents/skills/` 或 `~/.config/agents/skills/` | `.agents/skills/` |
| **华为 CodeArts** | CodeArts Agent | `~/.codeartsdoer/skills/` | `.codeartsdoer/skills/` |
| **Kode** | Kode、智谱系 CLI | `~/.kode/skills/` | `.kode/skills/` |

Trae 国内版全局必须是 `~/.trae-cn/skills/`，不要写成 `~/.trae/skills/`。Qoder 国内版同理用 `~/.qoder-cn/`。

### 国外 / 通用

| 客户端 | 识别线索 | 全局 | 当前仓库 |
|---|---|---|---|
| **Cursor** | Cursor、`.cursor/` | `~/.cursor/skills/` | `.cursor/skills/` |
| **Claude Code** | Claude、`.claude/` | `~/.claude/skills/` | `.claude/skills/` |
| **Codex** | Codex、OpenAI | `~/.codex/skills/` 与 `~/.agents/skills/`（官方也读后者，两处都没有就先写 `~/.agents/skills/`） | `.agents/skills/` |
| **GitHub Copilot** | Copilot | `~/.copilot/skills/` | `.github/skills/` 或 `.agents/skills/` |
| **Gemini CLI** | Gemini | `~/.gemini/skills/` | `.gemini/skills/` 或 `.agents/skills/` |
| **Google Antigravity** | Antigravity | `~/.gemini/antigravity/skills/` | `.agents/skills/` 或 `.agent/skills/` |
| **Windsurf / Cascade** | Windsurf、Codeium | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| **OpenCode** | OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` 或 `.agents/skills/` |
| **Cline** | Cline | `~/.cline/skills/` 或 `~/.agents/skills/` | `.cline/skills/` 或 `.agents/skills/` |
| **Roo Code** | Roo | `~/.roo/skills/` | `.roo/skills/` |
| **Kilo Code** | Kilo | `~/.kilocode/skills/` 或 `~/.kilo/skills/` | `.kilocode/skills/` 或 `.agents/skills/` |
| **Continue** | Continue | `~/.continue/skills/` | `.continue/skills/` |
| **Goose** | Goose | `~/.config/goose/skills/` | `.goose/skills/` |
| **OpenHands** | OpenHands | `~/.openhands/skills/` | `.openhands/skills/` |
| **Factory Droid** | Droid、Factory | `~/.factory/skills/` | `.factory/skills/` 或 `.agents/skills/` |
| **Amp** | Amp | `~/.config/agents/skills/` | `.agents/skills/` |
| **JetBrains Junie** | Junie | `~/.junie/skills/` | `.junie/skills/` |
| **AWS Kiro** | Kiro | `~/.kiro/skills/` | `.kiro/skills/` |
| **Crush** | Crush | `~/.config/crush/skills/` | `.crush/skills/` |
| **Warp / Zed** | Warp、Zed | `~/.agents/skills/` | `.agents/skills/` |
| **通用兜底** | 表中没有、或用户说「按规范来」 | `~/.agents/skills/` | `.agents/skills/` |

表里没有的客户端：若已存在 `~/.<name>/skills/` 或工作区 `.<name>/skills/`，且邻居 skill 也是 `技能名/SKILL.md` 这种布局，就装到那里。再没有就用 **通用兜底** `.agents/skills/`。不要发明 `~/.chatgpt/skills/` 这类路径。

Cursor 额外注意：

- 不要装到 `~/.cursor/skills-cursor/`。
- 若对话上下文给出了 **user Agent Store** 路径，全局 skill 再同步一份到该 store 的 `skills/buildify-flow-dev/`（有 store 才写；没有就只装 `~/.cursor/skills/`）。
- Cursor 也会读 `.agents/skills/`、`.claude/skills/`、`.codex/skills/`；原生目录仍是 `.cursor/skills/`。

## 3. Clone / 更新

每个选中的客户端各有一个 `DEST`（上表路径 + `buildify-flow-dev`）。先 `mkdir -p` 父目录。

**目录不存在：**

```bash
git clone --depth 1 https://github.com/buildify-bundles/buildify-workflow-dev-skill.git "$DEST"
```

**目录已存在且是 git 仓库：**

```bash
git -C "$DEST" remote get-url origin    # 确认是这个仓库
git -C "$DEST" pull --ff-only
```

origin 不是本仓库 → **停下问用户**，不要覆盖。

**目录存在但不是 git 仓库：**

若已有 `SKILL.md`，当作已安装，问用户要不要删掉后重新 clone；没有 `SKILL.md` 则不要往里塞文件，换路径或先问。

克隆后若根目录没有 `SKILL.md`、却多了一层 `buildify-workflow-dev-skill/`，把内容挪到 `DEST` 根下，保证 `DEST/SKILL.md` 存在。

## 4. 校验

```bash
test -f "$DEST/SKILL.md"
test -d "$DEST/reference"
grep -E '^name: buildify-flow-dev$' "$DEST/SKILL.md"
ls "$DEST/reference"
```

必须能看到：`cli.md`、`flow-json.md`、`expressions.md`、`recipes.md`、`comment-node.md`。

缺文件或 `name` 对不上 → 安装失败，把路径和 `ls` 结果告诉用户，不要假装成功。

## 5. 运行依赖（skill 要编流程才需要）

只装 skill 文件也可以先结束；若用户要马上编排流程，继续做：

1. Python **3.10+**：`python3 --version`。不够就提示用户升级，不要改系统 Python。
2. CLI：

```bash
python3 -m pip install -U buildify-cli
buildify help
```

3. 开放 API 密钥：

```bash
buildify --json key test
```

- 退出码 0：已可用。
- 退出码 2 且 `data.reason=missing_api_key`：**停止配密钥**，把 `data.userMessage` 原样发给用户（控制台「空间设置 → 开放 API 密钥 → 创建」，明文只显示一次，格式 `keyId.secret`）。用户把完整密钥发来后：

```bash
printf '%s' "$KEY" | buildify config set-key api_key
buildify --json config show    # 只看掩码
buildify --json key test
```

本 CLI 不能创建密钥。不要把密钥写入 `.env`、仓库或后续回复。

## 6. 向用户汇报

装好后用这个结构（每个客户端一行，路径写绝对路径）：

```markdown
## buildify-flow-dev 已安装

| 客户端 | 范围 | 位置 |
| --- | --- | --- |
| Cursor | 全局 | `/Users/…/.cursor/skills/buildify-flow-dev` |
| 通义灵码 | 全局 | `/Users/…/.lingma/skills/buildify-flow-dev` |

| 项 | 内容 |
| --- | --- |
| SKILL.md | 已确认 `name: buildify-flow-dev` |
| buildify-cli | 已安装 / 未装（说明原因） |
| API 密钥 | 已通过 `key test` / 待用户签发 |

下一步：新开一轮对话，提到「编排流程 / 发布 flow」，或输入 `/buildify-flow-dev`。
当前对话里 skill 列表可能还没刷新，必要时请用户 reload 窗口。
```

不要在此时开始编流程；用户明确说「接着编」再按 `SKILL.md` 走编排清单。
