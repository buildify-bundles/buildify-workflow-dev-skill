# 环境里没有对应节点：先做 Bundle，再回来编排

步骤 4 必须用 CLI 核实，**禁止**按名称或 recipes 臆造 `bundleName` / 节点 `name`。

## 判定

- `bundle list`（可加 `-k` 关键词，换两三个同义词再查）里没有能覆盖需求的软件包 → **缺软件包**；
- 包在，但 `bundle nodes` 展平结果里没有要用的节点类型 → **缺节点**。

包在、只是缺某个接口的专用节点时，先看同包有没有通用调用节点（类名以 `ApiCall` 结尾，或 `bundle doc` 里有「通用调用」）。有就用它，按厂商官方文档和 `bundle doc` 填 `method` / `path` / `query` / `headers` / `body`，这不算臆造，也不用新开发。

确实没有时**立刻停止**编 JSON / validate / 试跑 / 发布，按下面走。用户确认之前不装 skill、不写 Bundle 代码、不建包。

## 验签回调

先看 `WebhookTriggerNode` 的 `authType` 能不能覆盖（`none` / `httpBasic` / `apiKey` / `jwtAuth`）。对得上就用它，不要到这里来。只有按原始报文验签、对不上这些方式时（微信支付、支付宝、Stripe 等），`bundle nodes` 里又没有该渠道自己的触发器，才是缺这个触发器。通用 `…ApiCall` 不能代替。

方案里的节点必须是触发器。交给 bundle-dev 时写明：

- 自己 `Route.create`，用 `request().body()` 拿到原始字符串后再验签；验签失败按官方文档直接返回，不进入流程
- 支持两种返回：按文档要求直接写回；处理完后不结束连接，eventId 用 `getRequestId()`，由核心包 `WebhookResponseNode` 写回
- 这是对不上 `WebhookTriggerNode` 已有认证之后才做的触发器，不要再做下游验签节点

## 1. 拟默认方案

默认按两份「官方文档」实现：

- **Bundle 写法**按 buildify-bundle-dev 的规范（骨架、表单、凭证、`complete`、发布）；
- **接口行为**按对接服务的官方开放文档（如钉钉 / 飞书 / 企业微信开放平台、厂商 API 参考）。用网页搜索或抓取工具找到官方文档，只认厂商官方域名，不按博客、二手 SDK 或记忆写 endpoint。

方案里写清：

| 块 | 内容 |
|---|---|
| 不存在 | 一句话说明找不到，并写出查过的关键词 |
| 节点 | 每个节点的职责、入参、出参、出口（relations）、是否触发器；对接三方 HTTP API 时再加一个 `…ApiCall` 通用调用节点（bundle-dev 规则 10） |
| 凭证 | 按官方文档的鉴权方式定凭证类型和字段（如 AppKey/AppSecret、Webhook 签名密钥）；不需要就写「无」 |
| 官方文档 | 实际参考的官方文档链接，每个接口一条 |
| 软件包（仅缺软件包时） | 完整名 `命名空间/包名`、显示名、一句话简介、可见性 |
| 图标 | 默认节点用 `default.svg`、不设封面 |

软件包信息的默认值：

- **命名空间**：先 `buildify-publish --json bundle namespaces`。有就用已有的（多个时选和需求最相关的）；没有就建议一个新 slug，并注明「会新建」（每个工作空间最多 5 个）。还没装 `buildify-publish` 或没有发布密钥时先按需求起名，注明「待核实」，到 bundle-dev 建包时再核对。
- **包名**：按对接服务起短名，如 `dingtalk`、`wecom-bot`。两段都只能用小写字母、数字和 `. _ -`，符号不能连续、不能在首尾。
- **显示名 / 简介**：中文，如「钉钉」「发送钉钉群消息与工作通知」。
- **可见性**：`internal`（工作空间内可用）。另一个选项是 `restricted`，不能设为公开。

找不到官方公开文档（内部系统、私有接口）时不要猜：方案里写「需要接口文档」，请用户提供文档或样例请求。

## 2. 确认一次

**用户已经提出要求时不再确认**：他明确说过「没有就直接开发」「按官方文档做」，或者已经给了包名和节点要求。直接按方案开发，在回复里列出用了哪些默认值（包名、可见性、图标），然后进入第 3 步。

**否则只问一次。** 能弹选择题时（如 Cursor 的 AskQuestion），方案正文写在消息里，同一次提问放两道题：

- **下一步**：
  1. 按默认方案创建软件包并开发（推荐）
  2. 调整方案或软件包信息（选「其他」写改动）
  3. 改用「真实节点名」（有相近节点才出现，多个时每个一项）
  4. 先停下
- **图标**：
  1. 用默认图标（推荐）
  2. 我提供图片（节点图标或软件包封面；png/jpg/jpeg/gif/webp/svg，≤ 1MB）

没有选择题界面时用这个模板，用户只回编号：

