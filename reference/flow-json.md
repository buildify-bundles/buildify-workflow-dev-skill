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

控制台工具栏只有两种：`TB` 竖向、`LR` 横向。编排时**必须写顶层 `direction`**。

**默认 `TB`。** 用户明确要求横排 / 横向 / 从左到右 / `LR` 时才用 `LR`。改已有流程时沿用草稿里的 `direction`，不要仅为换方向而重排，除非用户要求。

### 排版脚本（先连线，最后统一排）

坐标不要手算。写齐节点和边后运行：

```bash
node <skill 目录>/scripts/layout.mjs ./flow.json [--direction TB|LR] [--group <分组 id>] [-o out.json] [--check]
```

| 项 | 说明 |
|---|---|
| 依赖 | Node 18+。dagre 已内置在 `scripts/vendor/`，不用 `npm install` |
| 方向 | 默认读顶层 `direction`（缺省 `TB`）。传 `--direction` 时连顶层一起改 |
| 只排一个分组 | `--group <分组 id>` 对应控制台分组右键「自动排列组内节点」：只重排这个分组（含嵌套子分组）里的节点，框的左上角不动、宽高按内容重算；组外节点不动，外层分组装不下时只向右、向下放大。不能和改方向的 `--direction` 一起用 |
| 写什么 | 执行节点的 `position`、`sourcePosition` / `targetPosition`；分组框的 `position`、`style.width/height`；组内子节点相对框的 `position`；批注让开后的 `position`。缺 `errors` 时补 `{}` |
| 不写什么 | 不写 `dimensions`，也不给执行节点写 `width` / `height`（控制台按内容测量卡片） |
| 收尾 | 整图排版时，有顶层盒子落到 `x < 40` 或 `y < 24`（通常是批注）时，把所有顶层节点一起平移进来。`--group` 不做这一步 |
| 退出码 | 0 写好；1 只在 `--check` 时出现，表示坐标还不是自动排列结果；3 文件或图结构有错（边指向不存在的节点、连到分组框或批注、`parentNode` 不是分组框、id 重复、`--group` 指的不是分组框） |

脚本移植自控制台 `applyLayout.js`（Dagre 分层 + 扇出加层距 + 同层起点对齐 + 过宽扇出拆排 + 多段并排/货架折排 + 长链折行 + 分组包络 + 批注跟随）。卡片按 **248×63** 兜底；控制台里 `summary` 很长、卡片被撑宽时，用户再点「自动排列」会略有差异，属于正常现象。

**折行预算**：排版前按全图执行节点数（不算分组框、批注）估一个「铺成宽高比 **1.6** 时一段该有多长」的预算，外层和所有分组共用，所以各分组每段长度一致，拼起来整齐。预算有上下限：`TB` 一段 **6–12 行**，`LR` 一段 **5–9 列**。分组内每嵌套一层扣掉一次框的留白。

**长链折行**：同一段（彼此有边相连）排成一条后，长度超过预算的 **1.15 倍**才折，按层切成几段折回起点；横排超长换到下一行，竖排超长换到下一列，段间距 `TB` **160** / `LR` **120**。切点选在跨线最少的层间空隙，每段至少占预算的 40%，不会切出一两个节点的碎段。外层在预算允许的段数内选最接近 1.6 的段数，分组内严格按预算定段数。单条主链按默认卡片，`TB` 约 **7 张**起折、`LR` 约 **6 张**起折，节点越多每段越长。编排仍按线性主链写边即可，不要为折行拆边或手算折行坐标。

**过宽扇出拆排**：一个节点直接连出 **≥4** 个下游、而这一层又比预算宽时，把每个下游连同只属于它的后续节点当成一块，交错排进几排，排与排沿流向错开，后面的节点整体后移让位。单个节点扇出时，`TB` 约 **7 个**下游起拆、`LR` 约 **10 个**起拆。下游之间有交叉汇合、或这一层还混着别的节点时不拆。编排时照常从源节点各连一条边，不要为了拆排加中间节点。

