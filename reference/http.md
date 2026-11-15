# HTTP 接口：编排规则、访问地址与试跑

入口是 Webhook 触发器或渠道回调触发器时读这份。

## 用 http 宏写入口

spec 里写一条 `http` 宏（格式见 `build.mjs --help`），build 展开成「Webhook 触发器 + ValidateNode + Invalid 出口的 400 应答 + 统一的 500 应答」，下面的默认规则由脚本保证，不用自己逐个字段写：

```json
{ "key": "api", "http": { "method": "GET", "path": "/orders/:id",
    "validate": ["pathParams.id", ["pathParams.id", "pattern", "^\\d{1,20}$"]] } }
```

之后的边从 `api` 出发就接在校验通过之后（`["api", "work"]`）。只有宏表达不了的入口（渠道回调触发器、一个触发器多个方法）才手写触发器节点。

**每条路都要走到应答。** 响应模式是「Webhook 节点响应」时，引擎挂起连接等下游写回；哪条路走不到 `WebhookResponseNode`，调用方就挂到触发器 `timeout`（默认 5000 毫秒）再收到 504。宏默认把这条接口上没接的 `Failure`（校验规则写错、查库失败、JS 抛错等）都接到一个 500 应答，正文是 `{ "code": 500, "message": "服务异常，请稍后重试" }`，要改写 `"onError": { …正文 }`；某个 Failure 要单独处理（如返回 409）就自己写那条边，宏不会覆盖。If / Switch 的分支等其他出口要自己接到对应应答，没接 build 会报 WARNING。不要把 `msg.error.message` 原样返回给调用方。

## 默认规则

**一个方法一条流程。** `method` 只写一个。需求里同时有查询（GET）和提交（POST）时写两个宏，各自校验、各自应答：可以是同一张画布的两段，也可以是两条流程。不要在一个触发器里勾 `GET` + `POST` 再按 `msg.method` 分流。只有用户明确要求、或协议本身要求同一地址支持多个方法（如渠道回调用 GET 验证地址、POST 推送消息）时才合在一起，并在汇报里写明原因。

**默认不开跨域。** 宏不写 `cors` 就是关闭。用户明确要求时才写 `"cors": { "allowedOrigins": "https://a.com" }`：

- `allowedOrigins` 写用户给的具体域名，每行一个；没给就和其他缺口放在同一次提问里问，不要填 `*`。
- `allowCredentials` 默认 `false`，要带 Cookie 才开，开了 `allowedOrigins` 就不能是 `*`。
- `allowedHeaders` 只写前端实际会发的 Header（开了认证就加 `Authorization` 或 API Key 的 Header 名）。
- 汇报里开了才写一行允许的来源，没开不提。

**认证先用触发器已有的方式**，写宏的 `auth`，凭证写在宏节点的 `credentials`，不要在下游再验一遍：

| `auth` | 凭证槽 | 何时 |
|---|---|---|
| `none` | 无 | 用户没要求校验，或内网 / 网关已经鉴权 |
| `httpBasic` | `httpBasicAuth`（HttpBasicAuth） | HTTP Basic |
| `apiKey` | `apiKey`（HeaderAuth） | 自定义 Header，含固定 Token、签名放在某个 Header 里但**不依赖原始报文体** |
| `jwtAuth` | `jwtAuth`（JwtAuth） | `Authorization: Bearer` |

按 IP 限制访问写 `"parameters": { "options": { "acl": … } }`，不要再单做一段 IP 判断。开了认证后凭证槽仍按三选一，不要自己挑一条。

**对不上表里的方式，再另做处理。** 微信支付、支付宝、Stripe 这类要按原始报文体验签的回调，`WebhookTriggerNode` 拿不到原始字节，不要写成 `apiKey` / `jwtAuth`，也不要在后面串验签节点。先找这个渠道自己的回调触发器；没有就按「环境里没有对应节点」做一个**触发器**（要求见 [missing-bundle.md](missing-bundle.md)「验签回调」）。选了「处理完再返回」时，Success 末端接核心包的 `WebhookResponseNode`。表单里没有 `authType`、需求也对不上上表、又不是原文验签时，才在触发器下游加一个真实存在的校验节点。

**默认校验入参，不合法不往下走。** 读库、调外部接口、改数据之前先校验，只校验下游真正用到的字段：

- 字段路径不加 `msg.`：路径参数 `pathParams.id`、查询 `query.page`、请求体 `body.userId`。同一字段按「必填 → 类型 → 格式 / 范围」写多条，如 id 用 `pattern` 限成数字或 UUID、分页大小 `max` 封顶、状态用 `oneOf` 限定取值。可选字段加 `{ "skipIfMissing": true }`，必填不要加。
- 400 应答正文带 `msg.output.errors`（每项有 `field`、`check`、`code`、`message`）。校验节点的 `Failure` 是规则本身写错（如正则不合法），宏把它接到 500 应答，不要当成 400。
- 下游照旧从 `msg.pathParams` / `msg.query` / `msg.body` 取入参，校验结果在 `msg.output`。
- 不要用 `JsFunctionNode` 手写一套 if 代替校验；它表达不了的跨字段规则（如结束时间晚于开始时间）才在后面补 JS 或 If。
- 只有用户明确说不需要，或接口确实没有入参（如「返回当前时间」）时写 `"validate": []`。汇报里列出校验了哪些字段、什么规则。

## 访问地址

汇报和（用户要求时的）接口批注用同一套：生产 `{访问地址}{path}`，测试在 path 前加 `/@test`。访问地址取 `project workers` 里这台服务器的 `accessUrls`（如 `http://1.2.3.4:8008`）。`trial.mjs` 输出的「访问地址」就是测通的那个，汇报直接用它。缺了就只写方法和路径，注明完整地址是「服务器访问地址 + 路径」，并提示到控制台「节点管理」设置。不要编造域名，不要把凭证密钥写进批注。

接口文档默认不写进画布。用户明确要求时才加接口批注，一个接口一张，写法见 [comment-node.md](comment-node.md)。

## 试跑（步骤 9）

```bash
node $S/trial.mjs flow.json -p "$PROJ" --worker "$WKR" -w "$WF" [--profile P]
```

脚本按顺序做完：本机 / 内网地址预检 → 按 `project workers` 的 `accessUrls` 顺序测连接 → 后台 test-run 并向 `BASE/@test/<path>` 发正常请求（路径参数、必填字段按校验规则填示例值）→ 有校验节点时再发一条不合法请求，确认走 `Invalid`。请求体要按业务造时用 `--request '{"body":{…}}'`。

- **退出码 5（地址都不通或服务器离线）**：不要试跑，把输出里测过的地址和原因告诉用户，点选：我来填访问地址（选「其他」写上地址和端口，之后 `--base` 传入）/ 已处理，重新检测（推荐）/ 换一台服务器 / 先只保存草稿。「换一台」时新服务器还没绑定就先 `assign-workers`。用的不是控制台登记的地址时，汇报里提示到「节点管理」改访问地址。
- **入站认证**：不要猜密钥、不要从凭证里取明文。请用户提供认证头后 `--header "Authorization: Bearer …"`，或加 `--manual`，脚本打印测试地址等用户自己调用。
- 测试环境由引擎先回「消息已经接收到」，看不到业务正文，以节点结果为准。要看某个节点的输出用 `result.mjs test-run test-run.json --flow flow.json --node <id 或 summary> --path output.body`，不要把整份响应读进对话。
- 按 [report.md](report.md)「试跑后」汇报，并写一句不合法请求是否被拦下。
