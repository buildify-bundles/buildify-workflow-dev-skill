# 流程 canvas JSON

控制台把编辑器画布存进 `workflow_version.workflow_json`。本 skill 生成的就是这份 **Vue Flow 文档**，不是 worker 上的运行时 JSON。

**一般不用手写。** 新建和改已有都用 `scripts/build.mjs` 从 spec 生成（见 [recipes.md](recipes.md)），这份文档用来读懂已有草稿、或手改脚本表达不了的地方。手改后跑 `check.mjs --fix` 和 `layout.mjs`。坐标规则见 [layout-manual.md](layout-manual.md)，有 Node 时不用读。

`bundleId` 已废弃。节点必须写 `data.bundleName`。

## 顶层

```json
{
  "nodes": [],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "direction": "TB",
  "errors": {}
}
```

- 解析器只读 `nodes` 与 `edges`。`viewport` / `position` 是 UI 字段，交给排版脚本。
- **`direction` 必写**：`TB` 竖向（默认）或 `LR` 横向。用户明确要横排才用 `LR`；改已有沿用草稿。
- **`errors` 必写**：表单校验结果按节点 id 汇总。全部通过 `{}`；未通过 `{"<nodeId>": <未通过字段数>}`，只计表单 ERROR（缺必填、枚举非法、未知键、凭证），不计 WARNING 和环。每次 `workflow validate` 后用 `result.mjs validate … --write-errors` 写回，再 save-draft。

## 节点（执行相关）

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 是 | **`n-` + 8 位 nanoid**（如 `n-k7mX2pL9`），本流程内唯一。类型没变（`data.name` 和 `data.bundleName` 都没变）不要改 id，也不要删掉节点再贴一个同类型新 id。`data.name` 或 `data.bundleName` 变了必须换新 id（避开按 id 缓存的旧节点），边的 `source` / `target` 与边 id（`{source}_{target}`）一并改。不要用 `n1` / `trigger` 这类可读名 |
| `type` | 否 | Vue Flow 视觉类型，用 `"default"`。它**不是** bundle 节点类型，执行节点的类型是 `data.name` |
| `position` / `sourcePosition` / `targetPosition` | 脚本写 | 排版脚本计算。`TB` 是 `bottom` / `top`，`LR` 是 `right` / `left`。分组框/批注不写锚点 |
| `data.name` | 是 | Bundle 节点 id，例如 `JsFunctionNode` |
| `data.bundleName` | 是 | 与 `bundle list` 的 `bundleName` 完全一致，如 `buildify/core` |
| `data.bundleVersion` | 是 | 钉死的版本，用目录回显的 `bundleVersion`，不要写 `latest` |
| `data.parameters` | 视表单 | 键必须出现在该节点表单里 |
| `data.credentials` | 视表单 | `{ "<槽名>": { "type": "PascalCase", "name": "实例名" } }`，同一个对象也写进 `parameters.<槽名>`（控制台这样存）。`type` / `name` 必须来自用户从 `project credentials` 点选的那条 |
| `data.icon` | **是** | 目录里**该节点类型**的 `icon` 文件名（如 `js.svg`），不要凭名字猜（`JsFunctionNode` 是 `js.svg`，`HttpRequestNode` 是 `request.svg`），不要借别的节点或软件包的图标，不要写 URL。同一类型的节点图标相同 |
| `data.label` | 建议 | 目录 `label` 原样拷贝（节点类型名，如「Webhook」「JavaScript」） |
| `data.summary` | **建议** | 画布默认显示。写这颗节点在**本流程**中的职责，**≤8 字**；不要照抄目录 `summary`，也不要写路径、SQL、字段名 |
| `data.isTrigger` | 建议 | 目录里 `isTrigger: true` 的节点必须标上 |
| `data.disabled` | 否 | `true` 时跳过执行 |
| `data.isLayoutNode` | 否 | `true` 时解析器忽略（分组框、批注），不要给业务节点加 |
| `parentNode` | 组内必写 | 分组框的 `id`。不写就分不进去，只是画在附近 |
| `extent` | 建议 | 组内节点写 `"parent"`，拖动时留在框内 |

`label` 与 `summary` 分工：`label` 跟目录走；`summary` 描述这一颗节点做什么，要短。

| 差 | 好（≤8 字） |
|---|---|
| 接收 /devices Webhook | 接收请求 |
| 按 projectId 查询设备 | 查询设备 |
| 把 JSON 上传到 OSS all.json | 上传 OSS |