**共用收尾节点**：一个节点没有自己的出边，且至少 **3** 个上游各自还有别的出边（主链继续走，旁支汇到同一个节点，例如各步失败都接到同一个「失败返回」），脚本会把它从 Dagre 里拿出来：主体先排、先折行，再把它放到主体尽头（`TB` 在下方，间距 **136**；`LR` 在右侧，间距 **170**），交叉轴对齐折行后的最后一段，多个这样的节点并排。放在整体中间会让前面几段的汇合线穿过末段的折返线。编排时就连到这一个节点，不要为了“线太长”复制多份，也不要手算它的坐标。普通汇合不算：上游只有通向它的这一条出边时，仍和主体一起排。不足 3 个这样的上游也不单拎出来。

排版只看边，执行节点的初始坐标不影响结果，可以不写。下面两种情况要给粗略的初始坐标：

- **批注**：写在被说明节点的外侧，脚本按「离它最近的节点」记偏移再贴回去。单段时触发器不写坐标（按 `{0,0}`），批注写 `TB` `{x: -(批注宽 + 24), y: 0}`、`LR` `{x: 0, y: -(批注高 + 24)}`。批注默认 320×220，就是 `{-344, 0}` / `{0, -244}`。把触发器放在 `nodes` 第一个。直接压在节点上也行，但脚本会把它挪到最近的空位（`TB` 往往是右侧）。
- **多段**：第 i 段（从 0 起）的所有顶层节点（自由节点、分组框）写同一个坐标，`TB` `{x: i*1000, y: 0}`、`LR` `{x: 0, y: i*1000}`。脚本按这个坐标决定段的先后，坐标相同时按 id 排。这段的批注相对同一个原点写：`TB` 放在段上方 `{x: i*1000, y: -(批注高 + 24)}`，`LR` 放在段左侧 `{x: -(批注宽 + 24), y: i*1000}`。

跑完可以用 `--check` 确认，之后不要再手动挪执行节点或改分组宽高。改了结构就重跑。

### 手算兜底（没有 Node 时）

脚本跑不了才照下面手算，规则与脚本相同。长链折行和过宽扇出拆排只能靠脚本，手算时保持一条主链 / 一排兄弟，不要自己折。执行节点按卡片 **宽 248、高 63** 占位，给每个执行节点写 `sourcePosition` / `targetPosition`，不要混用方向（例如 `direction: "LR"` 却竖着排）。

步进 = 该方向上的卡片边长 + 净空。同层沿流向对齐：`TB` 同一层 `y` 相同（顶齐），`LR` 同一层 `x` 相同（左齐）。分叉时父节点在交叉轴上居中盖住两侧子节点。画布第一张卡片从 `{ "x": 45, "y": 24 }` 起（自动排版的 `marginx` / `marginy`）。

| `direction` | 锚点 | 主链（这一层出度 1） | 同层兄弟（全图最大出度 ≤2） | 扇出 |
|---|---|---|---|---|
| `TB`（默认） | `sourcePosition: "bottom"`，`targetPosition: "top"` | 同一 `x`，`y += 153`（净空 **90**） | 同一 `y`，相邻 `x += 298`（净空 **50**） | 上一层有普通节点出度 **= 2**：下一层改为 `y += 183`（净空 **120**）。出度 **≥ 3**：下一层 `y += 199`（净空 **136**），兄弟改为 `x += 288`（净空 **40**） |
| `LR` | `sourcePosition: "right"`，`targetPosition: "left"` | 同一 `y`，`x += 388`（净空 **140**） | 同一 `x`，相邻 `y += 135`（净空 **72**） | 出度 **= 2** 不加长。出度 **≥ 3**：下一层改为 `x += 418`（净空 **170**），兄弟改为 `y += 119`（净空 **56**） |

