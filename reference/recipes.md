# 编排骨架（spec）

下面是 `scripts/build.mjs` 的 spec 示例。**节点 `bundle` / `name`、参数键和出口名必须是当前环境 `catalog.mjs fetch` 实际返回的**，build 会对照目录核对，对不上就报 ERROR。环境里根本没有能覆盖需求的包时，不要用骨架硬编，按 [missing-bundle.md](missing-bundle.md) 处理。

```bash
S=<skill 目录>/scripts
node $S/catalog.mjs fetch -b buildify/core -n SchedulerNode,HttpRequestNode,JsFunctionNode -b buildify/dingtalk-bot -n SendMarkdownMsgNode
node $S/build.mjs spec.json -o flow.json
node $S/check.mjs flow.json --catalog-dir /tmp/buildify-catalog --fetch
```

spec 规则：

- 节点：`key`（spec 内引用）、`bundle`（可写 `包名@版本`）、`name`、`summary`（≤8 字）、`parameters`（只写要改的键，默认值脚本补）、`credentials`、`parent`（分组 key）、`disabled`。
- 边：`["from", "to"]` 默认出口 `Success`；`["from", "to", "Failure"]`；多个出口接同一下游写 `"Success,Failure"`；要改出口说明用对象 `{ "from", "to", "out", "description": { "Failure": "…" } }`。
- 分组框 `{ "key", "group": "模块名" }`；批注 `{ "key", "comment": "正文", "width": 480 }`（只在用户要求时加）。
- 不写 id、坐标、图标、label、出口对象，脚本都会补。分组只写 `group` 标题，不写颜色和边框。

## 1. 定时 → 拉取 → 推送，失败告警

```json
{
  "direction": "TB",
  "nodes": [
    { "key": "cron", "bundle": "buildify/core", "name": "SchedulerNode", "summary": "每天8点",
      "parameters": { "zoneId": "Asia/Shanghai", "triggerType": "daily", "triggerHours": 8, "triggerMinutes": 0 } },
    { "key": "http", "bundle": "buildify/core", "name": "HttpRequestNode", "summary": "拉取预报",
      "parameters": { "url": "https://api.open-meteo.com/v1/forecast?latitude=39.90&longitude=116.41&daily=weather_code" } },
    { "key": "fmt", "bundle": "buildify/core", "name": "JsFunctionNode", "summary": "组装日报",
      "parameters": { "code": "// 组装钉钉日报\n// 入参：msg.output.body.daily；出参：{ title, text }\n\n// --- 1. 返回下游 ---\nreturn { title: '北京天气', text: JSON.stringify(msg.output.body.daily) };" } },
    { "key": "send", "bundle": "buildify/dingtalk-bot", "name": "SendMarkdownMsgNode", "summary": "发送日报",
      "parameters": { "title": "={{msg.title}}", "text": "={{msg.text}}" },
      "credentials": { "credentialsId": { "type": "DingTalkBotCredentials", "name": "用户点选的实例名" } } },
    { "key": "alarm", "bundle": "buildify/core", "name": "JsFunctionNode", "summary": "组装告警",
      "parameters": { "code": "// 接口失败时拼告警\n// 入参：msg.error；出参：{ title, text }\n\n// --- 1. 返回下游 ---\nreturn { title: '天气接口失败', text: msg.error.code + '：' + msg.error.message };" } },
    { "key": "send-alarm", "bundle": "buildify/dingtalk-bot", "name": "SendMarkdownMsgNode", "summary": "失败通知",
      "parameters": { "title": "={{msg.title}}", "text": "={{msg.text}}" },
      "credentials": { "credentialsId": { "type": "DingTalkBotCredentials", "name": "用户点选的实例名" } } }
  ],
  "edges": [
    ["cron", "http"],
    ["http", "fmt"],
    ["fmt", "send"],
    { "from": "http", "to": "alarm", "out": "Failure", "description": { "Failure": "天气接口失败时告警" } },
    ["alarm", "send-alarm"]
  ]
}
```

- HTTP 节点的结果在 `msg.output`（`statusCode` / `headers` / `body`）。JS 节点的返回值就是下游的整个 `msg`，所以钉钉节点写 `={{msg.title}}`。
- 失败分支的渠道以用户点名为准，见 SKILL「通知与失败告警」。凭证 `name` 必须是用户从 `project credentials` 点选的，不要因为只有一条就默认写上。
- 写入数据库的节点（如 MySQL）`SqlEditor` 字段用 `#{msg.xxx}`（值）和 `${msg.xxx}`（表名 / 列名），不要写 `{{ }}` 或 `=` 前缀，见 [expressions.md](expressions.md)。

