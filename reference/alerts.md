# 通知与失败告警

- 失败告警的渠道以用户点名为准。没点名就问，选项是本流程已经在用的通知方式。不要把成功路径上的钉钉、飞书、邮件全部复制到失败分支；成功路径已有的通知不要因此删掉或改格式。
- `HttpRequestNode` 走 Failure 时上游字段还在，另带 `msg.error`（`code`、`message`，有时有 `statusCode`）。用 JS 组装告警正文，把 `code` 和 `message` 写在一起（如 `HTTP_IO_ERROR：ConnectException`）。
- 飞书卡片 `lark_md` 只稳定支持加粗、换行、链接。钉钉和飞书正文分开组装，失败告警 header `template` 用 `red`。见 [expressions.md](expressions.md)「飞书卡片与失败原因」。
- 要试跑失败出口时，另用一份**不保存**的画布把请求地址改成连不上的地址再试跑，草稿里仍是原地址。
