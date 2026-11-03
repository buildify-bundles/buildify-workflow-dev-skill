# 画布批注（怎么写进流程 JSON）

Markdown 便签，**不执行、不连线**。权威正文是 `parameters.commentMarkdown` 字符串，不要写成 HTML。不要和 `type: "text"` 的 TextNode 搞混。

**默认不加**，每个 HTTP 接口除外：一张批注，挂在该接口的分组里，排版后靠左。其余何时才加，见 [flow-json.md](flow-json.md)「批注节点」。下面只列写入画布时要用的字段。

HTTP 接口批注写 `parentNode` 指向该段分组框，初始坐标 `{ "x": 0, "y": 0 }` 即可。脚本把它放到组内节点左侧，顶边与节点对齐，高度铺满这一列节点，框向左加宽包住它。这段还没有分组时先加一个框，执行节点和这张批注都挂上去，框标题用接口短名（如「创建用户」）。正文不要再写这个标题：分组名已经显示在框上，批注里默认不显示同名标题。

其他批注不进分组。初始坐标写在被说明节点外侧（单段 `TB` 宽 320 时为 `{-344, 0}`，`LR` 为 `{0, -(高 + 24)}`，多段相对各段原点），脚本让它跟着最近的节点走。写法见 [flow-json.md](flow-json.md)「排版脚本」。

## 必写字段

| 字段 | 取值 |
|---|---|
| `id` | **`n-` + nanoid**，与执行节点同一套规则，本流程内唯一 |
| `type` | `"comment"`（旧数据可能是 `"notes"`，读写同等对待） |
| `zIndex` | `2` |
| `style` | HTTP 接口说明宽 `"480px"`。高先按正文估，排版后改成至少与组内节点列同高（节点列更高时跟着变高，文档在这个高度里看）。其他批注宽默认 `"320px"`（最小 180，最大 480）。高按 `28 + 17×正文行数 + 20×标题行数` 估，限制在 50–480；超过 480 写成 `"480px"` |
| `data.name` | `"CommentNode"`（不要去 `bundle nodes` 里找这个名字） |
| `data.label` | `"comment"` |
| `data.summary` | `"批注"` |
| `data.hasInput` / `hasOutput` | `false` |
| `data.isLayoutNode` | `true`（解析器跳过，校验不会要 bundle） |
| `data.isShowConfigOnAdd` | `false` |
| `data.autoEdit` | 已有正文时 `false` 或省略 |

不要写 `bundleName` / `bundleVersion` / `credentials`，不要出现在任何 `edges` 里。
不要用批注当分组框；分组见 [flow-json.md](flow-json.md)「节点分组」，组内组件写 `parentNode`。

## parameters

编排时写下面这些（其余旧字段不用写）：

| 字段 | 用法 |
|---|---|
| `commentMarkdown` | GFM 正文。HTTP 接口用下面的接口说明，开头不要写和分组标题相同的 `#` 标题；其他批注仍是短的 `##` 标题加一两句 |
| `commentBackground` | 预设 id，默认 `ink`（颜色 `#4a535c`）。写预设 id，不要写色值 |
| `commentBackgroundOpacity` | `0`–`1`，默认 `0` |
| `commentBorderWidth` | 默认 `0`，不显示边框。不写就是 0。要边框再写 `1`–`8` |

背景常用：`ink`（默认，`#4a535c`）、`sand`、`sky`、`ghost`（无底色）、`transparent`（无底色）。边框默认不显示。不要写已废弃的 `paper` / `frost` / `lemon`。

## commentMarkdown 能写什么

预览按 GFM 渲染。工具栏支持的写法也可以直接写进 JSON：

- 标题 `## `，列表 `- ` / `1. `，引用 `> `
- `**粗体**` `*斜体*` `~~删除线~~` `` `行内代码` ``
- 代码块围栏、`[文字](url)`
- 图片 `![alt](url)`，可带宽度 `![alt](url =24)` 或 `![alt](url =24x24)`

不要把整段改成 HTML。颜色高亮只有画布编辑器会插入 `<span style="color:…;background-color:…">`，编排时一般不必手写。

HTTP 接口的正文用这个形状。方法、路径跟触发器一致；字段、示例、错误码只写流程里真实有的，没有的小节整段删掉，不要编造。分组标题已经是接口短名，正文从「接口说明」写起，不要再加同名的 `#` 标题。

~~~~markdown
**接口说明**：创建一个新用户账号

**请求方式**：`POST`

**请求路径**：`/users`

**是否需要认证**：是

#### 请求头

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| Authorization | 是 | string | Bearer Token |
| Content-Type | 是 | string | application/json |

#### 请求参数（Body）

| 参数 | 必填 | 类型 | 说明 | 示例 |
|------|------|------|------|------|
| username | 是 | string | 用户名，3-20 位 | zhangsan |
| email | 是 | string | 邮箱 | a@example.com |
| age | 否 | int | 年龄，0-150 | 25 |

#### 请求示例

```json
{
  "username": "zhangsan",
  "email": "a@example.com",
  "age": 25
}
```

#### 响应参数

| 参数 | 类型 | 说明 |
|------|------|------|
| code | int | 状态码，0 表示成功 |
| message | string | 提示信息 |
| data.id | long | 用户 ID |
| data.createdAt | string | 创建时间，ISO 8601 |

#### 成功响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 10001,
    "createdAt": "2026-11-03T10:00:00Z"
  }
}
```

#### 失败响应示例

```json
{
  "code": 40001,
  "message": "用户名已存在",
  "data": null
}
```

#### 错误码

| 错误码 | 说明 |
|--------|------|
| 40001 | 用户名已存在 |
| 40002 | 参数格式错误 |

#### 访问地址

- 生产：`http://{externalHost}:{httpPort}/users`
- 测试：`http://{externalHost}:{httpPort}/@test/users`
~~~~

- `是否需要认证` 跟触发器 `authType`：`none` 写「否」，并删掉 `#### 请求头`。`jwtAuth` / `apiKey` / `httpBasic` 写「是」，请求头只写认证方式（如 `Authorization: Bearer Token`），不要写密钥或凭证内容。
- 没有 Body / Query 就删掉「请求参数」和「请求示例」。没有响应字段就删掉「响应参数」和成功示例。不知道错误码就删掉「失败响应示例」和「错误码」。
- 测试路径是在 path 前加 `/@test`，生产不加。有 `externalHost` / `httpPort` 才写完整 URL；没有就改成「完整地址 = 服务器访问地址 + 路径」，并提示到控制台「节点管理」设置。不要编造域名。
