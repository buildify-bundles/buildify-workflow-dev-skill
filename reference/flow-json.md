# 流程 canvas JSON

控制台把编辑器画布存进 `workflow_version.workflow_json`。本 skill 生成的就是这份 **Vue Flow 文档**，
不是 worker 上的运行时 JSON。

`bundleId` 已废弃。节点必须写 `data.bundleName`。仓库里个别测试 fixture 仍用 `bundleId`，不要照抄。

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

解析器只读 `nodes` 与 `edges`。`viewport` / `position` / `zoom` 是 UI 字段，但要给互不重叠的坐标，否则画布叠在一起。
顶层 **`errors` 必写**：表单校验结果按节点 id 汇总。全部通过写 `{}`；未通过写 `{"<nodeId>": <未通过字段数>}`。`workflow validate` 之后把这份汇总写回 JSON 再 save-draft。
顶层 **`direction` 必写**：控制台画布排列方向，决定主链怎么走、连线从哪边进出。缺了控制台按 `TB`。

## 画布排列（按 `direction`）

控制台工具栏只有两种：`TB` 竖向、`LR` 横向。编排时**必须写顶层 `direction`**，并按同一方向排 `position`、给每个执行节点写 `sourcePosition` / `targetPosition`。不要混用（例如 `direction: "LR"` 却竖着排）。

**默认 `TB`。** 用户明确要求横排 / 横向 / 从左到右 / `LR` 时才用 `LR`。改已有流程时沿用草稿里的 `direction`，不要仅为换方向而大挪节点，除非用户要求重排。

节点不要当成一个点。执行节点按卡片 **宽 248、高 63** 占位。这是控制台自动排版在 JSON 里没有实测宽高时的兜底尺寸（`applyLayout.js` 的 `DEFAULT_NODE_WIDTH` / `DEFAULT_NODE_HEIGHT`），间距按这个算，不要再用 240×88。

步进 = 该方向上的卡片边长 + 净空。同层沿流向对齐：`TB` 同一层 `y` 相同（顶齐），`LR` 同一层 `x` 相同（左齐）。分叉时父节点在交叉轴上居中盖住两侧子节点。画布第一张卡片从 `{ "x": 45, "y": 24 }` 起（自动排版的 `marginx` / `marginy`）。

| `direction` | 锚点 | 主链（这一层出度 1） | 同层兄弟（全图最大出度 ≤2） | 扇出 |
|---|---|---|---|---|
| `TB`（默认） | `sourcePosition: "bottom"`，`targetPosition: "top"` | 同一 `x`，`y += 153`（净空 **90**） | 同一 `y`，相邻 `x += 298`（净空 **50**） | 上一层有普通节点出度 **= 2**：下一层改为 `y += 183`（净空 **120**）。出度 **≥ 3**：下一层 `y += 199`（净空 **136**），兄弟改为 `x += 288`（净空 **40**） |
| `LR` | `sourcePosition: "right"`，`targetPosition: "left"` | 同一 `y`，`x += 388`（净空 **140**） | 同一 `x`，相邻 `y += 135`（净空 **72**） | 出度 **= 2** 不加长。出度 **≥ 3**：下一层改为 `x += 418`（净空 **170**），兄弟改为 `y += 119`（净空 **56**） |

一层里只要有一个普通节点达到上表扇出，**下一层整层**一起沿流向加长。分组框的出度不算。不要按一条边上有几个出口 label 再加长度，也不要把步进收到比上表更短。

`TB` 主链（净空 90，出口文字落在两卡片之间的竖线上）：

```
[触发]  x=45 y=24
[处理]  x=45 y=177
[应答]  x=45 y=330
```

`LR` 主链（净空 140）：

```
[触发] x=45 y=24  →  [处理] x=433 y=24  →  [应答] x=821 y=24
```

分叉的目标放在**下一层**，父节点居中，兄弟用上表净空。不要和源节点放在同一层紧旁边。

