# 编排骨架

下面是形状示例，**节点 `name` / `bundleName` / `bundleVersion` / relation / 参数键必须用 CLI 向当前环境核实**：

```bash
buildify --json bundle list
buildify --json bundle nodes -b official/core
buildify --json bundle node-properties -b official/core -n WebhookTriggerNode
buildify --json bundle node-relations  -b official/core -n WebhookTriggerNode
```

照抄骨架前替换这些占位：

- `official/core`、节点名、`REPLACE_ME` 版本：换成 `bundle list` / `bundle nodes` **实际返回**的值。环境里根本没有能覆盖需求的包时，不要用骨架硬编，按 SKILL「环境里没有对应节点」先请用户在管理后台「开发中心 → 软件包」创建软件，再开发和发布，然后回来编排。
- `icon: COPY_FROM_BUNDLE_NODES`：换成目录返回的 `icon`（如 `webhook.svg`）。
- `trigger` / `work` / `reply` 这类 id：换成 `n-` + nanoid。
- 骨架默认 `TB`；横排时改 `"direction": "LR"`。
- 骨架里的 `position` / `sourcePosition` / `targetPosition` 只是示例值，以排版脚本的输出为准。

**先连线，最后统一排版**：写好节点和边（坐标可以不写），再跑一次脚本，然后进入校验：

```bash
node <skill 目录>/scripts/layout.mjs ./flow.json      # 写回坐标、锚点、分组尺寸
node <skill 目录>/scripts/check.mjs ./flow.json --fetch --fix   # 边、出口 name / label、图标对照目录
buildify --json workflow validate -p "$PROJ" -f ./flow.json
```

字段、排版、边的规则见 [flow-json.md](flow-json.md)，表达式见 [expressions.md](expressions.md)。不要把 Webhook 响应当成一个叫 `body` 的字段。

## 1. Webhook 触发 → 处理 → 应答

典型链路：入站 Webhook → JS/HTTP 处理 → Webhook 响应。

```json
{
  "nodes": [
    {
      "id": "trigger",
      "type": "default",
      "position": { "x": 45, "y": 24 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "WebhookTriggerNode",
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
      "position": { "x": 45, "y": 177 },
      "sourcePosition": "bottom",
      "targetPosition": "top",
      "data": {
        "name": "JsFunctionNode",
        "label": "JavaScript",
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
      "position": { "x": 45, "y": 330 },
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
          "jsonValue": "={{msg.output}}",
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

`type` / `name` 必须能在 `buildify project credentials -p <proj>` 里找到。选了「使用时再选」则不写该槽，见 SKILL「凭证」。

`jsonValue` 是 `JsonExpressionInput`：默认整字段 `"={{msg.output}}"`，对象原样注入、类型保留。要拼成字符串才写 `"=[{{msg.output.type}}] {{msg.output.title}}"`。`=` 必须是引号内第一个字符，不要写成 `"this is ={{msg.title}}"`，花括号里不要空格。若改成纯文本响应（`outputType: text`，字段 `textValue`），变量写成 `{{msg.output.title}}`，不要套 JSON 的 `=` 前缀。

## 2. 定时 → 拉取 → 落库

```
ScheduleTrigger → HttpRequestNode → 写入节点（以实际 bundle 为准）
```

1. `bundle nodes` 找到定时触发器，确认 `isTrigger`；`label` 拷目录类型名
2. 每个节点写短 `summary`（≤8 字，画布默认显示），如「每小时触发」「拉取列表」「写入 MySQL」
3. HTTP 节点的 URL / method 以 `node-properties` 为准，不要抄本文件的字段名。URL 等文本字段用 `{{msg.xxx}}`；请求体若是 `JsonExpressionInput`，默认 `"={{msg.output}}"` 保留类型，要拼成字符串才 `"=前缀 {{msg.xxx}}"`
4. 写入节点几乎一定要凭证：先 `project credentials` 列出名称，请用户选 **使用已有** / **现在创建** / **使用时再选**；不要猜实例名，也不要因为只有一条就默认绑定
5. `SqlEditor` 字段用 `#{msg.xxx}`（值）和 `${msg.xxx}`（表名/列名），**不要**写 `{{ }}` 或给 SQL 加 `=` 前缀：