一层里只要有一个普通节点达到上表扇出，**下一层整层**一起沿流向加长。这只作用于**同一段**（彼此有边相连的那一组）；互不连线的几段各自按本段扇出排，再按「多段并列」并排。分组框的出度不算。组内与画布共用这张表，不要另用更紧的组内步进。不要按一条边上有几个出口 label 再加长度，也不要把步进收到比上表更短。

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
- 不要交叉、不要穿过别的节点、不要让文字压在卡片上。**回连成环除外**：从下游出口接到上游入口时，节点仍按主链排，回连交给控制台绕线，不要为了消环拆边或把下游挪到上游旁边
- 能沿流向直连汇合、边不穿过别人时，再共用下游；否则各支路继续沿主方向排
- 分组框、批注不要写 `sourcePosition` / `targetPosition`。批注以及 `type: text` / `notes` 不参与层级排版，自动排版时跟随离它最近的节点（见「批注节点」）
- 批注和分组框各占一块矩形。框外节点、另一块分组、批注都按**矩形外缘**留空，不要用卡片步进去挨着框。见下文「批注节点」「节点分组」
- 两段及以上互不连线时，段内用上表步进，段与段之间按外接矩形错开。见下文「多段并列」

### 多段并列（互不连线的几段）

一段 = 从一个触发器出发、彼此有边相连的那一组。控制台自动排版对两段之间没有边的情况（例如两个独立接口）是**每段单独排**：段内层距只看本段扇出，再把各段按外接矩形沿交叉轴并排；并排过长时分成几排（货架折排），让整体接近宽高比 **1.6**，排与排间距同长链折行（`TB` **160** / `LR` **120**）。几种排法里优先选并排宽度不超过折行预算的那种，和长链折行的疏密一致。

**用脚本时**只需按「排版脚本」给每段一个粗略原点，段内层距、对齐、段间隙和是否折排都由脚本完成。下面是手算兜底（两段、不折排）：先各自按上表从局部原点排段内坐标，再整段平移。不要让一段的扇出去拉长另一段。

| `direction` | 各段对齐 | 下一段从哪开始 | 第一段原点 |
|---|---|---|---|
| `TB` | 顶对齐（各段外缘最上沿都在 `y = 24`） | `x = 上一段最右外缘 + 64` | 外缘左上角 `{45, 24}` |
| `LR` | 左对齐（各段外缘最左沿都在 `x = 45`） | `y = 上一段最下外缘 + 72` | 外缘左上角 `{45, 24}` |

外缘 = 这段里所有顶层盒子（卡片或分组框）的外接矩形。分组标题在框内，框的最上沿就是框 `y`。段的先后顺序按需求里的顺序；控制台重排时按各段当前最左（`TB`）/ 最上（`LR`）坐标排序。手算两段时按上表一排排开即可；三段及以上或某一段很高/很宽时，交给脚本货架折排，不要手算折到下一排的坐标。

`TB` 两段（左段两路分叉，右段从左段最右卡片右缘 `343 + 248` 再加 64）。右段没有扇出，第二张仍按普通层距 `24 + 153 = 177`：

```
[触发A] x=194 y=24                      [触发B] x=655 y=24
[处理A] x=45 y=207  [处理A2] x=343 y=207   [处理B] x=655 y=177
```

`LR` 同理：取上一段最下外缘，再 `+ 72`，下一段从 `x = 45` 起。

手算时段内坐标从局部原点 `(0, 0)` 起，不要再加 45/24，合并时一次性平移。边不要跨段。接口批注和分组在各段就位后再加，不要每段各贴一张。**多于两段**（三段及以上、段与段没有边）时，每段套一个分组框，段内坐标改成相对框的 `position` 并写 `parentNode`。两段并列默认不加分组。每个 HTTP 接口再加一张批注，见「批注节点」。

### 分支：必要时复制配置相同的节点

画布清晰优先于「少画一个节点」。两条支路都要做**同一件事**（同一 `data.name`、同一套 `parameters` / `credentials`），但共用一个节点会让边斜穿、交叉或绕行时：**每条支路各放一份**，不要强行汇合。