```
TB（出度 2，下一层净空 120）          LR（出度 2，层距不加长，兄弟净空 72）

        [判断] x=194 y=24              [判断] x=45 y=92
       /                \                 |                \
[A] x=45 y=207    [B] x=343 y=207   [A] x=433 y=24    [B] x=433 y=159
```

`TB` 里两个子节点的 `x` 是 `45` 和 `45 + 298`，父节点 `x = (45 + 343) / 2 = 194`。`LR` 里子节点 `y` 是 `24` 和 `24 + 135`，父节点 `y` 取两侧的垂直中心 `92`。

规则（两种方向共用）：

- 同层对齐：`TB` 同一层 `y` 相同，`LR` 同一层 `x` 相同。用上表的间距，不要斜着错开半格
- 主链优先走直线（`TB` 同 `x`，`LR` 同 `y`）
- 出口文字由控制台按折线摆，编排只要把净空留够：一条顺向边的文字在两卡片之间；同一节点分出两条及以上顺向边时，线在源节点附近共用主干再分叉，文字落在进入各自目标前的分支上；多条边汇入同一目标时，文字在各自来路上。不要为了拆开文字去加大列距，也不要把多个出口拆成多条边
- 不要交叉、不要穿过别的节点、不要让文字压在卡片上
- 能沿流向直连汇合、边不穿过别人时，再共用下游；否则各支路继续沿主方向排
- 分组框、批注不要写 `sourcePosition` / `targetPosition`。批注以及 `type: text` / `notes` 不参与自动排版
- 批注和分组框各占一块矩形。框外节点、另一块分组、批注都按**矩形外缘**留空，不要用卡片步进去挨着框。见下文「批注节点」「节点分组」
- 两段及以上互不连线时，段内用上表步进，段与段之间按外接矩形错开。见下文「多段并列」

### 多段并列（互不连线的几段）

一段 = 从一个触发器出发、彼此有边相连的那一组。两段之间没有边（例如两个独立接口）时，先各自按上表排段内坐标，再按**这一段的外接矩形**平移，不要假设每段都只有一列。卡片仍按 248×63。一段内部有分支时，外缘按最外一张卡片（或分组框）算。

| `direction` | 各段对齐 | 下一段从哪开始 | 第一段原点 |
|---|---|---|---|
| `TB` | 顶对齐（各段最小 `y` 相同） | `x = 上一段最右外缘 + 50` | 主链 `x = 45`，`y = 24` |
| `LR` | 左对齐（各段最小 `x` 相同） | `y = 上一段最下外缘 + 72` | 主链 `x = 45`，`y = 24` |

`TB` 两段（左段两路分叉，右段从最右卡片右缘 `343 + 248` 再加 50）。左段出度 2，所以下一层整层（含右段同一深度）用净空 120，右段第二张不是 177 而是 207：

```
[触发A] x=194 y=24                 [触发B] x=641 y=24
[处理A] x=45 y=207  [处理A2] x=343 y=207    [处理B] x=641 y=207
```

`LR` 同理：取最下卡片下缘，再 `+ 72`。各段同一深度的节点合并后共用流向坐标；层距取**整图**这一层的最大扇出，不要只拉有分叉的那一段。

段内坐标可以从局部原点 `(0, 0)` 起（这时不要再加 45/24），合并时给整段加上边距和平移。边不要跨段。接口批注和分组在各段就位后再加，不要每段各贴一张。**多于两段**（三段及以上、段与段没有边）时，每段套一个分组框，段内坐标改成相对框的 `position` 并写 `parentNode`。两段并列默认不加分组。每个 HTTP 接口再加一张批注，见「批注节点」。

### 分支：必要时复制配置相同的节点

画布清晰优先于「少画一个节点」。两条支路都要做**同一件事**（同一 `data.name`、同一套 `parameters` / `credentials`），但共用一个节点会让边斜穿、交叉或绕行时：**每条支路各放一份**，不要强行汇合。

| 才复制 | 仍然共用 |
|---|---|
| 成功/失败（或多出口）各自收尾，例如各回一次 Webhook、各写一次库 | 线性流程，没有分叉 |
| 汇合边会穿过中间节点或和其他边交叉 | 支路沿流向正前方能干净接到同一个节点，边不穿过别人 |
| 为绕到共用节点必须斜线、回头、跨列 | 只是少画一个相同配置的节点 |

