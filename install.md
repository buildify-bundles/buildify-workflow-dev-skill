---
name: buildify-workflow-dev-install
description: >-
  Installs the buildify-workflow-dev Agent Skill and its buildify CLI. The
  agent detects its own client, picks the skills directory, fetches the files,
  installs the CLI and verifies, asking the user only for the API key. Use
  when the user asks to install, update, or set up the buildify-workflow-dev
  skill, or pastes https://github.com/buildify-bundles/buildify-workflow-dev-skill.
---

# 安装 buildify-workflow-dev（给 Agent）

用户把本文件、仓库地址或「安装 workflow-dev skill」发给你时，**由你判断并完成安装**：装到哪个目录、用什么方式取文件、依赖怎么装，都自己决定，装完再汇报。不要把命令贴回去让用户执行，也不要让用户先去装别的东西。

- GitHub：<https://github.com/buildify-bundles/buildify-workflow-dev-skill>
- 备用（GitHub 连不上或超时）：<https://gitee.com/buildify/buildify-workflow-dev-skill>

唯一必须由用户提供的是 buildify-cli 密钥（控制台「系统设置 → API Keys → buildify-cli 密钥」创建，见第 5 步）。其余只在下面明确写了「停下问」的情况才问。

## 规则

- 目录名必须是 `buildify-workflow-dev`，不能用仓库名 `buildify-workflow-dev-skill`。根目录直接有 `SKILL.md`（`name: buildify-workflow-dev`）。
- 不要手抄文件，不要改 `SKILL.md`。
- **禁止**写入 `~/.cursor/skills-cursor/`（Cursor 内置技能目录）。
- 不用 `sudo`，不改系统 Python，不改 shell 配置文件。所有东西装在用户目录下。
- 密钥不要写进仓库，不要回显明文。

## 1. 判断客户端和目录

**客户端**：就是你自己所在的产品，按你的系统提示判断。判断不出时看环境变量（`CURSOR_*` → Cursor，`CLAUDECODE` → Claude Code，`CODEX_*` → Codex），再看家目录里有哪些下表的文件夹。

**范围**：用户说了「当前仓库 / 项目级 / 团队共享」才装到仓库里，否则一律**全局**。

**已经装过**：先在下表所有目录（全局和当前仓库）里找 `buildify-workflow-dev/SKILL.md`。找到就**原地更新那一份**，不要再装一份新的。

`DEST` = 下表目录 + `buildify-workflow-dev`。Windows 把 `~` 换成 `%USERPROFILE%`。

| 客户端 | 全局 | 当前仓库 |
|---|---|---|
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` |
| 通义灵码 | `~/.lingma/skills/` | `.lingma/skills/` |
| Trae 国内版（含豆包编程 / MarsCode） | `~/.trae-cn/skills/` | `.trae/skills/` |
| Trae 国际版 | `~/.trae/skills/` | `.trae/skills/` |
| Qoder 国内版 | `~/.qoder-cn/skills/` | `.qoder/skills/` |
| Qoder 国际版 | `~/.qoder/skills/` | `.qoder/skills/` |
| CodeBuddy | `~/.codebuddy/skills/` | `.codebuddy/skills/` |

- 表里没有的客户端：家目录已有 `~/.<name>/skills/`，且里面是 `技能名/SKILL.md` 这种布局，就装到那里；否则用 `~/.agents/skills/`。不要发明路径。
- Trae 国内版全局必须是 `~/.trae-cn/skills/`，Qoder 国内版全局必须是 `~/.qoder-cn/skills/`。
- Cursor 的系统提示里有用户个人的 Agent Store 时，全局再同步一份到该 store 的 `skills/buildify-workflow-dev/`。
- 只装你自己这个客户端。本机还有其他客户端时不要顺手装，在汇报里列出来，用户要再装。

## 2. 取文件

先 `mkdir -p "$(dirname "$DEST")"`，再按 `DEST` 的现状处理：

| `DEST` 现状 | 做法 |
|---|---|
| 不存在 | 克隆，见下 |
| 是 git 仓库，origin 是 GitHub 或 Gitee 那两个地址（含 `git@` 形式） | `git -C "$DEST" pull --ff-only`；失败（有本地改动、分叉）就按下一行处理 |
| 是本 skill 的旧副本（`SKILL.md` 里 `name: buildify-workflow-dev`），但不是 git 仓库或 pull 失败 | 整个目录改名为 `"$DEST.bak-$(date +%Y%m%d%H%M%S)"` 备份，再重新克隆，汇报里写备份路径 |
| 是 git 仓库但 origin 是别的地址，或里面是别的东西 | **停下问用户**，不要覆盖，也不要改 remote |

克隆：有 `git` 就先 GitHub，失败或超时再 Gitee：

```bash
git clone --depth 1 https://github.com/buildify-bundles/buildify-workflow-dev-skill.git "$DEST" \
  || git clone --depth 1 https://gitee.com/buildify/buildify-workflow-dev-skill.git "$DEST"
```

没有 `git` 就下载压缩包，不要让用户去装 git：

```bash
mkdir -p "$DEST" && curl -fsSL --max-time 60 \
  https://codeload.github.com/buildify-bundles/buildify-workflow-dev-skill/tar.gz/refs/heads/main \
  | tar -xz -C "$DEST" --strip-components 1