| 才复制 | 仍然共用 |
|---|---|
| 成功/失败（或多出口）各自收尾，例如各回一次 Webhook、各写一次库 | 线性流程，没有分叉 |
| 汇合边会穿过中间节点或和其他边交叉 | 支路沿流向正前方能干净接到同一个节点，边不穿过别人 |
| 为绕到共用节点必须斜线、回头、跨列 | 只是少画一个相同配置的节点 |

至少 3 个节点的旁支汇到同一个没有出边的收尾节点（如统一的失败返回）时保持共用，脚本会把它放到主体尽头，见上文「共用收尾节点」。

复制时：**重新抽一个 `n-` + nanoid** 作新 `id`（不要复用、不要 `n1`/`n2`）；`name` / `bundleName` / `bundleVersion` / `icon` / `label` / `parameters` / `credentials` 与原配置一致（支路本身不同的字段除外）；`summary` 仍 ≤8 字，可相同或略区分（如「成功返回」「失败返回」）。**不要复制触发器**，也不要无意义地复制整条链。

## 节点（执行相关）

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 是 | **`n-` + nanoid**（如 `n-k7mX2pL9`），本流程内唯一。边的 `source` / `target` 引用它。真正生成时不要用 `n1` / `trigger` 这类可读名 |
| `type` | 否 | Vue Flow 视觉类型，用 `"default"` |
| `position` | 脚本写 | `{ "x": number, "y": number }`。由 `scripts/layout.mjs` 计算，编排时可以不写（多段、批注的粗略初始坐标除外）。没有 Node 时按「手算兜底」 |
| `sourcePosition` | 脚本写 | 执行节点连线出口边。与 `direction` 一致：`TB` 用 `"bottom"`，`LR` 用 `"right"`。分组框/批注不要写 |
| `targetPosition` | 脚本写 | 执行节点连线入口边。与 `direction` 一致：`TB` 用 `"top"`，`LR` 用 `"left"`。分组框/批注不要写 |
| `data.name` | 是 | Bundle 节点 id = `@FlowNodeDescription.name`，例如 `JsFunctionNode` |
| `data.bundleName` | 是 | 逻辑名，与 `buildify bundle list` 的 `bundleName` 完全一致 |
| `data.bundleVersion` | 是 | 钉死的版本；用 `bundle nodes` 回显的 `bundleVersion`，不要写 `latest` |
| `data.parameters` | 视表单 | 对象，键必须出现在该节点 `properties_json` |
| `data.credentials` | 视表单 | 对象：`{ "<槽名>": { "type": "PascalCase", "name": "实例名" } }`。`type`/`name` 必须来自用户从 `project credentials` 点选的那条，禁止默认第一条或编造 |
| `data.icon` | **是** | 从 `bundle nodes`（或 `node-properties`）**该节点类型**的 `icon` 原样拷贝，是 `js.svg` 这种文件名，控制台靠它显示节点图标。按类型逐个查，不要凭名字猜、不要借别的节点或软件包本身的图标、不要写 URL。同一类型的节点（含复制出来的）图标必须相同 |
| `data.label` | 建议 | 从目录 `label` **原样拷贝**节点类型名（如「Webhook」「JavaScript」）。不要把本流程职责写到这里 |
| `data.summary` | **建议** | 画布**默认显示**此字段。写该节点在**本流程**中的职责，**≤8 字**。不要照抄目录通用 `summary`，也不要写路径、SQL、字段名 |
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

位置在被说明盒子外侧，避免和节点或分组框叠在一起，也不要挡住连线中点。

**用脚本时**按「排版脚本」写粗略初始坐标（单段 `TB` `{-(宽+24), 0}`、`LR` `{0, -(高+24)}`；多段相对各段原点），其余交给脚本：它记下批注相对最近节点的偏移，排完再贴回去，压到别的盒子时让开，最后把整张画布挪进 `x ≥ 40`、`y ≥ 24`。下面是手算兜底时的公式，脚本结果与它一致。