复制时：**重新抽一个 `n-` + nanoid** 作新 `id`（不要复用、不要 `n1`/`n2`）；`name` / `bundleName` / `bundleVersion` / `icon` / `label` / `parameters` / `credentials` 与原配置一致（支路本身不同的字段除外）；`summary` 仍 ≤8 字，可相同或略区分（如「成功返回」「失败返回」）。**不要复制触发器**，也不要无意义地复制整条链。

## 节点（执行相关）

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 是 | **`n-` + nanoid**（如 `n-k7mX2pL9`），本流程内唯一。边的 `source` / `target` 引用它。真正生成时不要用 `n1` / `trigger` 这类可读名 |
| `type` | 否 | Vue Flow 视觉类型，用 `"default"` |
| `position` | 建议 | `{ "x": number, "y": number }`。卡片按 **248×63**。`TB` 主链同一 x、从 `y=24` 起每步 +153（出度 2 的下一层 +183，出度 ≥3 为 +199），兄弟 x 相差 298（出度 ≥3 为 288）。`LR` 主链同一 y、从 `x=45` 起每步 +388（出度 ≥3 的下一层 +418），兄弟 y 相差 135（出度 ≥3 为 119）。见「画布排列」 |
| `sourcePosition` | 建议 | 执行节点连线出口边。与 `direction` 一致：`TB` 用 `"bottom"`，`LR` 用 `"right"`。分组框/批注不要写 |
| `targetPosition` | 建议 | 执行节点连线入口边。与 `direction` 一致：`TB` 用 `"top"`，`LR` 用 `"left"`。分组框/批注不要写 |
| `data.name` | 是 | Bundle 节点 id = `@FlowNodeDescription.name`，例如 `JsFunctionNode` |
| `data.bundleName` | 是 | 逻辑名，与 `buildify bundle list` 的 `bundleName` 完全一致 |
| `data.bundleVersion` | 是 | 钉死的版本；用 `bundle nodes` 回显的 `bundleVersion`，不要写 `latest` |
| `data.parameters` | 视表单 | 对象，键必须出现在该节点 `properties_json` |
| `data.credentials` | 视表单 | 对象：`{ "<槽名>": { "type": "PascalCase", "name": "实例名" } }`。`type`/`name` 必须来自用户从 `project credentials` 点选的那条，禁止默认第一条或编造 |
| `data.icon` | **建议** | 从 `bundle nodes`（或 `node-properties`）该项的 `icon` **原样拷贝**。通常是 `webhook.svg` 这种文件名，控制台靠它显示节点图标。不要改写成 OSS URL，也不要省略 |
| `data.label` | 建议 | 从目录 `label` **原样拷贝**节点类型名（如「Webhook」「JS 函数」）。不要把本流程职责写到这里 |
| `data.summary` | **建议** | 画布**默认显示**此字段。写该节点在**本流程**中的职责，**≤8 字**（最长 10 字）。不要照抄目录通用 `summary`，也不要写路径、SQL、字段名 |
| `data.isTrigger` | 建议 | 触发器写 `true`；目录里 `isTrigger: true` 的节点必须标上 |
| `data.disabled` | 否 | `true` 时跳过执行 |
| `data.isLayoutNode` | 否 | `true` 时解析器忽略（分组框、**批注**），不要给业务节点加这个 |
| `parentNode` | 组内必写 | 分组框的 `id`。组内组件**必须**设置后才是真实分组；不写则只是画在附近。`position` 相对分组框左上角，**留白不要贴边** |

`type`（Vue Flow）**不是** bundle 节点类型。执行节点的类型是 `data.name`。批注用 Vue Flow `type: "comment"`，见下文。

槽名（credentials 的 key）等于表单里 `CredentialSelect` 字段的 `name`，常见为 `credentialsId`。用 `bundle node-properties` 确认，不要猜。实例名必须是用户从 `project credentials` 点选的，禁止默认第一条。

