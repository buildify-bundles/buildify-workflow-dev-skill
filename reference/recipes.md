# 编排骨架

下面是形状示例，**节点 `name` / `bundleName` / `bundleVersion` / relation / 参数键必须用 CLI 向当前环境核实**：

```bash
buildify --json bundle list
buildify --json bundle nodes -b official/core
buildify --json bundle node-properties -b official/core -n WebhookTrigger
buildify --json bundle node-relations  -b official/core -n WebhookTrigger
```

若环境里没有 `official/core` 或节点名不同，换成 `bundle list` / `bundle nodes` **实际返回**的值，不要臆造。
当前工作区完全没有能覆盖需求的包或节点时：**不要用本文件的骨架硬编**，停下来请用户先用 `buildify-bundle-dev` 实现并发布，再回来编排。
示例里的 `icon: COPY_FROM_BUNDLE_NODES` 必须换成 `bundle nodes` / `node-properties` 返回的 `icon` 字符串（如 `webhook.svg`），否则控制台节点图标不正确。
`label` 从目录拷贝类型名；`summary` 按本流程职责自写且 **≤8 字**（画布默认显示它），不要照抄目录 `summary`。
默认按顶层 `direction` 排，节点按约 240×88 占位、同层对齐。**`TB` 竖排**：主链同一 x、`y += 160`（净空约 72），相邻列 `x` 相差 320（净空约 80）。**`LR` 横排**（用户要求或草稿已是横排）：主链同一 y、`x += 360`（净空约 120，出口文字是横的），相邻行 `y` 相差 160（净空约 72）。连线 label 在该边中点，中点要落在两卡片之间、并且只属于这一条边。一条边超过 2 个出口 label 时沿流向再加长。能直连汇合且中点彼此分开再共用下游；否则各支路沿主方向继续排，必要时复制配置相同的节点，避免连线交叉。执行节点写 `sourcePosition` / `targetPosition`，与 `direction` 一致。
边上的 `relations` 必须从 `node-relations` **整份拷贝**（至少 `name` + `label` + `description`）。**同一对 source+target 只有一条边**；接到同一下游的多个出口（如 Success+Failure）全部放进该边 `data.relations[]`，不要拆成两条边。MCP 自定义关系还要带 `_id` / `icon` / `mcpKind`，并写到源节点 `data.relations`。
参数里的表达式按 `uiComponent` 写（JSON 整段 `"=` + `{{ }}`，如 `"=this is title {{msg.title}}"`，禁止 `this is ={{msg.title}}`；SQL `#{}` `${}`；文本 `{{ }}`），见 [expressions.md](expressions.md)。JS 节点 `code` **分段 + 中文注释**，不要写成无注释单行。不要把 Webhook 响应当成一个叫 `body` 的字段。
**真正写入画布时，节点 `id` 用 `n-` + nanoid（如 `n-k7mX2pL9`，流程内唯一）**，不要照抄下面的 `trigger` / `work` / `reply`。顶层必写 `errors`（通过 `{}`，未通过 `"errors":{"n-k7mX2pL9":1}`）和 `direction`（默认 `"TB"`），见 [flow-json.md](flow-json.md)。下面骨架默认 `TB`；用户要横排时改成 `"direction": "LR"`，并按 [flow-json.md](flow-json.md)「画布排列」改坐标和锚点。

## 1. Webhook 触发 → 处理 → 应答

典型链路：入站 Webhook → JS/HTTP 处理 → Webhook 响应。

```json
{
  "nodes": [
    {
      "id": "trigger",
      "type": "default",
      "position": { "x": 480, "y": 80 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "WebhookTrigger",
        "label": "Webhook",
        "summary": "接收请求",
        "icon": "COPY_FROM_BUNDLE_NODES",
        "bundleName": "official/core",
        "bundleVersion": "REPLACE_ME",
        "isTrigger": true,
        "parameters": {}
      }
    },
    {
      "id": "work",
      "type": "default",
      "position": { "x": 480, "y": 240 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "JsFunctionNode",
        "label": "JS",
        "summary": "回显请求",
        "icon": "COPY_FROM_BUNDLE_NODES",
        "bundleName": "official/core",
        "bundleVersion": "REPLACE_ME",
        "parameters": {
          "code": "// 回显入站 Webhook，供下游应答使用\n// 入参：msg（触发器字段在根级）；出参：{ echo }\n\n// --- 1. 取入参 ---\nconst payload = msg; // 原样带回，方便对照请求\n\n// --- 2. 返回下游 ---\nreturn {\n  echo: payload\n};"
        }
      }
    },
    {
      "id": "reply",
      "type": "default",
      "position": { "x": 480, "y": 400 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "WebhookResponseNode",
        "label": "Webhook 响应",
        "summary": "返回结果",
        "icon": "COPY_FROM_BUNDLE_NODES",
        "bundleName": "official/core",
        "bundleVersion": "REPLACE_ME",
        "parameters": {
          "responseType": "custom",
          "outputType": "json",
          "jsonValue": "={{ msg.output }}",
          "options": { "responseStatusCode": 200 }
        }
      }
    }
  ],
  "edges": [
    {
      "id": "trigger_work",
      "source": "trigger",
      "target": "work",
      "data": { "relations": [{ "name": "Success", "label": "成功", "description": "节点执行成功，消息路由到此链路" }] }
    },
    {
      "id": "work_reply",
      "source": "work",
      "target": "reply",
      "data": { "relations": [{ "name": "Success", "label": "成功", "description": "节点执行成功，消息路由到此链路" }] }
    }
  ],
  "direction": "TB",
  "errors": {}
}
```