单段：`TB` 放最左外侧，`LR` 放最上外侧（公式见下）。多段（每段一张接口批注）：放在**不朝向相邻段**的一侧，避免盖住旁边那段。`TB` 各段左右排列，批注放在该段分组框（或该段卡片）**上方**，`y = 该段顶边 - 批注高 - 24`，`x` 与该段左缘对齐。`LR` 各段上下排列，批注放在该段**左侧**，`x = 该段左缘 - 批注宽 - 24`，`y` 与该段顶边对齐。

控制台自动排版（`applyLayout.js`）不把批注送进 Dagre：记下它相对**最近一个可排版节点**的偏移，排完主链后再贴回去；压到别的盒子上时，沿交叉轴（`TB` 左右、`LR` 上下）挪到最近的空位，净空 **24**（`DECORATION_GAP`）。所以批注要紧挨着它说明的那段放，不要放在两段之间。

批注矩形 = `position` 起、`style.width` × `style.height`（默认 **320×220**，与控制台新建批注一致；最小 180×50）。最左 / 最上取**顶层盒子外缘**：没有 `parentNode` 的节点用它的 `x` / `y`；分组用框的 `x` / `y`（标题在框内）。组内子节点已经在框里，不要拿子节点的绝对坐标当最左 / 最上。

- 单段 `TB`：放在最左外缘的左侧。`x = 最左外缘 - 批注宽 - 24`，`y` 与被说明盒子的顶边对齐。右缘和最左盒子之间空出 **24**
- 单段 `LR`：放在最上外缘的上方。`y = 最上外缘 - 批注高 - 24`，`x` 与被说明盒子的左缘对齐。底边和最上盒子之间空出 **24**

算出的批注 `x < 40` 或 `y < 24` 时，只把**顶层**节点（自由节点、分组框、批注）整体平移，使最靠外的批注落在 `x = 40` / `y = 24`。组内 `position` 是相对框的，不要跟着加这份平移。

`zIndex: 2`。不要写 `sourcePosition` / `targetPosition`，不要写 `parentNode`。无分支、主链 `x=45`、`y=24`、批注 320×220 时，先算出 `x = 45 - 320 - 24 = -299`，再把顶层整体右移，使批注落在 `{ "x": 40, "y": 24 }`，主链因此到 `x = 384`。字多把宽高加大后，用同一公式重算。

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
  "style": { "width": "320px", "height": "220px" },
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

分组框（父节点）是布局节点：`type: "group"`，`data.isLayoutNode: true`。`position` 和 `style` 宽高、组内子节点的相对坐标都由排版脚本算，编排时只写框的基础字段和子节点的 `parentNode`（多段时框写本段粗略原点）。**不要写** `bundleName` / `bundleVersion`，**不要出现在任何 `edges` 里**。组内业务节点照常写 `data.name` / `bundleName` / 参数，并连边。

| 字段 | 谁写 | 含义 |
|------|------|------|
| 分组框 `id` | 框 | **`n-` + nanoid**，流程内唯一 |
| 分组框 `type` | 框 | `"group"` |
| 分组框 `position` | 脚本写 | 画布绝对坐标（框的左上角，标题在框内） |
| 分组框 `style` | 脚本写 | `width` / `height`，由子节点包络加留白算出（手算见下文公式） |
| 分组框 `data.isLayoutNode` | 框 | `true`（解析器跳过） |
| 分组框 `data.name` / `label` | 框 | `"GroupNode"` / `"group"`。不要去 `bundle nodes` 里找这个名字 |
| 分组框 `data.summary` | 框 | 分区名，短词（如「上报」「查询」），与 `parameters.groupLabel` 相同 |
| 分组框 `parameters.groupColor` | 框 | 默认雾蓝 `"#5b7c99"`。多组可换色相，透明度不要跟着变 |
| 分组框 `parameters.groupOpacity` | 框 | **默认 `0.06`**（与控制台缺省一致）。合法 `0.04`–`0.72`。编排时仍显式写上 |
| 分组框 `parameters.groupRadius` | 框 | 默认 `12` |
| 分组框 `parameters.groupBorderStyle` | 框 | 默认 `"dashed"`（还可 `solid` / `dotted` / `none`） |
| 分组框 `parameters.groupBorderWidth` | 框 | 默认 `1`（`0.5`–`8`） |
| 分组框 `parameters.groupBorderColor` | 框 | **不写**。缺省时边框和标题跟随 `groupColor`，换底色一起变 |
| 子节点 `parentNode` | **组内每个组件必写** | 分组框的 `id`。不写就分不进去 |
| 子节点 `position` | 脚本写 | **相对**分组框左上角。默认留白：左/右 **24**，上 **68**（放框内标题），下 **24**；组内有回连时按绕线需要加宽 |
| 子节点 `extent` | 建议 | `"parent"`，拖动时留在框内 |