### 节点 id：`n-` + nanoid，流程内唯一

每个节点（含批注、分组框、复制出来的节点、组内子节点）的 `id` 用 **`n-` 前缀 + 8 位 nanoid** 生成，保证**本流程内**不重复。边的 `source` / `target` 必须引用这个 id。已有草稿上的旧 id 不要改（改了边会对不上）；只给**新生成**的节点抽新 id。

```bash
python3 -c "import secrets,string; a=string.ascii_letters+string.digits; print('n-' + ''.join(secrets.choice(a) for _ in range(8)))"
```

得到如 `n-k7mX2pL9`。抽到已占用的值就重抽。边的 `id` 仍用 `{source}_{target}`。文档示例里的 `n1` / `trigger` 只为便于阅读，真正写入画布时不要照抄。

### 表单校验：`errors` 写入流程 JSON

画布顶层必须带 `errors`，按节点 id 汇总未通过的表单字段数。`workflow validate` 之后**写回这份 JSON**，不要只读响应、不落盘。

全部通过：

```json
{"errors":{}}
```

未通过（key 是节点 `id`，value 是该节点未通过字段数）：

```json
{"errors":{"n-k7mX2pL9":1}}
```

多个节点：`"errors":{"n-k7mX2pL9":1,"n-CIq2dZyc":2}`。只统计表单参数 ERROR（缺必填、枚举非法、未知键），不要把 WARNING 写进去。

处理：用 key 在 `nodes[]` 里定位 → 对照 `node-properties` 修 `data.parameters` → 再 `workflow validate` → 把新的 `errors` 写进 JSON。用户明确说稍后自填时，仍要把当前汇总写进去再 save-draft。`issues[].nodeId` 与此同一套 id。

`label` 与 `summary` 分工：`label` 是节点类型名（跟目录走）；`summary` 是画布卡片上的默认文案，描述**这一颗**节点在本流程里做什么，**要短**。

| 差 | 好（≤8 字） |
|---|---|
| 接收 /devices Webhook | 接收请求 |
| 按 projectId 查询设备 | 查询设备 |
| 把 JSON 上传到 OSS all.json | 上传 OSS |

空 `summary` 时画布几乎没有可读信息，不要省略；超长会撑破卡片，也不要写。

## 批注节点（便签，不执行）

Markdown 便签，**默认不要加**。没有对外 HTTP 接口时，流程只靠节点 `summary` 和连线就够读。解析器遇到 `data.isLayoutNode: true` 会跳过，**不要写** `bundleName` / `bundleVersion`，**不要连边**。可写字段与 Markdown 见 [comment-node.md](comment-node.md)。

**默认 0 张**，下面除外。HTTP 接口是每个接口一张，不是整图最多一张。

| 才加 | 仍然不加 |
|---|---|
| 用户明确要求批注 / 便签 / notes | 定时拉取、两节点回显、没有对外 HTTP 路径 |
| **每个 HTTP 接口一张**：接口说明 + 访问地址 | 复述节点 `summary` / `label` |
| 分支条件或互斥路径，光看 `summary` 会走错 | 空流程；每个执行节点贴一张 |
| 调用约定、凭证用途、单位/映射 **写进 `summary` 放不下**，不写会误用 | 用批注重复触发器上已经写好的入站认证 |

位置在被说明盒子外侧。先排完执行节点和分组框，再按批注**自己的宽高**留出净空，避免和节点或分组框叠在一起，也不要挡住连线中点。

单段：`TB` 放最左外侧，`LR` 放最上外侧（公式见下）。多段（每段一张接口批注）：放在**不朝向相邻段**的一侧，避免盖住旁边那段。`TB` 各段左右排列，批注放在该段分组框（或该段卡片）**上方**，`y = 该段顶边 - 批注高 - 80`，`x` 与该段左缘对齐。`LR` 各段上下排列，批注放在该段**左侧**，`x = 该段左缘 - 批注宽 - 80`，`y` 与该段顶边对齐。批注不进自动排版，写好后保持这个相对位置。