**消息结构**：触发器的 payload 在根级（`msg.xxx`）；普通节点的输出在 payload 里包一层 `output`（`msg.output.xxx`），上游字段仍保留；**`JsFunctionNode` 的返回值直接成为下游的整个 `msg`**，没有 `output` 这一层。占位名用 `msg`，不要用 `$json`。表达式语法见 [expressions.md](expressions.md)。

### 分支：必要时复制配置相同的节点

画布清晰优先于「少画一个节点」。两条支路都要做同一件事，但共用一个节点会让边斜穿、交叉或绕行时，每条支路各放一份（新 id，`name` / `parameters` / `credentials` 相同，`summary` 可写成「成功返回」「失败返回」）。线性流程、或支路沿流向正前方能干净接到同一个节点时仍共用。至少 3 个旁支汇到同一个没有出边的收尾节点时也保持共用。**不要复制触发器**。

## 边

**同一对 `source` + `target` 只能有一条边。** 多个出口接到同一个下游时，把这些 relation 全部放进这一条的 `data.relations[]`。

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 是 | 固定 `{source}_{target}`。不要带出口名（`…_Success`） |
| `type` | 建议 | `"default"` |
| `source` / `target` | 是 | 节点 `id`。只连执行节点，不连分组框和批注 |
| `data.relations` | 是 | 非空数组，接到本 target 的出口全部列在这里，**整份拷贝**源节点 `node-relations` 里对应的对象 |
| `data.relations[].name` | 是 | 源节点出口目录里的名字；MCP / RelationCollection 自定义关系用条目映射出的 `name`（如 `tools/get_user`） |
| `data.relations[].label` | 是 | 画布出口文字，用目录里的值（Success 一般 `成功`，Failure 一般 `失败`，IfNode 是 `是` / `否`）。缺了控制台不显示连线文字 |
| `data.relations[].description` | 否 | 出口说明，可以照目录写，也可以改写成本流程里的含义（如「查不到也继续」） |
| `data.relations[].icon` / `_id` / `mcpKind` | 视关系 | MCP 等自定义关系必拷，并同步到源节点 `data.relations`（同一份），否则画布左侧出口没有文字和图标 |
| `label` | 建议 | 固定 `""` |
| `zIndex` | 建议 | `2000` |

正确写法（两个出口接同一下游）：

```json
{
  "id": "n-get-sender_n-js-sender",
  "type": "default",
  "source": "n-get-sender",
  "target": "n-js-sender",
  "data": {
    "relations": [
      { "name": "Success", "label": "成功", "description": "查到员工" },
      { "name": "Failure", "label": "失败", "description": "查不到也继续，卡片仍用 open_id 展示" }
    ]
  },
  "label": "",
  "zIndex": 2000
}
```

错误写法是按出口拆成两条边、id 带出口名、出口缺 `label`。`check.mjs --fix` 能把它合并成上面的写法。

MCP 自定义出口（源节点 `data.relations` 与边上都要同一份）：

```json
{ "label": "获取用户信息", "name": "tools/get_user", "description": "获取用户的可用信息", "_id": "t-ozynvj4p", "mcpKind": "tools", "icon": "mcp-tools" }
```

## 批注节点（便签，不执行）

**默认不加。** 用户明确要求「写接口文档」「加说明 / 批注 / 便签」时才加：接口文档一个接口一张；不要复述 `summary`，不要每个节点贴一张。正文写法见 [comment-node.md](comment-node.md)。spec 里写 `{ "key": "doc", "comment": "正文", "width": 480, "parent": "分组 key" }`，脚本按下面的形状生成并排位。

```json
{
  "id": "n-Cm2xQ7aB",
  "type": "comment",
  "position": { "x": 0, "y": 0 },
  "zIndex": 2,
  "parentNode": "n-groupId",
  "style": { "width": "480px", "height": "200px" },
  "data": {
    "name": "CommentNode", "label": "comment", "summary": "批注",
    "hasInput": false, "hasOutput": false, "isLayoutNode": true, "isShowConfigOnAdd": false, "autoEdit": false,
    "parameters": {
      "commentMarkdown": "**接口说明**：创建一个新用户账号\n\n**请求方式**：`POST`",
      "commentBackground": "ink", "commentBackgroundOpacity": 0, "commentBorderWidth": 1.5
    }
  }
}
```