处理节点如果声明了凭证槽，先 `project credentials` 列出该类型，每个槽位请用户三选一：**使用已有** / **现在创建** / **使用时再选**。即使只有一条也不要直接写进 JSON。选了「使用已有」后再写：

```json
"credentials": {
  "credentialsId": { "type": "HttpBasicAuth", "name": "用户选定的实例名" }
}
```

`type` / `name` 必须能在 `buildify project credentials -p <proj>` 里找到。选了「使用时再选」则不写该槽，校验 ERROR 写入 `errors` 后只 save-draft，不要试跑。项目、流程与试跑服务器同样要用户点选（见 SKILL「必须用户点选」）。

`jsonValue` 是 `JsonExpressionInput`：`=` 必须在**整段字符串开头**。整对象注入用 `"={{ msg.output }}"`；混排用 `"=this is title {{msg.title}}"`，不要写成 `"this is ={{msg.title}}"`。若改成纯文本响应（`outputType: text`，字段 `textValue`），变量写成 `{{ msg.output.title }}`，不要套 JSON 的 `=` 前缀。

## 2. 定时 → 拉取 → 落库

```
ScheduleTrigger → HttpRequestNode → 写入节点（以实际 bundle 为准）
```

1. `bundle nodes` 找到定时触发器，确认 `isTrigger`；`label` 拷目录类型名
2. 每个节点写短 `summary`（≤8 字，画布默认显示），如「每小时触发」「拉取列表」「写入 MySQL」
3. HTTP 节点的 URL / method 以 `node-properties` 为准，不要抄本文件的字段名。URL 等文本字段用 `{{ msg.xxx }}`；请求体若是 `JsonExpressionInput`，字符串值整段以 `=` 开头、插值 `{{ msg.xxx }}`（如 `"=this is title {{msg.title}}"`）
4. 写入节点几乎一定要凭证：先 `project credentials` 列出名称，请用户选 **使用已有** / **现在创建** / **使用时再选**；不要猜实例名，也不要因为只有一条就默认绑定
5. `SqlEditor` 字段用 `#{msg.xxx}`（值）和 `${msg.xxx}`（表名/列名），**不要**写 `{{ }}` 或给 SQL 加 `=` 前缀：

```sql
SELECT * FROM ${msg.output.table}
WHERE id = #{msg.output.id}
```

坐标按 `direction`：默认 **`TB` 竖排**（主链 x=480，y=80 起每步 +160；分支同 y，相邻列 x 相差 320）。用户要横排或草稿已是 `LR` 时用 **`LR`**（主链 y=200，x=80 起每步 +360；分支同 x，相邻行 y 相差 160），并写 `sourcePosition` / `targetPosition`。不要把 `TB` 排成一条横线，也不要把 `LR` 排成一列竖线。沿流向不要再收：`TB` 的 `y` 步进不要小于 160，`LR` 的 `x` 步进不要小于 360，否则连线 label 会压在卡片上，看不出属于哪条边。
同一张画布上有**两段及以上互不连线**的流程（如两个独立接口）时，段内仍用上面的步进；段与段之间按外接矩形错开（`TB` 顶对齐、下一段 x = 上一段最右卡片右缘 + 80；`LR` 左对齐、下一段 y = 上一段最下卡片下缘 + 72）。见 [flow-json.md](flow-json.md)「多段并列」。
**多于两段**时，合并后再给每段加分组框（背景 `groupOpacity: 0.06`）。两段及以下默认不加分组。每个 HTTP 接口加一张批注，只写接口说明和访问地址。其余批注仍默认不加，仅当用户要求或分支/`summary` 写不下的关键约定不写会误用时才加。批注按自身宽高留在外侧（单段 `TB`：`x = 最左外缘 - 宽 - 80`；单段 `LR`：`y = 最上外缘 - 高 - 80`），外缘含分组框。分组时组内节点必须写 `parentNode`；框外节点按框外缘留空，不要用卡片步进贴着框。见 [flow-json.md](flow-json.md)。

