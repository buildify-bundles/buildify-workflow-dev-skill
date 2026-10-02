# buildify-flow-dev

Cursor / Claude Code Agent Skill：用已安装的 Bundle 节点编排 Buildify 工作流。

与 `buildify-bundle-dev` 职责互斥：那个是「做节点」，这个是「用节点编流程」。

## 包含文件

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 主入口：编排清单、多段画布、HTTP 接口、项目/流程/服务器/凭证点选、发布摘要 |
| `install.md` | 把本 skill 装到各客户端 skills 目录 |
| `reference/cli.md` | `buildify` CLI 命令与退出码 |
| `reference/flow-json.md` | 画布 JSON：`n-` + nanoid、`errors`、`direction`（TB/LR）、分组、边 relation、批注 |
| `reference/expressions.md` | 按组件写表达式：JSON 整段以 `=` 开头、SQL `#{}` `${}`、文本 `{{ }}`；JS 节点分段注释 |
| `reference/recipes.md` | 常见骨架 |
| `reference/comment-node.md` | 批注节点字段 |

## 安装

目录名必须是 skill 名 `buildify-flow-dev`，且根目录直接有 `SKILL.md`。

Cursor 全局（所有项目可用）：

```bash
git clone https://github.com/buildify-bundles/buildify-workflow-dev-skill.git ~/.cursor/skills/buildify-flow-dev
```

项目级（随仓库共享给团队）：

```bash
git clone https://github.com/buildify-bundles/buildify-workflow-dev-skill.git .cursor/skills/buildify-flow-dev
```

其他客户端把同一目录放到各自 skills 路径即可：`~/.claude/skills/`、`~/.agents/skills/`、`~/.codebuddy/skills/`。

## 依赖

- Python 3.10+
- `pip install buildify-cli`
- 控制台签发的开放 API 密钥（`keyId.secret`），写入 `~/.buildifyrc`

```bash
printf '%s' 'keyId.secret' | buildify config set-key api_key
buildify --json key test
```

## 使用

对话里提到编排流程、发布 flow、批注、节点分组、横排/竖排、连线标签、多段、独立接口、入口验证、接口说明、访问地址，或显式 `/buildify-flow-dev` 即可触发。