批注矩形 = `position` 起、`style.width` × `style.height`（默认 **280×160**）。最左 / 最上取**顶层盒子外缘**：没有 `parentNode` 的节点用它的 `x` / `y`，分组用框的 `x` / `y`。组内子节点已经在框里，不要拿子节点的绝对坐标当最左 / 最上。

- 单段 `TB`：放在最左外缘的左侧。`x = 最左外缘 - 批注宽 - 80`，`y` 与被说明盒子的顶边对齐。右缘和最左盒子之间空出 **80**
- 单段 `LR`：放在最上外缘的上方。`y = 最上外缘 - 批注高 - 80`，`x` 与被说明盒子的左缘对齐。底边和最上盒子之间空出 **80**

算出来 `x < 40` 或 `y < 40` 时，只把**顶层**节点（自由节点、分组框、批注）平移，使批注落在 40。组内 `position` 是相对框的，不要跟着加这份平移。

`zIndex: 2`。不要写 `sourcePosition` / `targetPosition`，不要写 `parentNode`。无分支、主链 `x=45`、`y=24`、批注 280×160 时，先算出 `x = 45 - 280 - 80 = -315`，再把顶层整体右移，使批注落在 `{ "x": 40, "y": 24 }`，主链因此到 `x = 400`。字多把宽高加大后，用同一公式重算。

正文写 `parameters.commentMarkdown`（GFM，短：`##` 标题 + 一两句或要点）。HTTP 接口固定两节，不要再写认证方式或字段表：