形状（子节点用 `parentNode` 挂到框上）：

```json
{
  "id": "2",
  "type": "group",
  "position": { "x": 45, "y": 24 },
  "style": { "width": "296px", "height": "155px" },
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
      "groupBorderStyle": "dashed",
      "groupBorderWidth": 1
    }
  }
}
```

```json
{
  "id": "2a",
  "data": { "label": "child node" },
  "position": { "x": 24, "y": 68 },
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
- **分组标题在框内左上角**，不占框外高度。框的最上沿就是框 `y`。
- 用脚本时下面几条都由脚本完成，跑完不要再改框的宽高或组内坐标。以下是手算兜底的规则。
- **组内步进与画布完全相同**（「画布排列」那张表，含扇出加长），只是原点换成框内。组内若有互不连线的几段，同样按「多段并列」并排（`TB` 间隙 64、`LR` 间隙 72）。坐标是相对框的，不要写成画布绝对坐标。
- **框的宽高与子节点位置**：先按组内步进从局部原点排好子节点，得到包络 `contentW × contentH`，再算 `width = max(contentW + 48, 240)`，`height = max(contentH + 92, 112)`。子节点整体放到相对框 `x = 24`、`y = 68` 起（内容比最小尺寸还小时在框内居中）。单节点就是 **296×155**，子节点在 `{24, 68}`；`TB` 主链两张（包络 248×216）是 **296×308**。
- **组内有回连**（下游连回上游）时，控制台要在框内给回环留绕线通道，留白会加宽：`TB` 回环走偏向的一侧（不偏时走右侧），那一侧留白至少 **82**，底边至少 **56**（顶边仍是 68）；`LR` 回环走底侧，底边留白至少 **82**，左右至少 **56**。多条回环重叠时每层再加 14。这种情况尽量用脚本。
- **组内折行**产生的换段连线（上一段末尾连到下一段开头）不算回环，走两段之间的空隙，不加宽侧边；只在两端节点贴着内容边缘时，把流向两端（`TB` 上下、`LR` 左右）的留白补到至少 **56**（`TB` 顶边仍是 68），免得连线穿出边框。
- **框外按框的外缘留空，分组当一个整体，它的出度不加长层距。** 不要用组内步进贴着框。
  - `TB`：框下方的下一顶层盒子 `next.y = 框 y + height + 90`，并相对框水平居中；框上方的上一盒子 `框 y = 上一盒子 y + 63 + 90`。同一层里分组框和普通卡片 `y` 相同（顶齐）。画布第一层就是分组时 `框 y = 24`。
  - `LR`：`next.x = 框 x + width + 140`，`框 x = 上一盒子 x + 248 + 140`。框与同层卡片按框体垂直居中。
  - 互不连线的几个框按「多段并列」：`TB` 框顶齐在 `y = 24`、间隙 **64**；`LR` 左齐、上一框底边到下一框顶边间隙 **72**（`下一框 y = 上一框 y + height + 72`）。两框矩形不要相交。
- 连到组内节点的边，label 中点落在**框外缘和下一张卡片之间**的空白里，不要落在框上。边仍连业务节点，不要连分组框。
- 批注不进组、不写 `parentNode`。放完分组后，批注的「最左 / 最上」把分组框外缘算进去。
- 不要用 `type: comment` 当分组框。不要给业务节点加 `isLayoutNode`。
- 一层即可，不要嵌套分组，除非用户明确要求。
- 背景写上默认雾蓝 `#5b7c99`、透明度 **`0.06`**。多组可以换 `groupColor` 的色相，`groupOpacity` 仍用 `0.06`，不要低于 `0.04`。