```sql
SELECT * FROM ${msg.output.table}
WHERE id = #{msg.output.id}
```

坐标交给排版脚本，见 [flow-json.md](flow-json.md)「画布排列」。

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

排版脚本跑完的样子如下（手算兜底时也按这个写）。`TB` 竖排（判断在 y=24，下一层净空 120，兄弟净空 50；返回是出度 1，再走净空 90）：

```
                 [判断]  x=194 y=24
                /                    \
   [处理A] x=45 y=207       [处理B] x=343 y=207
   [返回]  x=45 y=360       [返回]  x=343 y=360     ← 同一 Webhook 响应配置，两个 id
```

`LR` 横排（判断在 x=45，下一列净空 140，兄弟净空 72）：

```
[判断] x=45 y=92
   |                    \
[处理A] x=433 y=24    [处理B] x=433 y=159
[返回]  x=821 y=24    [返回]  x=821 y=159     ← 同一配置，两个 id
```

- 两份「返回」：`data.name` / `parameters` / `credentials` 相同，**各抽一个新 `n-` + nanoid** 作 `id`；`summary` 可写成「成功返回」「失败返回」
- 边只沿本列/本行走，不要斜穿到对面；每条边 `id`=`{source}_{target}`，`relations` 只含该支路出口
- 支路沿流向正前方能干净接到同一个节点、边不穿过别人时，仍共用：一条边，`relations` 里同时放 Success 和 Failure
- 不要复制触发器

## 4. 改已有流程

```bash
buildify --json workflow get-draft -p "$PROJ" -w "$WF" > draft.json
# 取出 data.workflowJson 作为画布 flow.json，改完后：
node <skill 目录>/scripts/layout.mjs ./flow.json   # 只在增删了节点/边或用户要求重排时
# 只动了某个分组里的节点：node <skill 目录>/scripts/layout.mjs ./flow.json --group <分组 id>
node <skill 目录>/scripts/check.mjs ./flow.json --fetch --fix
buildify --json workflow validate -p "$PROJ" -f ./flow.json
buildify --json workflow save-draft -p "$PROJ" -w "$WF" -f ./flow.json
```

不要从空模板覆盖已有草稿，除非用户明确要求重写。改节点职责时同步改 `data.summary`（仍 ≤8 字）。沿用草稿的 `direction`。排版脚本会按自动排列重排整张画布，所以只在增删了节点 / 边、或用户要求重排 / 改方向（`--direction`）时跑，并告诉用户；用户手动调过布局时先问。只改参数不要跑。

## 5. 节点分组

多于两段互不连线的独立逻辑，或用户要求分组时才加。只写分组框的基础字段和组内节点的 `parentNode`，框的位置、宽高（标题在框内，上留白 68，组内回连自动加宽）和组内坐标交给排版脚本。字段形状见 [flow-json.md](flow-json.md)「节点分组」，不要在这里另抄一份。

三段各一个框时，第 i 段的框写粗略原点 `TB` `{x: i*1000, y: 0}`（`LR` `{x: 0, y: i*1000}`），子节点不写坐标，跑完脚本即可：

```json
{ "id": "n-Gq3aT9xK", "type": "group", "position": { "x": 1000, "y": 0 },
  "data": { "name": "GroupNode", "label": "group", "summary": "查询", "isLayoutNode": true,
            "parameters": { "groupLabel": "查询", "groupColor": "#5b7c99", "groupOpacity": 0.06,
                            "groupRadius": 12, "groupBorderStyle": "dashed", "groupBorderWidth": 1 } } }
```
