# HTTP 接口：访问地址与试跑

入口是 Webhook 触发器或渠道回调触发器时读这份。认证方式怎么选见 SKILL「HTTP 接口」。

## 访问地址

汇报和（用户要求时的）接口批注用同一套：生产 `http://{externalHost}:{httpPort}{path}`，测试在 path 前加 `/@test`。`externalHost` / `httpPort` 取已确认服务器在 `project workers` 里的字段。缺了就只写方法和 `parameters.path`，注明完整地址是「服务器访问地址 + 路径」，并提示到控制台「节点管理」设置。不要编造域名，不要把凭证密钥写进批注。

接口文档默认不写进画布。用户明确要求时才加接口批注，一个接口一张，写法见 [comment-node.md](comment-node.md)。

## 试跑 HTTP 接口（步骤 9）

按这个顺序做：

1. **列出候选地址。** 取已确认服务器在 `project workers` 里的 `externalHost`、`httpPort`、`publicIp`（`test-run` 返回里若带访问地址，以它为准）。`externalHost` 可能自带 `http://` / `https://` 或端口：协议照它，带了端口就不再拼 `httpPort`；没写协议按 `http`。默认端口 `http` 是 **80**、`https` 是 **443**。按顺序列出，和前面重复的去掉：
   1. `externalHost` + `httpPort`
   2. `publicIp` 非空且和 `externalHost` 不是同一个主机时：`publicIp` + `httpPort`
   3. 端口不是默认端口时：公网 IP（没有就用 `externalHost`）+ 默认端口

   字段都没有时，候选为空，直接按第 3 步问用户。不要猜 `hostname`、`localhost`、内网 IP 或别的端口。
2. **依次测通不通。** 只测连接，不调业务路径，每个候选一条命令，看完退出码再测下一个：

   ```bash
   curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$CANDIDATE/"
   ```

   退出码 0 就算通（404 / 401 等任何 HTTP 状态码都算）。6（域名解析失败）、7（连接被拒绝）、28（超时）、35 / 60（TLS）算不通。第一个通的就是这次的 `BASE`，后面的不再测。`BASE` 不是第一个候选时，汇报里写一句「控制台登记的地址不通，这次用的是公网 IP / 默认端口」，并提示到控制台「节点管理」改访问地址。不要在 Agent 的持久 shell 里写 `exit`。
3. **都不通、或没有候选，就停下问用户**，不要 `test-run`。写出测过的地址和各自的原因，再点选：

   ```markdown
   ## 服务器访问地址不通

   火山测试服务器从本机连不上：

   - `http://1.2.3.4:8080`：连接超时
   - `http://5.6.7.8:8080`：连接被拒绝

   请确认服务器在运行，且端口已在防火墙 / 安全组放行。如果这台机器要用别的地址访问（域名、内网穿透、代理、端口映射），直接把地址告诉我。

   1. 我来填访问地址（选「其他」写上地址和端口）
   2. 已处理，重新检测（推荐）
   3. 换一台服务器
   4. 先只保存草稿
   ```

   没有候选时，开头改成「控制台还没有这台服务器的访问地址」，不列测过的地址。「我来填」：用用户给的地址从第 2 步测一次，通了就用它当 `BASE`，并提示到「节点管理」把它登记上。「重新检测」：重新拉 `project workers`，从第 1 步再来。「换一台」：按 SKILL「沿用已有，只问缺的」列出服务器；新服务器还没绑定（`workflow workers` 里没有 `deleteStatus` 0）时，确认后先 `assign-workers`，再继续试跑和发布。「只保存草稿」：停在步骤 8。
4. **通了再试跑。** 后台启动 `test-run`，在它超时前向测试地址发一次请求，再等它返回：

   ```bash
   buildify --json workflow test-run -p "$PROJ" -f ./flow.json --worker "$WKR" --timeout 60 > /tmp/test-run.json &
   sleep 3
   curl -sS -X GET -w '\n%{http_code}' --max-time 30 "$BASE/@test/api/orders/123"
   wait
   node <本 skill 目录>/scripts/result.mjs test-run /tmp/test-run.json --flow ./flow.json
   ```

   测试地址 = `BASE` + `/@test` + 触发器 `parameters.path`，方法与触发器一致；路径参数（如 `:id`）换成示例值，请求体按需求造一条最小样例。触发器开了入站认证时，不要猜密钥、不要从凭证里取明文：请用户提供，或请他自己调测试地址，再等 `test-run` 结果。
5. 结合 `result.mjs` 的摘要和这次 HTTP 响应判断是否符合需求，按 [report.md](report.md)「试跑后」汇报。要看某个节点的输出用 `result.mjs test-run … --node <id 或 summary> --path output.body`，不要把整份响应读进对话。