- 不写 `bundleName` / `bundleVersion`，不连边，不写锚点。旧画布可能是 `type: "notes"`，与 `comment` 同等对待。
- 宽默认 **320**，HTTP 接口文档 **480**（180–480）；高按正文估 `28 + 17×正文行数 + 20×标题行数`，限制在 50–480。已有正文时不要 `autoEdit: true`。
- 说明某个模块时写该框的 `parentNode`，说明整张画布时不写。不要用批注当分组框。

## 节点分组

**默认不分组。** 何时分组见 SKILL「生成画布」。分组框是布局节点：

```json
{
  "id": "n-Gq3aT9xK",
  "type": "group",
  "position": { "x": 45, "y": 24 },
  "style": { "width": "344px", "height": "195px" },
  "zIndex": 0,
  "data": {
    "name": "GroupNode", "label": "group", "summary": "查询", "isLayoutNode": true,
    "parameters": { "groupLabel": "查询" }
  }
}
```

- `position` / `style` 宽高和组内子节点的相对坐标由排版脚本算（留白左右 48、上 84、下 48）。标题在框内，框的最上沿就是框 `y`。
- 不写 `bundleName` / `bundleVersion`，**不出现在任何 `edges` 里**；边照常连组内业务节点，可以跨框。不要去 `bundle nodes` 里找 `GroupNode`。
- 组内每个执行节点都写 `parentNode`（+ `extent: "parent"`），漏一个就漂在框外。
- `groupLabel` / `summary` 用这个模块的短名。不写 `groupColor` / `groupOpacity` / `groupRadius` / `groupBorder*`，样式走系统默认；用户明确要求某种颜色或边框时才写。已有草稿里的分组样式不要改。一层即可，不要嵌套分组，除非用户明确要求。

## 校验顺序

`buildify workflow validate` 按这个顺序报 `issues`：

1. 结构（缺 `node.id` / `data.name` / `data.bundleName` / `data.bundleVersion` / 边的 source/target / relation.name）
2. 节点在当前工作区是否存在且可访问
3. `data.parameters` 对照表单（未知键、缺必填、枚举非法；Collection / Fixed 里没有显示条件的必填子字段也会报，如 Webhook 的 `options.cors`）
4. `edges[].data.relations[].name` 对照源节点出口
5. `data.credentials` 对照项目里已有凭证（`bundleName + type + name`）
6. 图：至少一个触发器、孤立节点、环。**环允许**，但环上要有离开循环的出口；缺触发器和孤立节点仍要修
7. 展示：目录里有 `icon` 但画布 `data.icon` 为空时记 **WARNING**
8. 展示：边上 `relations[]` 缺 `label`（或自定义关系缺 `icon` / `_id`）时记 **WARNING**

`level=ERROR` 必须修，环除外。`WARNING` 也要修。同一对节点两条边、边 id 不对、图标用错这几类 validate 不一定能发现，靠 `scripts/check.mjs`。

## 检查脚本

```bash
node <skill 目录>/scripts/check.mjs ./flow.json [--catalog-dir DIR] [--fetch [--profile NAME]] [--catalog FILE ...] [--fix] [-o out.json]
```

| 项 | 说明 |
|---|---|
| 目录 | `--catalog-dir` 读 `catalog.mjs` 的缓存，每个包只取和画布 `bundleVersion` 一致的那份；`--fetch` 把还缺的按画布版本拉下来。都不给时只查结构、格式和同类一致性 |
| 边 | 同一对 `source` + `target` 只能一条；`id` = `{source}_{target}`；`data.relations` 是非空数组；出口 `name` 不重复、在目录里存在；每个出口有 `name` 和 `label`；边自身 `label` 为空 |
| 图标 | 执行节点必须有 `data.icon`，是图标文件名；和目录里这个节点类型的 `icon` 一致；同一类型的节点图标相同。`label` 与目录不同、`isTrigger` 不对也会报 |
| `--fix` | 合并重复边、改正边 `id`、从目录补出口 `label`、图标、`isTrigger`，清空边自身 `label`。不动 `description`。目录里没有的出口名不改，仍报 ERROR |
| 退出码 | 0 没有 ERROR（可能有 WARNING）；1 还有 ERROR；3 文件、参数或拉目录失败 |

合并了重复边之后结构变了，再跑一次排版脚本。目录里两个类型共用一个图标是正常的（如 Webhook 触发器和 Webhook 应答都用 `webhook.svg`）。