## 2. Webhook → 校验 → 处理 → 应答

```json
{
  "nodes": [
    { "key": "hook", "bundle": "buildify/core", "name": "WebhookTriggerNode", "summary": "接收请求",
      "parameters": { "path": "/orders/:id", "methods": ["GET"], "responseMode": "WebhookNode",
        "options": { "cors": { "enabled": false, "allowedOrigins": "*", "allowedMethods": ["GET"] } } } },
    { "key": "check", "bundle": "buildify/core", "name": "ValidateNode", "summary": "校验参数",
      "parameters": { "configType": "rules", "rules": [
        { "field": "pathParams.id", "check": "required" },
        { "field": "pathParams.id", "check": "pattern", "pattern": "^\\d{1,20}$" }
      ] } },
    { "key": "work", "bundle": "buildify/core", "name": "JsFunctionNode", "summary": "查询订单",
      "parameters": { "code": "// 按路径参数组装返回\n// 入参：msg.pathParams.id（已校验）；出参：{ code, data }\n\n// --- 1. 返回下游 ---\nreturn { code: 200, data: { id: msg.pathParams.id } };" } },
    { "key": "reply", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "返回结果",
      "parameters": { "responseType": "custom", "outputType": "json", "jsonValue": "={{msg}}" } },
    { "key": "bad", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "参数错误",
      "parameters": { "responseType": "custom", "outputType": "json",
        "jsonValue": { "code": 400, "msg": "参数不合法", "errors": "={{msg.output.errors}}" },
        "options": { "responseStatusCode": 400 } } }
  ],
  "edges": [["hook", "check"], ["check", "bad", "Invalid"], ["check", "work"], ["work", "reply"]]
}
```

- 默认先校验再处理，`Invalid` 出口返回 400，不往下访问资源（见 SKILL「HTTP 接口」）。规则只写下游用到的字段；多个字段、多项约束时也可以 `configType: "json"` 写 `schema`。
- 一个触发器只勾一个方法。同一资源还要 POST（如创建订单）时另起一段或另建一条流程，见第 5 节，不要在这里按 `msg.method` 分流。
- 默认不开跨域，但 `options.cors` 是必填块仍要写，`allowedMethods` 与 `methods` 一致；要开时的写法见 SKILL「HTTP 接口」。
- 认证先用触发器的 `authType`（见 SKILL「HTTP 接口」），开了认证再按凭证三选一绑对应的槽（`httpBasicAuth` / `apiKey` / `jwtAuth`）。
- `jsonValue` 是 `JsonExpressionInput`：整字段 `"={{msg.xxx}}"` 保留类型，要拼字符串才写 `"=[{{msg.type}}] {{msg.title}}"`。改成纯文本响应（`outputType: text`，字段 `textValue`）时变量写 `{{msg.title}}`。
- 试跑前先测访问地址，见 [http.md](http.md)。

## 3. 条件分支：必要时复制节点

```json
{
  "nodes": [
    { "key": "hook", "bundle": "buildify/core", "name": "WebhookTriggerNode", "summary": "接收请求",
      "parameters": { "path": "/check", "methods": ["POST"],
        "options": { "cors": { "enabled": false, "allowedOrigins": "*", "allowedMethods": ["POST"] } } } },
    { "key": "if", "bundle": "buildify/core", "name": "IfNode", "summary": "金额超限",
      "parameters": { "type": "expression", "expression": "msg.body.amount > 1000" } },
    { "key": "ok", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "通过返回",
      "parameters": { "responseType": "custom", "outputType": "json", "jsonValue": { "pass": true } } },
    { "key": "no", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "拒绝返回",
      "parameters": { "responseType": "custom", "outputType": "json", "jsonValue": { "pass": false } } }
  ],
  "edges": [["hook", "if"], ["if", "no", "True"], ["if", "ok", "False,Failure"]]
}
```

- IfNode 的出口是 `True` / `False` / `Failure`（label「是」/「否」/「失败」），`BooleanExpressionInput` 直接写 SpEL，不要 `{{ }}` 和 `=` 前缀。
- 两条支路都要应答时各放一个 `WebhookResponseNode`（两个 key），不要把两边绕到同一个节点上交叉。支路沿流向正前方能干净接到同一个节点时才共用，一条边里同时放多个出口。
- 想让某个出口的分支在左（`TB`）或上（`LR`），就把它的边写在前面。

## 4. 改已有流程

```bash
buildify --json workflow get-draft -p "$PROJ" -w "$WF" > draft.json
node $S/build.mjs edit.json --base draft.json -o flow.json --fetch      # 只改参数时加 --no-layout
node $S/check.mjs flow.json --catalog-dir /tmp/buildify-catalog --fetch
buildify --json workflow validate -p "$PROJ" -f flow.json > validate.json
node $S/result.mjs validate validate.json --flow flow.json --write-errors
buildify --json workflow save-draft -p "$PROJ" -w "$WF" -f flow.json
```