## 边

**同一对 `source` + `target` 只能有一条边。** 多个出口接到同一个下游时，不要拆成两条边，把这些 relation 全部放进这一条的 `data.relations[]`。

| 字段 | 必填 | 含义 |
|------|------|------|
| `id` | 是 | 固定 `{source}_{target}`。不要带出口名（`…_Success`），一对节点只有这一个 id |
| `type` | 建议 | `"default"` |
| `source` | 是 | 源节点 `id` |
| `target` | 是 | 目标节点 `id` |
| `data.relations` | 是 | 数组，至少一项。接到**本 target** 的出口全部列在这里。**整份拷贝**源节点 `bundle node-relations` 里对应的对象，不要只写 `name` |
| `data.relations[].name` | 是 | 必须是源节点 `node-relations` 里出现过的名字；MCP / RelationCollection 自定义关系用条目映射出的 `name`（如 `tools/get_user`） |
| `data.relations[].label` | 是 | 画布出口文字，用目录里的值（Success 一般 `成功`，Failure 一般 `失败`，IfNode 是 `是` / `否`）。缺了控制台不显示连线文字 |
| `data.relations[].description` | 否 | 出口说明（Tooltip）。可以拷目录里的，也可以改写成本流程里这条出口的含义（如「查不到也继续，卡片仍用 open_id 展示」） |
| `data.relations[].icon` | 视关系 | MCP 等自定义关系必拷（如 `mcp-tools` / `mcp-resources` / `mcp-prompts`）。目录没有 icon 的标准 Success/Failure 不要编造 |
| `data.relations[]._id` | 视关系 | 自定义关系（MCP Tools/Resources/Prompts、RelationCollection）必拷，用来把出口和图标绑到这条边 |
| `data.relations[].mcpKind` | 视关系 | MCP 自定义关系透传 `tools` / `resources` / `prompts` |
| `label` | 建议 | 边自身标签，固定 `""`（出口文字在 `relations[].label`） |
| `zIndex` | 建议 | `2000` |
| `sourceX` / `sourceY` / `targetX` / `targetY` | 否 | Vue Flow 锚点，生成时可省略（控制台会算） |

规则：

- **多个出口 → 同一下游**：一条边，`relations` 里放多项（如 Success + Failure 都接到下一节点）。出口文字由控制台摆放，不要拆边，也不要为此加长步进。
- **多个出口 → 不同下游**：每个 target 一条边，各自 `relations` 只含该支路的出口。目标放在下一层的不同列/行，让每条边的中点分开，label 才能对上自己那条线。
- 禁止两条边共用同一 `source` + `target`。
- 同一条边里每个出口 `name` 只写一次。
- 普通成功路径只用源节点目录里的成功项（通常 `name=Success`，`label=成功`）。

错误写法：按出口拆成两条边，id 带出口名，Failure 缺 `label`：

```json
[
  { "id": "n-get-sender_n-js-sender_Success", "source": "n-get-sender", "target": "n-js-sender",
    "data": { "relations": [{ "name": "Success", "label": "成功", "description": "查到员工" }] } },
  { "id": "n-get-sender_n-js-sender_Failure", "source": "n-get-sender", "target": "n-js-sender",
    "data": { "relations": [{ "name": "Failure" }] } }
]
```

正确写法：一条边，`id` 是 `{source}_{target}`，两个出口放进数组，每个都有 `name` 和 `label`（`description` 可选）：

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

写完用 `scripts/check.mjs` 检查，`--fix` 能把错误写法合并成正确写法（见下文「检查脚本」）。

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