```markdown
## 接口说明

按订单号查询订单状态。

## 访问地址

`GET /api/orders/:id`

- 生产：`http://{externalHost}:{httpPort}/api/orders/:id`
- 测试：`http://{externalHost}:{httpPort}/@test/api/orders/:id`
```

`externalHost`、`httpPort` 用已确认服务器的字段；缺了就只保留方法和 path，写「完整地址 = 服务器访问地址 + 路径」。不要编造域名。测试前缀是 `/@test`，生产不加。

已有正文时 **不要** `autoEdit: true`。**需要写时**用这个形状，不要默认拷进每份流程；`id` 换成 `n-` + nanoid，不要照抄 `note-trigger`：

```json
{
  "id": "note-trigger",
  "type": "comment",
  "position": { "x": 40, "y": 24 },
  "zIndex": 2,
  "style": { "width": "280px", "height": "160px" },
  "data": {
    "name": "CommentNode",
    "label": "comment",
    "summary": "批注",
    "hasInput": false,
    "hasOutput": false,
    "isLayoutNode": true,
    "isShowConfigOnAdd": false,
    "autoEdit": false,
    "parameters": {
      "commentMarkdown": "## 接口说明\n\n返回当前时间，无需登录。\n\n## 访问地址\n\n`GET /test2`\n\n完整地址 = 服务器访问地址 + `/test2`。测试在路径前加 `/@test`。",
      "commentBackground": "amber",
      "commentBackgroundOpacity": 0.1
    }
  }
}
```

旧画布可能是 `type: "notes"`，读写时与 `comment` 同等对待。背景默认 `amber`；不要编造 `bundle` 节点名叫 CommentNode 去 `bundle nodes` 里找。**不要用批注当分组框**（分组见下一节）。

## 节点分组

画布分区用 Vue Flow 父子节点。**多于两段**互不连线的独立逻辑（三段起）才默认加，每段一个框。两段及以下默认不加。用户明确要求分组时，不论段数都加。一段里的成功/失败分支不算单独的逻辑，不要为分支加框。

**组内组件必须写 `parentNode`，否则不是真实分组。** 只把节点画在框的坐标范围内、或用批注撑一块背景，控制台不会把它们当成一组。

分组框（父节点）是布局节点：`type: "group"`，`data.isLayoutNode: true`，给足 `style` 宽高。**不要写** `bundleName` / `bundleVersion`，**不要出现在任何 `edges` 里**。组内业务节点照常写 `data.name` / `bundleName` / 参数，并连边。

| 字段 | 谁写 | 含义 |
|------|------|------|
| 分组框 `id` | 框 | **`n-` + nanoid**，流程内唯一 |
| 分组框 `type` | 框 | `"group"` |
| 分组框 `position` | 框 | 画布绝对坐标（框的左上角） |
| 分组框 `style` | 框 | 必须带 `width` / `height`。按子节点包络**再加边距**算出，不要刚好卡住 |
| 分组框 `data.isLayoutNode` | 框 | `true`（解析器跳过） |
| 分组框 `data.name` / `label` | 框 | `"GroupNode"` / `"group"`。不要去 `bundle nodes` 里找这个名字 |
| 分组框 `data.summary` | 框 | 分区名，短词（如「上报」「查询」），与 `parameters.groupLabel` 相同 |
| 分组框 `parameters.groupColor` | 框 | 默认雾蓝 `"#5b7c99"`。多组可换色相，透明度不要跟着变 |
| 分组框 `parameters.groupOpacity` | 框 | **默认 `0.06`**。合法 `0.04`–`0.72`。省略时控制台按 `0.1` 画，比这个更深，所以编排必须写上 |
| 分组框 `parameters.groupRadius` | 框 | 默认 `12` |
| 分组框 `parameters.groupBorderStyle` | 框 | 默认 `"dotted"`（还可 `solid` / `dashed` / `none`） |
| 分组框 `parameters.groupBorderWidth` | 框 | 默认 `1` |
| 子节点 `parentNode` | **组内每个组件必写** | 分组框的 `id`。不写就分不进去 |
| 子节点 `position` | 组内 | **相对**分组框左上角。留白：左/右 **40**，上 **60**（给标题），下 **36**。**不要贴边** |
| 子节点 `extent` | 建议 | `"parent"`，拖动时留在框内 |

形状（子节点用 `parentNode` 挂到框上）：

```json
{
  "id": "2",
  "type": "group",
  "position": { "x": 45, "y": 24 },
  "style": { "width": "328px", "height": "162px" },
  "zIndex": 0,
  "data": {
    "name": "GroupNode",
    "label": "group",
    "summary": "查询",
    "isLayoutNode": true,
    "parameters": {
      "groupLabel": "查询",
      "groupColor": "#5b7c99",
      "groupOpacity": 0.06,
      "groupRadius": 12,
      "groupBorderStyle": "dotted",
      "groupBorderWidth": 1
    }
  }
}
```

```json
{
  "id": "2a",
  "data": { "label": "child node" },
  "position": { "x": 40, "y": 60 },
  "parentNode": "2"
}
```

真正写入画布时：框和子节点的 `id` 都换成 `n-` + nanoid；子节点补齐业务字段（`type: "default"`、`data.name` / `bundleName` / `bundleVersion` / `icon` / `summary` / `parameters`），并建议加 `"extent": "parent"`。

| 才加 | 仍然不加 |
|---|---|
| 用户明确要求分组 / 分区 / group | 线性 Webhook→处理→应答；只有一段；一段里的分支 |
| **多于两段**互不连线的独立逻辑，每段一个框 | 刚好两段并列（除非用户要求）；每个节点一个框 |

规则：

- 组内每个执行节点都要写 `parentNode`，漏一个就漂在框外。
- **组内留白，不要贴边。** 首个子节点 `{ "x": 40, "y": 60 }`。组内比画布更紧，卡片仍按 248×63：`TB` 时 `y += 119`（净空 56）、兄弟 `x += 292`（净空 44）；`LR` 时 `x += 344`（净空 96）、兄弟 `y += 111`（净空 48）。组内出度 ≥ 3 才加长：`TB` 下一层改为 `y += 143`、兄弟 `x += 280`；`LR` 下一层改为 `x += 358`、兄弟 `y += 99`。出度 = 2 不加长。左/右垫 40，上垫 60（给标题），下垫 36。卡片相对坐标是相对框的，不要写成画布绝对坐标。
- 框的宽高按子节点包络再加边距：`width = max(子节点右缘 + 40, 315)`，`height = max(子节点下缘 + 36, 162)`。单节点（相对 `{40, 60}`，卡片 248×63）就是 **328×162**。有分支时包住最外一张卡片，再留同样的边距。
- **框外按框的外缘留空，分组当整体，出度不加长。** 不要用组内步进贴着框。下一顶层盒子：竖向 `next.y = 本框 y + height + 90`，并相对框水平居中；沿 `LR` 流向 `next.x = 本框 x + width + 140`，并相对框垂直居中。两个互不连线的框：`TB` 顶对齐、间隙 **50**；`LR` 左对齐、间隙 **72**。两框矩形不要相交。
- 连到组内节点的边，label 中点落在**框外缘和下一张卡片之间**的空白里，不要落在框上。边仍连业务节点，不要连分组框。
- 批注不进组、不写 `parentNode`。放完分组后，批注的「最左 / 最上」把分组框外缘算进去。
- 不要用 `type: comment` 当分组框。不要给业务节点加 `isLayoutNode`。
- 一层即可，不要嵌套分组，除非用户明确要求。
- 背景必须写上，默认雾蓝 `#5b7c99`、透明度 **`0.06`**。多组可以换 `groupColor` 的色相，`groupOpacity` 仍用 `0.06`。不要省略透明度：控制台缺省是 `0.1`，会更深。不要低于 `0.04`。