```markdown
## 缺少软件包

当前工作区没有能实现「发送钉钉群消息」的软件包（查过 `钉钉`、`dingtalk`、`群消息`）。默认方案如下，确认后我会创建软件包、开发并发布，然后继续编排。

### 默认方案

| 项 | 值 |
| --- | --- |
| 软件包 | `acme/dingtalk`（命名空间 acme 已存在） |
| 显示名 | 钉钉 |
| 简介 | 发送钉钉群消息与工作通知 |
| 可见性 | 工作空间内可用 |
| 图标 | 默认图标 |
| 凭证 | DingtalkApp（AppKey、AppSecret） |

| 节点 | 说明 |
| --- | --- |
| 发送群消息 | 入参：会话、消息类型、内容；出口：成功 / 失败 |
| 通用调用（DingtalkApiCall） | 按官方文档调用其他接口 |

开发按 buildify-bundle-dev 规范，接口按官方文档：
- 发送群消息：<官方文档链接>

### 下一步

1. 按默认方案创建软件包并开发（推荐）
2. 调整（直接写要改的项）
3. 改用「真实节点名」
4. 先停下

图标：1. 用默认图标（推荐）  2. 我提供图片
```

**缺节点**（包已存在）用同一模板，标题改成「缺少节点」，第一句写「软件包「真实包名」里没有实现「…」的节点」，去掉软件包、显示名、简介、可见性四行，第 1 项写「在「真实包名」里开发这个节点并发布（推荐）」。图标题只在用户想换图标时出现。

- bundle-dev 未安装时，第 1 项末尾加「（会先安装 buildify-bundle-dev）」。用户已经点了继续，就不要再问是否安装。
- 选「调整」：按改动更新方案，只把改过的项再给用户看一眼就继续，不要再完整问一轮。
- 选「改用」就回到步骤 4 用那个节点；选「先停下」就结束，不保存草稿。
- 选「我提供图片」：请用户发图片或给本机路径，收到再开发。不要自己画 SVG。

## 3. 查 buildify-bundle-dev 是否已装、是否够新

按顺序找，找到一个就算已装，记下它的 `SKILL.md` 路径：

1. 本会话的技能列表里有 `buildify-bundle-dev`。
2. 本 skill 的同级目录：`test -f "<本 skill 目录>/../buildify-bundle-dev/SKILL.md"`。
3. 当前客户端的个人 skills 目录和当前仓库的 skills 目录（如 `~/.cursor/skills/`、`.cursor/skills/`、`~/.claude/skills/`）下的 `buildify-bundle-dev/SKILL.md`。

已装时检查它能不能建包：`rg -q 'bundle create' "<bundle-dev 目录>/reference/publishing.md"`。找不到说明是旧版，按下面的安装说明原地更新。

**安装或更新**：读 <https://buildify.cn/buildify-bundle-dev/install.md>（`curl -sSL` 或网页抓取工具取正文）并照它执行：定 skills 根目录、clone 或更新、校验。install.md 判断目录不确定时会让你问一次，照做。装完不必新开对话，直接读 `SKILL.md` 继续。安装失败就贴出命令输出并停下，不要手抄文件，也不要换别的目录硬装。

发布 CLI 也要能建包：`buildify-publish help` 里没有 `bundle create` / `bundle icon upload` 时，按 bundle-dev 的说明升级 `buildify-publish-cli`（如 `uv tool upgrade buildify-publish-cli`）。

## 4. 开发、建包、发布，再回来编排

1. **先记下编排现场。** 在进度清单下补一段「编排待续」：需求一句话；已确认的项目、流程名、服务器、凭证、方向；要做的节点（入参、出参、出口、是否触发器、凭证）；参考的官方文档链接；以及：

   ```markdown
   软件包信息和图标已由用户确认（或：用户要求直接开发，用默认值）：
   - 完整名 acme/dingtalk（命名空间 acme 已存在 / 需新建）
   - 显示名 钉钉；简介 发送钉钉群消息与工作通知；可见性 internal
   - 图标：默认（或用户提供的图片路径及用途）
   ```

2. **按 bundle-dev 开发。** 读它的 `SKILL.md`，按它的清单做骨架、表单、实现、校验、打包、发布。`bundle.json` 的 `bundleName` 就用上面的完整名。代码放哪、版本号、发布密钥以 bundle-dev 为准，本 skill 的画布规则不用在 Bundle 代码上。
   - bundle-dev「新建软件包」要确认的完整名、显示名、简介、可见性已在第 2 步确认过，直接用「编排待续」里的值建命名空间和包，**不要再问一遍**。
   - 用户提供了图片时按 bundle-dev「命名与图标」上传：节点图标放 `icons/` 后 `bundle icon upload`，封面用 `bundle create --icon`。
   - 仍要问用户的只有：缺发布密钥（`buildify-publish-cli` 密钥，照 bundle-dev 的模板）；`key test` 的工作空间不是当前编排的工作空间；`namespace create` 返回 409（命名空间被别的工作空间占用，只问换成什么名，并同步改 `bundle.json`）；`bundle create` 返回 409（同名包已存在，问是用这个包还是换名）。
3. **发布成功后回到步骤 4。** `buildify --json bundle list -k <关键词>` 确认新包可见，再 `node <本 skill 目录>/scripts/catalog.mjs fetch -b <包名> -n <节点,…> --refresh` 取真实的 `bundleVersion`、`icon`、表单和 relations（`--refresh` 避免用到发布前的旧缓存）。不要用 Bundle 源码里的值代替 CLI 返回。
4. **看不到新包时不要编 JSON。** 先确认发布密钥和 buildify-cli 密钥是同一个工作空间（对比两边 `key test` 的工作空间），再告诉用户已发布的 `bundleName` 和版本，请他在控制台确认这个包对当前工作区可用，确认后重查。
5. **接着编排。** 「编排待续」里已确认的项不再问；新节点有凭证槽时照 [credentials.md](credentials.md) 三选一，然后照常走步骤 5–10。发布汇报里加「新增 Bundle」一节（见 [report.md](report.md)）。
