# 表达式：按 uiComponent 选语法

权威说明：[表达式类型总览](https://docs.buildify.cn/expr.html)、[JSON 表达式](https://docs.buildify.cn/concepts/json_expr.html)。
占位名一律 `msg`，不要用 `$json`。触发器字段在根级（`msg.xxx`），处理节点结果在 `msg.output`。

写 `data.parameters` 前先看 `node-properties` 的 **`uiComponent`**。不要把 JSON 的 `=` 前缀套到 SQL 或纯文本上。

## 速查

| uiComponent | 变量语法 | 画布里怎么写 |
|---|---|---|
| **`JsonExpressionInput`** | 默认整字段 `={{msg.xxx}}` | 只改需要取值的**字符串值**。默认 `"={{msg.level}}"`，数字/布尔/对象/数组类型保留。结果必须是字符串时才混静态文字：`"=[{{msg.type}}] {{msg.title}}"`。`=` 必须是引号内第一个字符。❌ `"this is ={{msg.title}}"` |
| **`SqlEditor`** | `#{msg.xxx}` / `${msg.xxx}` | **禁止** `{{ }}` 和字符串值前的 `=`。值用 `#{msg.id}`（预编译，防注入）；表名/列名用 `${msg.orderColumn}`（直接替换） |
| **文本及其他**（`Input` / `Password` / `ExpressionInput` / `CodeEditor` 文本·XML·HTML 等） | `{{msg.xxx}}` | 文案、URL、标题里写 `{{msg.output.title}}`。字段若 `expression: true`、或是 `ExpressionInput`、或 `CodeEditor` 默认开了表达式，**整段存储值以 `=` 开头**（同样是模式标记）：`"={{msg.output.path}}"` 或 `"=https://x.com/{{msg.id}}"`。不要写成 `"https://x.com/={{msg.id}}"` |
| **`BooleanExpressionInput`** | 无括号 | 直接 SpEL：`"msg.output.status == 'ok'"`，不要写 `{{ }}`，也不要加 `=` 前缀 |
| **`CodeEditor` 且 `enableExpression: false`**（如 JS 节点） | 不用模板 | 脚本里用语言自身读 payload，例如 `msg`。**必须分段 + 中文注释**，见下文「JS 节点代码」 |

`JsonEditor` 是纯 JSON 数据，不要往里面塞表达式模式；要在 JSON 里注入变量并保留类型，用 `JsonExpressionInput`。

## JSON 表达式（JsonExpressionInput）

只用于 `uiComponent` 为 `JsonExpressionInput` 的字段（请求体、JSON 赋值）。按**每个字符串值**决定，不要给整个 JSON 加一层 `=`，也不要改静态字面量。

**默认整字段替换**，类型与变量一致：

```json
{
  "title": "={{msg.title}}",
  "level": "={{msg.level}}",
  "isRead": "={{msg.isRead}}",
  "sender": "={{msg.sender}}",
  "tags": "={{msg.tags}}"
}
```

运行后 `level` 仍是数字，`isRead` 仍是布尔，`sender` 仍是对象，`tags` 仍是数组。嵌套用点号：`"={{msg.sender.name}}"`。触发器字段在 `msg.xxx`，处理节点结果在 `msg.output.xxx`。

**只有结果必须是字符串时才混静态文字。** `=` 仍是该字符串的第一个字符：

```json
{ "subject": "=[{{msg.type}}] {{msg.title}}" }
```

| 写法 | 结果 |
|---|---|
| `"={{msg.level}}"` | 类型与变量一致（数字、布尔、对象、数组都保留） |
| `"={{msg.sender}}"` / `"={{msg.tags}}"` | 对象 / 数组原样注入 |
| `"=[{{msg.type}}] {{msg.title}}"`、`"=你好 {{msg.name}}"` | 一定是字符串，变量原类型被丢掉 |
| `"this is ={{msg.title}}"` | 表达式没开，按字面量留下 |
| `"={{msg.a + msg.b}}"` | 不支持运算 |

花括号里只写路径，不要空格。变量名拼错，或嵌套中间层为空：该字段变成 `""`，配置不报错，运行不中断。JSON 表达式里不要写 `?.`。要计算，用 JS 节点或布尔表达式。

## SQL：`#{}` / `${}`（SqlEditor）

```sql
SELECT * FROM ${msg.table}
WHERE id = #{msg.id}
  AND name = #{msg.name}
ORDER BY ${msg.orderColumn}
```

| 语法 | 作用 | 示例 |
|---|---|---|
| `#{msg.xxx}` | 预编译参数（推荐，防注入） | `WHERE id = #{msg.output.userId}` |
| `${msg.xxx}` | 直接字符串替换（表名、列名、排序字段） | `FROM ${msg.output.table}` |

`${}` **不转义**，不要把用户输入直接塞进去。动态条件/循环用 XML Dynamic SQL（`<if>` / `<foreach>` 等），见 [XML Dynamic SQL](https://docs.buildify.cn/concepts/xml_sql.html)。

## 文本及其他：`{{ }}`

```
{{msg.output.title}}：共 {{msg.output.count}} 条
订单号：{{msg.input.orderId}}
```

中间层可能为 null 时用 `?.`：`{{msg.output.user?.name}}`。路径区分大小写。

开启了表达式模式时，整段以 `=` 开头、插值仍用 `{{ }}`：`"=Hello {{msg.name}}"`，不要写成 `"Hello ={{msg.name}}"`。

不要把文本字段写成 JSON 整字段替换——文本替换结果永远是字符串。

## JS 节点代码（方便用户事后阅读）

`JsFunctionNode` 的 `parameters.code` **必须分段、加中文注释**。用户会在控制台打开这段脚本，挤成一行、没有注释就很难改。

| 要写 | 不要 |
|---|---|
| 顶部 1～3 行：这段做什么、读哪些字段、返回什么 | 无注释的单行 `return { echo: msg }` |
| 每个步骤用空行 + `// --- 段名 ---` 分开 | 复述代码的废话（如 `// 返回 result`） |
| 关键取值、默认值、分支、`return` 旁写短注释 | 英文注释（流程用户读中文） |
| 多行、缩进；JSON 里用真实换行或 `\n` | 把整段逻辑挤在一行里 |

```javascript
// 回显入站 Webhook，供下游应答使用
// 入参：msg（触发器字段在根级）；出参：{ echo }

// --- 1. 取入参 ---
const payload = msg; // 原样带回，方便对照请求

// --- 2. 返回下游 ---
return {
  echo: payload
};
```

逻辑多于取值+返回时，再拆「校验」「转换」「组装」等段。字段名、默认值、为什么跳过某分支，写在对应行旁边。写入画布时把上述脚本放进 `parameters.code`（字符串，保留换行）。

## 布尔（If / Switch）

```
msg.output.status == 'ok' and msg.output.level > 2
```

字符串比较用**单引号**。可能为 null 的字段用 `?.`。