节点名、bundle 名、版本必须以当前环境的 CLI 输出为准。下面只说明形状；**真正生成时把 `n1` / `n2` 换成 `n-` + nanoid**（流程内唯一）。`position` / `sourcePosition` / `targetPosition` 是跑完 `scripts/layout.mjs` 的结果，编排时可以先不写。

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
        "name": "WebhookTriggerNode",
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
        "icon": "js.svg",
        "parameters": { "code": "// 处理请求，返回成功标记\n// 入参：msg；出参：{ ok }\n\nreturn { ok: true };" },
        "label": "JavaScript",
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

普通节点的输出在 payload 里包一层 `output`；触发器的 payload 在根级。占位名用 `msg`，不要用 `$json`。参数里的表达式按字段 `uiComponent` 选语法，JS 节点 `code` 分段加中文注释，见 [expressions.md](expressions.md)。

## 校验顺序

`buildify workflow validate` 按这个顺序报 `issues`。每次校验后把表单 ERROR 按节点 id 汇总写入画布顶层 `errors`：通过为 `{}`，未通过如 `"errors":{"n-k7mX2pL9":1}`。

顺序：

1. 结构（缺 `node.id` / `data.name` / `data.bundleName` / `data.bundleVersion` / 边的 source/target / relation.name）
2. 节点在当前工作区是否存在且可访问
3. `data.parameters` 对照 `properties_json`（未知键、缺必填、枚举非法）
4. `edges[].data.relations[].name` 对照源节点 `relations_json`
5. `data.credentials` 对照项目里已有凭证（`bundleName + type + name`）
6. 图：至少一个触发器、孤立节点、环。**环允许**，不要当错误去拆边；编排时确认环上有离开循环的出口（见 SKILL「循环允许，但必须有出口」）。缺触发器和孤立节点仍要修
7. 展示：目录里有 `icon` 但画布 `data.icon` 为空时记 **WARNING**（控制台节点图标会丢）
8. 展示：边上 `relations[]` 缺 `label`（或自定义关系缺 `icon` / `_id`）时记 **WARNING**（控制台出口文字/图标会丢）

`level=ERROR` 必须修，**环除外**。`WARNING` 尽量修。只剩环时 `valid: false`、退出码 4 也可以 save-draft / 试跑 / 发布。

## 检查脚本

`workflow validate` 之前先跑 `scripts/check.mjs`，查边、出口和图标：

```bash
node <skill 目录>/scripts/check.mjs ./flow.json [--fetch [--profile NAME]] [--catalog FILE ...] [--fix] [-o out.json]
```

| 项 | 说明 |
|---|---|
| 目录 | `--fetch` 按画布里的 `bundleName` / `bundleVersion` 调 `bundle nodes`，按边的源节点调 `bundle node-relations`。离线时用 `--catalog` 传这两条命令保存下来的 `--json` 输出。都不给时只查结构、格式和同类一致性 |
| 边 | 同一对 `source` + `target` 只能一条；`id` = `{source}_{target}`；`data.relations` 是非空数组；出口 `name` 不重复、在目录里存在；每个出口有 `name` 和 `label`（`description` 不查）；边自身 `label` 为空 |
| 图标 | 执行节点必须有 `data.icon`，是图标文件名（不能是 URL、路径、emoji）；和目录里这个节点类型的 `icon` 一致；同一类型的节点图标相同。`label` 与目录不同、`isTrigger` 不对也会报 |
| `--fix` | 合并重复边（出口合进一个数组）、改正边 `id`、从目录补出口 `label`、图标、`isTrigger`，清空边自身 `label`。不动 `description`。目录里没有的出口名不改，仍报 ERROR |
| 退出码 | 0 没有 ERROR（可能有 WARNING）；1 还有 ERROR；3 文件、参数或拉目录失败 |

合并了重复边之后结构变了，再跑一次排版脚本。目录里两个类型共用一个图标是正常的（如 Webhook 触发器和 Webhook 应答都用 `webhook.svg`），脚本按类型对照，不会把这当错误。