```json
{
  "nodes": [
    { "id": "n-qvsX4Sqs", "summary": "拉取预报", "parameters": { "timeout": 20 } },
    { "key": "wait", "bundle": "buildify/core", "name": "WaitNode", "summary": "稍等" }
  ],
  "edges": [["n-SxlNqYfG", "wait"], ["wait", "n-3gxcv7wx"]],
  "remove": ["n-SxlNqYfG_n-3gxcv7wx"]
}
```

只改参数（id 不变）：

```json
{ "id": "n-qvsX4Sqs", "summary": "拉取预报", "parameters": { "timeout": 20 } }
```

切换节点类型（换新 id，边跟着改；不要写 `remove`）：

```json
{
  "nodes": [
    { "id": "n-qvsX4Sqs", "bundle": "buildify/core", "name": "JsFunctionNode", "summary": "组装报文",
      "parameters": { "code": "// 入参：msg\n// 出参：下游整个 msg\n\n// --- 1. 返回 ---\nreturn msg;" } }
  ]
}
```

- `{ "id": 旧 id, … }` **不写 `name`**（或 `name`+包名与画布相同）：改这个节点，`parameters` 按键合并，`summary` / `credentials` / `parent` 覆盖，**旧 id 不变**。
- `{ "id": 旧 id, "bundle", "name": 新类型, … }`：`name` 或包名与画布不同时是**切换类型**。build 分配新的 `n-` id、按新类型表单重建 `data`（不合并旧参数），入边/出边改到新 id；旧 id 仍可写在边和 `parent` 里，会解析到新节点。切换后出边里新类型没有的出口会删掉，某条边一个出口都不剩就 ERROR——在 `edges` 里用旧 id 写上新出口即可。不要用 `remove` 再另起 key（那样边不会自动接上）。
- `remove` 一颗执行节点，又用新 key 建同 `name`、同包名的节点：ERROR，不写文件。类型没变就把旧 id 写到节点上。删掉一颗、同时新增另一颗同类型，同样 ERROR，分成两次 spec。
- 边两端可以写新节点的 key，也可以写旧节点 id。`remove` 写确实不要的旧节点 id（连同它的边一起删）或旧边 id。上面插入 WaitNode 的例子就是在两个节点之间插入一个节点，删的是边，不是同类型节点。
- `--base` 直接吃 `get-draft` 的整份响应。`--fetch` 会补拉草稿里已有节点的目录。
- 替换或重写整条流程也用 `--base`，能对上且类型没变的节点写旧 id。不要用空 spec 覆盖已有草稿。改节点职责时同步改 `summary`。沿用草稿的 `direction`；build 会整图重排，只改参数时加 `--no-layout`；用户手动调过布局时先问。
- 用户要看某一历史版本时用 `workflow get-version`，确认恢复后把那份 `workflowJson` 当 `--base` 走同样的流程。

## 5. 分组与多段

默认不分组；特别复杂的流程按功能模块分组（见 SKILL「生成画布」）。互不连线的几段（如两个独立接口）不用写坐标，build 按 spec 里的先后自动排开。

```json
{
  "nodes": [
    { "key": "g-query", "group": "查询" },
    { "key": "q-hook", "parent": "g-query", "bundle": "buildify/core", "name": "WebhookTriggerNode", "summary": "查询请求",
      "parameters": { "path": "/orders", "methods": ["GET"],
        "options": { "cors": { "enabled": false, "allowedOrigins": "*", "allowedMethods": ["GET"] } } } },
    { "key": "q-reply", "parent": "g-query", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "返回订单" },
    { "key": "g-refund", "group": "退款" },
    { "key": "r-hook", "parent": "g-refund", "bundle": "buildify/core", "name": "WebhookTriggerNode", "summary": "退款请求",
      "parameters": { "path": "/refund", "methods": ["POST"],
        "options": { "cors": { "enabled": false, "allowedOrigins": "*", "allowedMethods": ["POST"] } } } },
    { "key": "r-reply", "parent": "g-refund", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "返回结果" }
  ],
  "edges": [["q-hook", "q-reply"], ["r-hook", "r-reply"]]
}
```

- 一个模块一个框，组内每个节点写 `parent`；模块之间照常连边，可以跨框。分支跟着所在模块，不要再加框。
- 不要顺手给每个框加说明批注，用户要求时才加（见 [comment-node.md](comment-node.md)）。

## 6. 事务与幂等：下单扣库存