## 边

**同一对 `source` + `target` 只能有一条边。** 多个出口接到同一个下游时，不要拆成两条边，把这些 relation 全部放进这一条的 `data.relations[]`。

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 建议 | `{source}_{target}` |
| `type` | 建议 | `"default"` |
| `source` | 是 | 源节点 `id` |
| `target` | 是 | 目标节点 `id` |
| `data.relations` | 是 | 数组，至少一项。接到**本 target** 的出口全部列在这里。**整份拷贝**源节点 `bundle node-relations` 里对应的对象，不要只写 `name` |
| `data.relations[].name` | 是 | 必须是源节点 `node-relations` 里出现过的名字；MCP / RelationCollection 自定义关系用条目映射出的 `name`（如 `tools/get_user`） |
| `data.relations[].label` | **建议** | 画布出口文字。Success 一般是 `成功`，Failure 一般是 `失败`。缺了控制台不显示连线文字 |
| `data.relations[].description` | 建议 | Tooltip；与目录一起拷贝 |
| `data.relations[].icon` | 视关系 | MCP 等自定义关系必拷（如 `mcp-tools` / `mcp-resources` / `mcp-prompts`）。目录没有 icon 的标准 Success/Failure 不要编造 |
| `data.relations[]._id` | 视关系 | 自定义关系（MCP Tools/Resources/Prompts、RelationCollection）必拷，用来把出口和图标绑到这条边 |
| `data.relations[].mcpKind` | 视关系 | MCP 自定义关系透传 `tools` / `resources` / `prompts` |
| `label` | 建议 | 边自身标签，固定 `""`（出口文字在 `relations[].label`） |
| `zIndex` | 建议 | `2000` |
| `sourceX` / `sourceY` / `targetX` / `targetY` | 否 | Vue Flow 锚点，生成时可省略（控制台会算） |

规则：

- **多个出口 → 同一下游**：一条边，`relations` 里放多项（如 Success + Failure 都接到下一节点）。这些 label 叠在同一条线的中点，把这条边按「画布排列」加长，不要拆边。
- **多个出口 → 不同下游**：每个 target 一条边，各自 `relations` 只含该支路的出口。目标放在下一层的不同列/行，让每条边的中点分开，label 才能对上自己那条线。
- 禁止两条边共用同一 `source` + `target`。
- 普通成功路径只用源节点目录里的成功项（通常 `name=Success`，`label=成功`）。

多个输出接到同一下游的边（控制台结构）：

```json
{
  "id": "n-k1V6QF1P_n-8aunB6B4",
  "type": "default",
  "source": "n-k1V6QF1P",
  "target": "n-8aunB6B4",
  "data": {
    "relations": [
      {
        "name": "Failure",
        "label": "失败",
        "description": "节点执行失败，消息路由到此链路"
      },
      {
        "name": "Success",
        "label": "成功",
        "description": "节点执行成功，消息路由到此链路"
      }
    ]
  },
  "label": "",
  "zIndex": 2000,
  "sourceX": 456.875,
  "sourceY": 990.875,
  "targetX": 456.875,
  "targetY": 1049.875
}
```