```

这样装的副本以后更新时，就按「旧副本」那一行备份后重装。克隆后若多了一层 `buildify-workflow-dev-skill/`，把内容挪到 `DEST` 根下。

## 3. 校验文件

```bash
grep -E '^name: buildify-workflow-dev$' "$DEST/SKILL.md"
for f in reference/cli.md reference/flow-json.md reference/expressions.md reference/recipes.md \
         reference/comment-node.md reference/report.md scripts/layout.mjs scripts/check.mjs \
         scripts/vendor/dagre.min.js; do test -f "$DEST/$f" || echo "缺少 $f"; done
```

有缺失就换另一个来源重取一次；还缺就把路径和 `ls` 结果告诉用户，不要假装成功。

## 4. 装 buildify CLI

编排要用 `buildify` 命令（PyPI 包 `buildify-cli`，要求 Python 3.10+）。**由你装好**，按顺序用第一个可用的办法：

1. 已有 `buildify` 且 `buildify help` 能跑：用 `uv tool upgrade buildify-cli` 或 `pipx upgrade buildify-cli` 升级（看它是哪种方式装的），升不了就保持原样。
2. 有 `uv`：`uv tool install -U buildify-cli`。uv 会自己准备合适的 Python，本机 Python 版本不够也不用管。
3. 有 `pipx` 且 `python3` ≥ 3.10：`pipx install buildify-cli`。
4. `python3` ≥ 3.10：`python3 -m pip install --user -U buildify-cli`。报 `externally-managed-environment` 时不要加 `--break-system-packages`，改用第 5 条。
5. 以上都不行：装 uv 到用户目录，再走第 2 条：

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh        # Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
   ~/.local/bin/uv tool install -U buildify-cli
   ```

装完 `buildify help` 确认。找不到命令时多半是 `~/.local/bin`（Windows 是 `%USERPROFILE%\.local\bin`）不在 `PATH` 里：后续直接用绝对路径调用，汇报里提一句把它加进 `PATH`，不要替用户改 shell 配置。全部失败才把最后一条命令的输出告诉用户。

## 5. buildify-cli 密钥（只有这一步要用户）

```bash
buildify --json key test
```

- 退出码 0：可以用了。
- `data.reason=missing_api_key`：按下面的说明请用户创建并发来密钥（不要原样转发 `data.userMessage`，里面的菜单路径可能是旧的）。profile 名不必问，用工作区或公司的简短英文名（如 `acme`），没有就用 `default`。

  ```markdown
  ## 需要 buildify-cli 密钥

  编排流程要用一把 buildify-cli 密钥，请在控制台创建：

  1. 打开控制台，进入 **系统设置 → API Keys → buildify-cli 密钥**
  2. 点「创建」，名称随意（如「本机编排」）
  3. 复制完整密钥发给我，格式是 `keyId.secret`（中间有一个点）

  密钥只在创建时显示一次，关掉就看不到了。一把密钥只对应一个工作区；有多个工作区时，在要编排的那个工作区里创建。我只把它存到本机 `~/.buildifyrc`，不会写进仓库，也不会在回复里显示。
  ```

  收到后：

  ```bash
  printf '%s' "$KEY" | buildify config add-profile "$PROFILE"
  buildify --json key test
  ```

- `data.reason=profile_required`：本机已存了多个工作区，列出 profile（名称、tenantId、密钥名，不含密钥）请用户点一个，之后命令加 `--profile`。不要 `config use`。

用户暂时不给密钥也算装完，汇报里写「待配置密钥」。本 CLI 不能创建密钥。不要把密钥写入 `.env`、仓库或后续回复。

## 6. 可选项：只检查，不安装

- `node --version` ≥ 18：排版和检查脚本可用（不用 `npm install`），用 `node "$DEST/scripts/layout.mjs" --help` 确认。没有或版本太低时不要装 Node，只在汇报里说：编排时改用手算坐标、人工核对边和图标。
- 同一 skills 根目录下有没有 `buildify-bundle-dev/SKILL.md`。没有不用现在装：编排时没有软件包会先请用户到管理后台「开发中心 → 软件包」创建，再按 <https://buildify.cn/buildify-bundle-dev/install.md> 安装后开发和发布。

## 7. 汇报

一张表，路径写绝对路径：

| 项 | 内容 |
| --- | --- |
| 安装位置 | `/Users/me/.cursor/skills/buildify-workflow-dev`（新装 / 已更新 / 旧副本已备份到 …） |
| 来源 | GitHub git / Gitee git / GitHub 压缩包 |
| buildify CLI | 已安装（uv tool）/ 已是最新 / 失败：原因 |
| buildify-cli 密钥 | 可用（工作区名）/ 待配置：系统设置 → API Keys → buildify-cli 密钥 |
| Node 18+ | 可用 / 没有，编排时手算坐标 |
| buildify-bundle-dev | 已装 / 未装，缺软件包时再装 |

本机还有其他客户端时，表下加一句「还检测到 Claude Code、Trae，需要的话我也装上」。最后说下一步：新开对话，提到编排流程或输入 `/buildify-workflow-dev`（当前对话可能还没刷新技能列表）。不要在这时开始编流程。