HTTP 接口的入口验证优先用触发器「入站认证」`authType`（`none` / `httpBasic` / `apiKey` / `jwtAuth`）。表单没有该字段时，才在下游单独加校验节点。IP 限制写 `options.acl`。不要在触发器已经校验之后再加一个做同样事情的节点。

## 3. 分支：必要时复制节点

成功/失败接到**同一个**下游时，用**一条边**把两个 relation 都放进 `data.relations`（不要拆边）：

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
  "zIndex": 2000
}
```

成功/失败（或多出口）各自还要做同一件事、且接到**不同**下游时，**不要**把两边绕到同一个节点上交叉。每条支路复制一份相同配置的节点，沿主方向继续排；每条边的 `relations` 只含该支路的出口。

`TB` 竖排（判断在 y=80，下一层 y=240，列距 320，label 落在各自斜线中段）：

```
                 [判断]  x=480
                /      \
   [处理A] x=160       [处理B] x=800     ← 同 y
   [返回]  x=160       [返回]  x=800     ← 同一 Webhook 响应配置，两个 id
```

`LR` 横排（判断在 x=80，下一列 x=440，行距 160）：

```
[判断] y=200
   |          \
[处理A] y=40  [处理B] y=360     ← 同 x
[返回]  y=40  [返回]  y=360     ← 同一配置，两个 id
```

- 两份「返回」：`data.name` / `parameters` / `credentials` 相同，**各抽一个新 `n-` + nanoid** 作 `id`；`summary` 可写成「成功返回」「失败返回」
- 边只沿本列/本行走，不要斜穿到对面；每条边 `id`=`{source}_{target}`，`relations` 只含该支路出口
- 支路沿流向正前方能干净接到同一个节点、边不穿过别人时，仍共用：一条边，`relations` 里同时放 Success 和 Failure
- 不要复制触发器

## 4. 改已有流程

```bash
buildify --json flow get-draft -p "$PROJ" -w "$WF" > draft.json
# 取出 data.workflowJson 作为画布，改完后：
buildify --json flow validate -p "$PROJ" -f ./flow.json
buildify --json flow save-draft -p "$PROJ" -w "$WF" -f ./flow.json
```

不要从空模板覆盖已有草稿，除非用户明确要求重写。改节点职责时同步改 `data.summary`（仍 ≤8 字）。沿用草稿的 `direction`，不要仅为改排列而大挪已有节点；用户要求重排或改方向时再对齐。

## 5. 节点分组

**多于两段**互不连线的独立逻辑，或用户要求分组时：先放 `type: "group"` 的布局框，组内每个组件写 `parentNode` 指向框的 `id`。只重叠坐标不算分组。刚好两段默认不加框。组内留白，不要贴边：首节点 `{ "x": 48, "y": 72 }`；组内间距跟顶层 `direction`（`TB` 时 `y += 160`、相邻列 `x` 相差 320，`LR` 时 `x += 360`、相邻行 `y` 相差 160）。框宽高包住卡片再留边距：`width = max(child.x + 240) + 40`，`height = max(child.y + 88) + 40`（单节点 328×200）。框外下一节点按外缘留空：竖向 `框 y + height + 72`，横向 `框 x + width + 80`（`LR` 沿流向 +120）。不要用 `y += 160` 从框里的卡片接着排，否则会压进框里。

背景默认淡一点：`groupColor` `"#5b7c99"`，`groupOpacity` **`0.06`**（不要省略，省略时控制台按 0.1 画得更深）。多组可换色相，透明度仍用 0.06。

```json
{
  "id": "2",
  "type": "group",
  "position": { "x": 40, "y": 40 },
  "style": { "width": "328px", "height": "200px" },
  "data": {
    "name": "GroupNode",
    "label": "group",
    "summary": "上报",
    "isLayoutNode": true,
    "parameters": {
      "groupLabel": "上报",
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
  "position": { "x": 48, "y": 72 },
  "parentNode": "2"
}
```

真正写入时 `id` 换成 `n-` + nanoid；`2a` 补齐业务节点字段，建议 `"extent": "parent"`。边连业务节点，不连分组框。细则见 [flow-json.md](flow-json.md)「节点分组」。