MCP / 动态出口：自定义关系还要写到**源节点** `data.relations`（与边上那份相同），否则画布左侧出口没有文字和图标。标准 Success/Failure 节点可以不写 `data.relations`，但**边上仍要带 label**。

MCP 自定义出口示例（源节点 `data.relations` 与边上都要同一份）：

```json
{
  "label": "获取用户信息",
  "name": "tools/get_user",
  "description": "获取用户的可用信息",
  "_id": "t-ozynvj4p",
  "mcpKind": "tools",
  "icon": "mcp-tools"
}
```

## 最小可运行例子

节点名、bundle 名、版本必须以当前环境的 CLI 输出为准。下面只说明形状；**真正生成时把 `n1` / `n2` 换成 `n-` + nanoid**（流程内唯一）。

```json
{
  "nodes": [
    {
      "id": "n1",
      "type": "default",
      "position": { "x": 45, "y": 24 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "WebhookTrigger",
        "bundleName": "official/core",
        "bundleVersion": "1.0.0",
        "isTrigger": true,
        "icon": "webhook.svg",
        "parameters": {},
        "label": "Webhook",
        "summary": "接收请求"
      }
    },
    {
      "id": "n2",
      "type": "default",
      "position": { "x": 45, "y": 177 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "JsFunctionNode",
        "bundleName": "official/core",
        "bundleVersion": "1.0.0",
        "icon": "code.svg",
        "parameters": { "code": "// 处理请求，返回成功标记\n// 入参：msg；出参：{ ok }\n\nreturn { ok: true };" },
        "label": "JS",
        "summary": "处理请求"
      }
    }
  ],
  "edges": [
    {
      "id": "n1_n2",
      "source": "n1",
      "target": "n2",
      "data": { "relations": [{ "name": "Success", "label": "成功", "description": "节点执行成功，消息路由到此链路" }] }
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "direction": "TB",
  "errors": {}
}
```

普通节点的输出在 payload 里包一层 `output`；触发器的 payload 在根级。占位名用 `msg`，不要用 `$json`。
**表达式按字段 `uiComponent` 写**：JSON（`JsonExpressionInput`）默认整字段 `"={{msg.xxx}}"` 以保留类型，要拼成字符串才写 `"=前缀 {{msg.xxx}}"`（禁止 `"this is ={{msg.title}}"`）；SQL（`SqlEditor`）用 `#{msg.xxx}` / `${msg.xxx}`；文本及其他用 `{{msg.xxx}}`。JS 节点 `code` 分段并加中文注释。见 [expressions.md](expressions.md)。

## 校验顺序

`buildify workflow validate` 按这个顺序报 `issues`。每次校验后把表单 ERROR 按节点 id 汇总写入画布顶层 `errors`：通过为 `{}`，未通过如 `"errors":{"n-k7mX2pL9":1}`。

顺序：

1. 结构（缺 `node.id` / `data.name` / `data.bundleName` / `data.bundleVersion` / 边的 source/target / relation.name）
2. 节点在当前工作区是否存在且可访问
3. `data.parameters` 对照 `properties_json`（未知键、缺必填、枚举非法）
4. `edges[].data.relations[].name` 对照源节点 `relations_json`
5. `data.credentials` 对照项目里已有凭证（`bundleName + type + name`）
6. 图：至少一个触发器、孤立节点、环
7. 展示：目录里有 `icon` 但画布 `data.icon` 为空时记 **WARNING**（控制台节点图标会丢）
8. 展示：边上 `relations[]` 缺 `label`（或自定义关系缺 `icon` / `_id`）时记 **WARNING**（控制台出口文字/图标会丢）

`level=ERROR` 必须修；`WARNING` 尽量修。`valid: false` 时 CLI 退出码为 4。