`POST /orders`：校验 → 一个事务里扣库存并建订单 → 按订单号回查 → 应答。规则见 SKILL「数据一致性与事务」。

```json
{
  "nodes": [
    { "key": "hook", "bundle": "buildify/core", "name": "WebhookTriggerNode", "summary": "下单请求",
      "parameters": { "path": "/orders", "methods": ["POST"], "responseMode": "WebhookNode",
        "options": { "cors": { "enabled": false, "allowedOrigins": "*", "allowedMethods": ["POST"] } } } },
    { "key": "check", "bundle": "buildify/core", "name": "ValidateNode", "summary": "校验参数",
      "parameters": { "configType": "json", "schema": {
        "body.orderNo": { "required": true, "type": "string", "pattern": "^[A-Za-z0-9_-]{1,32}$" },
        "body.skuId": { "required": true, "type": "integer" },
        "body.qty": { "required": true, "type": "integer", "min": 1, "max": 999 }
      } } },
    { "key": "bad", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "参数错误",
      "parameters": { "responseType": "custom", "outputType": "json",
        "jsonValue": { "code": 400, "msg": "参数不合法", "errors": "={{msg.output.errors}}" },
        "options": { "responseStatusCode": 400 } } },
    { "key": "tx", "bundle": "buildify/mysql", "name": "TransactionExecuteNode", "summary": "扣库存建单",
      "credentials": { "credentialsId": { "type": "MySQLCredentials", "name": "用户点选的实例名" } },
      "parameters": { "steps": [
        { "sql": "UPDATE stock SET qty = qty - #{msg.body.qty}\nWHERE sku_id = #{msg.body.skuId} AND qty >= #{msg.body.qty}\n  AND NOT EXISTS (SELECT 1 FROM orders WHERE order_no = #{msg.body.orderNo})" },
        { "sql": "INSERT INTO orders (order_no, sku_id, qty, status)\nSELECT #{msg.body.orderNo}, #{msg.body.skuId}, #{msg.body.qty}, 'created' FROM DUAL\nWHERE ROW_COUNT() > 0" }
      ] } },
    { "key": "txFail", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "下单失败",
      "parameters": { "responseType": "custom", "outputType": "json",
        "jsonValue": { "code": 500, "msg": "下单失败，请稍后重试" },
        "options": { "responseStatusCode": 500 } } },
    { "key": "find", "bundle": "buildify/mysql", "name": "ExecuteSqlNode", "summary": "回查订单",
      "credentials": { "credentialsId": { "type": "MySQLCredentials", "name": "用户点选的实例名" } },
      "parameters": { "sql": "SELECT order_no, sku_id, qty, status FROM orders WHERE order_no = #{msg.body.orderNo}" } },
    { "key": "exists", "bundle": "buildify/core", "name": "IfNode", "summary": "订单已建",
      "parameters": { "type": "expression", "expression": "msg.output.rowCount > 0" } },
    { "key": "ok", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "返回订单",
      "parameters": { "responseType": "custom", "outputType": "json",
        "jsonValue": { "code": 200, "data": "={{msg.output.data}}" } } },
    { "key": "noStock", "bundle": "buildify/core", "name": "WebhookResponseNode", "summary": "库存不足",
      "parameters": { "responseType": "custom", "outputType": "json",
        "jsonValue": { "code": 409, "msg": "库存不足" },
        "options": { "responseStatusCode": 409 } } }
  ],
  "edges": [
    ["hook", "check"], ["check", "bad", "Invalid"], ["check", "tx"],
    ["tx", "txFail", "Failure"], ["tx", "find"], ["find", "exists"],
    ["exists", "ok", "True"], ["exists", "noStock", "False"]
  ]
}
```

- **两步在同一个事务里，任何一步 SQL 报错都整体回滚**（如 `order_no` 唯一索引冲突）。库存不够或订单号已存在时，第一步影响 0 行不算错误，第二步靠 `ROW_COUNT() > 0` 跟着不插入，数据不变。
- **幂等**：同一订单号重复请求时第一步不再扣库存，回查能查到已有订单，直接返回 200。`orders.order_no` 要有唯一索引兜住并发重复，冲突时走 `Failure`，客户端重试会拿到已有订单。
- 事务后的结果以回查为准，不要依赖事务节点的输出判断建单成没成。`find` 的 `Failure` 和 `exists` 的 `Failure` 按流程已有的失败处理接（这里省略）。
- 扣库存、建单之外还要调支付等外部系统时，外部调用放在事务之后，按 SKILL「跨系统」先记状态再调用。
- 汇报「数据一致性」一行：事务范围是扣库存和建单，幂等键 `order_no`，失败返回 500 且不改数据。
