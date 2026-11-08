# 访问凭证：三选一与现在创建

步骤 5 读这份。只处理还空着的槽。

## 有没有槽

`catalog.mjs` 摘要里的「凭证槽」就是表单里的 `CredentialSelect` 字段，写「无」就告诉用户「不需要访问凭证」，不要绑。槽名（如 `credentialsId`）就是 spec 里 `credentials` 的 key。带显示条件的槽（如 Webhook 的 `httpBasicAuth`，只在 `authType=httpBasic` 时出现）只在条件成立时才需要。

## 三选一

有槽时先 `project credentials -p … -b <包名>` 列出该类型实例，每条已有实例一个选项，再加「现在创建」和「使用时再选」。**即使只有一条也要用户点它**；列表为空也不要自动创建。

```markdown
## 请选择访问凭证

槽位 credentialsId · Mysql

1. 使用已有「生产只读」
2. 现在创建
3. 使用时再选（保存草稿，稍后再在控制台选）
```

| 选项 | 做什么 |
|---|---|
| **使用已有** | spec 里写 `"credentials": { "<槽>": { "type", "name" } }`，`type` / `name` 必须能在 `project credentials` 里找到。`build.mjs` 会同时写进 `data.credentials.<槽>` 和 `parameters.<槽>`（与控制台一致）；手写 JSON 时两处都要写 |
| **现在创建** | 按下面流程用 CLI 创建再绑上，不要让用户自己去控制台找入口 |
| **使用时再选** | **不写**这个槽。校验留下的该槽 ERROR 用 `result.mjs validate --write-errors` 写入顶层 `errors` 后只 save-draft，说明用户在控制台打开流程时再选。不要试跑、不要发布，除非用户之后补上凭证再说试跑 |

## 现在创建

1. 必须已确认项目（`-p` 必填）。
2. 直接跑 `buildify --json project create-credential -p … -b … --type …`（不传 name/label/data），用返回的 `data.userMessage` / `defaults` / `parameters`；或用 `bundle cred-types` / `cred-properties` 取类型与表单。
3. 名称、显示名做成可改的默认，写进「将使用」；每个参数的中文名放进「请填写」（密钥类标明「密钥」）。密钥不能做成选项。
4. 等用户确认。名称、显示名没改就用推荐值；参数没给齐不要创建。
5. 用 stdin 创建，不要 `--data` 上命令行、不要把 JSON 落到仓库：
   `printf '%s' '{"host":"…"}' | buildify --json project create-credential -p "$PROJ" -b "$BUNDLE" --type "$TYPE" --name "$NAME" --label "$LABEL" --file -`
6. 成功后只用返回的 `label` / `name` / `type` 告诉用户已创建，并写入对应槽位。密钥不要出现在回复里。

```markdown
## 创建访问凭证

名称和显示名不改就用「将使用」。请填写参数。

### 将使用

| 项 | 值 |
| --- | --- |
| 名称 | `mysql-prod` |
| 显示名 | 生产库 |

### 请填写

| 参数 | 说明 |
| --- | --- |
| 主机 | |
| 端口 | |
| 密码 | 密钥 |
```

改、删已有凭证和「凭证被哪些流程使用」见 [cli.md](cli.md)「改项目、改服务器、改凭证、删除」。
