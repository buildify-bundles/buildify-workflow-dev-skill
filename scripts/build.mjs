#!/usr/bin/env node
/**
 * 按一份简表（spec）生成画布 flow.json，字段从目录缓存里补齐，最后调用 layout.mjs 排版。
 *
 *   node scripts/build.mjs spec.json -o flow.json [--base draft.json] [--dir DIR] [--fetch [--profile NAME]]
 *                          [--no-defaults] [--no-layout]
 *
 * spec 只写业务内容：
 *   {
 *     "direction": "TB",
 *     "versions": { "buildify/core": "1.0.0" },              // 可选；缓存里只有一个版本时不用写
 *     "nodes": [
 *       { "key": "cron", "bundle": "buildify/core", "name": "SchedulerNode", "summary": "每天8点",
 *         "parameters": { "triggerType": "daily", "triggerHours": 8 } },
 *       { "key": "send", "bundle": "buildify/dingtalk-bot", "name": "SendMarkdownMsgNode", "summary": "发送日报",
 *         "credentials": { "credentialsId": { "type": "DingTalkBotCredentials", "name": "test-prod" } } },
 *       { "key": "g1", "group": "查询" },                       // 分组框；组内节点写 "parent": "g1"
 *       { "key": "doc", "comment": "**接口说明**：…", "width": 480 }  // 批注，只在用户要求时加
 *     ],
 *     "edges": [
 *       ["cron", "http"],                                     // 默认出口 Success
 *       ["http", "alarm", "Failure"],
 *       ["a", "b", "Success,Failure"],                        // 多个出口接同一下游，合成一条边
 *       { "from": "a", "to": "b", "out": ["Failure"], "description": { "Failure": "查不到也继续" } }
 *     ],
 *     "remove": ["n-旧节点", "n-a_n-b"]                        // 只在 --base 时用：删节点（连同它的边）或删边
 *   }
 *
 * HTTP 接口用 http 宏（推荐），一条展开成「Webhook 触发器 + ValidateNode + Invalid 出口的 400 应答」：
 *   { "key": "api", "http": { "method": "GET", "path": "/orders/:id",
 *       "validate": ["pathParams.id",                          // 只写字段 = 必填
 *                    ["pathParams.id", "pattern", "^\\d+$"],    // [字段, 校验, 值]；校验: required notBlank type min max minLength maxLength pattern oneOf
 *                    ["query.size", "max", 100, { "skipIfMissing": true }]],
 *       "auth": "none",                                       // 可选 httpBasic / apiKey / jwtAuth，凭证写在节点 credentials
 *       "cors": { "allowedOrigins": "https://a.com" },        // 可选；不写 = 关闭跨域
 *       "onError": false,                                     // 可选；默认把这条接口上空着的 Failure 都接到一个 500 应答，可写正文对象，false 关掉
 *       "parameters": { "timeout": 30000 } } }                // 可选，触发器的其他参数
 *   method 只写一个（GET 和 POST 各一个宏）；默认 responseMode=WebhookNode、CORS 关闭。确实没有入参写 "validate": []。
 *   边从宏 key 出发（默认出口）时自动接在校验通过之后；宏生成的节点 key 是 <key>.validate、<key>.invalid、<key>.error。
 *   宏生成的节点类型缺目录缓存时自动拉取，catalog.mjs fetch 只列宏以外的节点。
 *
 * 脚本补齐：`n-` + nanoid 的节点 id、`{source}_{target}` 的边 id、目录里的 bundleVersion / icon / label / isTrigger、
 * 表单默认值、边上整份 relation 对象、凭证同时写进 data.credentials 与 parameters、分组框（只写标题，样式走系统默认）、多段粗略原点、
 * 顶层 direction / errors / viewport。出口名、参数键、凭证槽不在目录里时报 ERROR 并且不写文件。
 * WARNING（都要看）：按显示条件算出的必填没填、凭证槽没绑、表达式写法、JS 下游误用 msg.output、summary 超长、
 * SQL 用 ${} 拼请求值、UPDATE / DELETE 没有 WHERE、多个节点分别写库（要一起成功就放进 TransactionExecuteNode）、
 * HTTP 接口有出口走不到 Webhook 响应（调用方会挂到超时）。
 *
 * --base 在已有画布上改：
 *   - 只改参数 / summary / credentials：`{ "id": "n-旧id", "parameters": {…} }`（不写 name，或 name+bundle 与画布相同）→ 旧 id 不变，parameters 按键合并。
 *   - 类型不变却 remove 后再用新 key 建同类型节点：ERROR，不写文件。把旧 id 写到节点上原地改。
 *     删掉一颗又在同一次 spec 里新建另一颗同类型，同样 ERROR，分成两次。
 *   - 切换节点类型：`{ "id": "n-旧id", "bundle": "…", "name": "新类型", "parameters": {…} }`（name 或包名与画布不同）→
 *     分配新的 n- id，按新类型表单重建 data（不合并旧参数），边的 source/target 与边 id 跟着改；旧 id 本张画布不再用，避开按 id 缓存的旧节点。
 *     切换后出边里新类型没有的出口会删掉；某条边一个出口都不剩就 ERROR。切换不要写 remove（remove 是删了重加，边不会自动接上）。
 *   边的两端、parent 可以写 spec 的 key，也可以写旧节点 id（切换后仍解析到新节点）。base 可以是画布，也可以是 get-draft 的整份响应。
 *
 * 退出码：0 已写入（可能有 WARNING）；1 spec 有 ERROR，没有写文件；3 文件、目录缓存或排版失败。
 */
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CatalogError, cachedVersions, catalogDir, credentialSlots, fetchBundle, loadNodeFile, loadNodes,
  parameterNames, pickCachedVersion, profilesWithCache, readJsonFile, unwrap,
} from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: node scripts/build.mjs spec.json -o flow.json [--base draft.json] [--dir DIR] [--fetch [--profile NAME]] [--no-defaults] [--no-layout]\n'
const DECORATION_TYPES = new Set(['text', 'comment', 'notes'])
const SEGMENT_GAP = 1000
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function fail(message, code = 3) {
  process.stderr.write(`build: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { spec: null, out: null, base: null, dir: null, fetch: false, profile: null, defaults: true, layout: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '-o' || arg === '--out') args.out = value()
    else if (arg === '--base') args.base = value()
    else if (arg === '--dir') args.dir = value()
    else if (arg === '--fetch') args.fetch = true
    else if (arg === '--profile') args.profile = value()
    else if (arg === '--no-defaults') args.defaults = false
    else if (arg === '--no-layout') args.layout = false
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else if (!args.spec) args.spec = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.spec) fail(`缺少 spec 路径。${USAGE}`)
  if (!args.out) fail(`缺少 -o 输出路径。${USAGE}`)
  args.explicitDir = Boolean(args.dir)
  args.dir = catalogDir(args.dir, args.profile)
  return args
}

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value)

/** get-draft 整份响应、data.workflowJson（对象或字符串）、或画布本身都接受。 */
function readCanvas(file) {
  let canvas = unwrap(readJsonFile(file, '画布'), file)
  if (canvas?.workflowJson !== undefined) canvas = canvas.workflowJson
  if (typeof canvas === 'string') {
    try {
      canvas = JSON.parse(canvas)
    } catch (error) {
      throw new CatalogError(`${file} 的 workflowJson 不是合法 JSON: ${error.message}`)
    }
  }
  if (!canvas || !Array.isArray(canvas.nodes)) throw new CatalogError(`${file} 里没有画布 nodes 数组`)
  if (!Array.isArray(canvas.edges)) canvas.edges = []
  return canvas
}

function createReport() {
  const items = []
  return {
    items,
    error: (where, message) => items.push({ level: 'ERROR', where, message }),
    warn: (where, message) => items.push({ level: 'WARNING', where, message }),
  }
}

// ---------------------------------------------------------------------------
// 目录
// ---------------------------------------------------------------------------

function splitBundle(ref) {
  const [bundleName, version] = String(ref ?? '').split('@')
  return { bundleName, version: version || null }
}

/**
 * 定下每个包用哪个版本，必要时拉缓存，返回 lookup(bundle, version, name)。
 * 只由 http 宏生成的节点类型（macroNames）缺缓存时直接拉，不要求先 catalog.mjs fetch。
 */
async function prepareCatalog(wanted, spec, args, macroNames = new Set()) {
  const versions = new Map()
  for (const { bundleName, version } of wanted) {
    const chosen = version || spec.versions?.[bundleName] || null
    const key = `${bundleName}@${chosen ?? ''}`
    if (!versions.has(key)) versions.set(key, { bundleName, version: chosen, nodes: new Set() })
  }
  for (const item of wanted) {
    const chosen = item.version || spec.versions?.[item.bundleName] || null
    versions.get(`${item.bundleName}@${chosen ?? ''}`).nodes.add(item.name)
  }

  const resolved = new Map()
  for (const [key, entry] of versions) {
    let version = entry.version
    if (!version) {
      version = pickCachedVersion(args.dir, entry.bundleName)
      const cached = cachedVersions(args.dir, entry.bundleName)
      if (!version && cached.length > 1) {
        throw new CatalogError(`缓存里 ${entry.bundleName} 有多个版本（${cached.join(', ')}），在 spec.versions 或节点的 bundle 里写明版本`)
      }
    }
    const missing = name => !version
      || !loadNodeFile(args.dir, entry.bundleName, version, name, 'properties')
      || !loadNodeFile(args.dir, entry.bundleName, version, name, 'relations')
    const absent = [...entry.nodes].filter(missing)
    if (absent.length) {
      if (!args.fetch && !absent.every(name => macroNames.has(`${entry.bundleName}\0${name}`))) {
        const profiles = !args.profile && !args.explicitDir
          ? [...new Set(absent.flatMap(name => profilesWithCache(entry.bundleName, version, name)))]
          : []
        throw new CatalogError(`缓存里缺 ${entry.bundleName}${version ? `@${version}` : ''} 的 ${absent.join(', ')}，`
          + (profiles.length ? `缓存在 --profile ${profiles.join(' / ')} 下，加上它重跑` : '先 catalog.mjs fetch，或加 --fetch'))
      }
      version = await fetchBundle({ dir: args.dir, bundleName: entry.bundleName, version, nodes: [...entry.nodes], profile: args.profile })
    }
    resolved.set(key, version)
  }

  const cache = new Map()
  return (bundleName, version, name) => {
    const chosen = version || spec.versions?.[bundleName] || null
    const resolvedVersion = resolved.get(`${bundleName}@${chosen ?? ''}`) ?? chosen
    const cacheKey = `${bundleName}@${resolvedVersion}\0${name}`
    if (!cache.has(cacheKey)) {
      const entry = loadNodes(args.dir, bundleName, resolvedVersion)?.get(name) ?? null
      cache.set(cacheKey, {
        version: resolvedVersion,
        entry,
        properties: loadNodeFile(args.dir, bundleName, resolvedVersion, name, 'properties'),
        relations: loadNodeFile(args.dir, bundleName, resolvedVersion, name, 'relations'),
      })
    }
    return cache.get(cacheKey)
  }
}

// ---------------------------------------------------------------------------
// http 宏
// ---------------------------------------------------------------------------

const RULE_VALUE_KEY = { type: 'typeName', min: 'min', max: 'max', minLength: 'minLength', maxLength: 'maxLength', pattern: 'pattern', oneOf: 'oneOf' }

/** "body.id" → 必填；[field, check, value?, extra?] → ValidateNode 一条规则；对象原样用。 */
function validateRule(item, where, report) {
  if (typeof item === 'string') return { field: item, check: 'required' }
  if (isObject(item)) return clone(item)
  if (!Array.isArray(item) || !item[0] || !item[1]) {
    report.error(where, `validate 每项写 "字段"、[字段, 校验, 值?, {skipIfMissing}?] 或规则对象，现在是 ${JSON.stringify(item)}`)
    return null
  }
  const [field, check, value, extra] = item
  const rule = { field, check }
  if (value !== undefined) {
    const key = RULE_VALUE_KEY[check]
    if (!key) report.error(where, `校验 ${check} 不带值（带值的只有 ${Object.keys(RULE_VALUE_KEY).join(' / ')}）`)
    else rule[key] = check === 'oneOf' && Array.isArray(value) ? value.join('\n') : value
  }
  return isObject(extra) ? { ...rule, ...extra } : rule
}

/**
 * 把 `{ key, http: {...} }` 展开成触发器 + ValidateNode + Invalid 的 400 应答，并补两条边。
 * 返回 { nodes, edges, aliases }：aliases 把宏的 key 指到校验节点，后面的边从宏 key 出发（默认出口）时接在校验通过之后。
 */
function expandMacros(spec, report) {
  const nodes = []
  const edges = []
  const aliases = new Map()
  const types = new Set()
  const errorTargets = []
  for (const item of spec.nodes) {
    if (!isObject(item) || !isObject(item.http)) {
      nodes.push(item)
      continue
    }
    const http = item.http
    const where = `节点 ${item.key ?? '?'}（http 宏）`
    if (!item.key) {
      report.error('nodes', 'http 宏要写 key')
      continue
    }
    const method = String(http.method ?? '').toUpperCase()
    if (!method || !http.path) {
      report.error(where, 'http 宏要写 method（一个方法一条触发器）和 path')
      continue
    }
    if (Array.isArray(http.method)) report.error(where, 'method 只写一个；GET 和 POST 各写一个 http 宏')
    const bundle = http.bundle ?? 'buildify/core'
    const auth = http.auth ?? 'none'
    const cors = isObject(http.cors)
      ? { allowedMethods: [method], allowCredentials: false, ...http.cors, enabled: true }
      : { enabled: false, allowedOrigins: '*', allowedMethods: [method] }
    if (cors.enabled && (!cors.allowedOrigins || cors.allowedOrigins === '*')) {
      report.warn(where, '开了跨域却没写具体来源：cors.allowedOrigins 写用户给的域名（每行一个），不要用 *')
    }
    const triggerParams = {
      path: http.path,
      methods: [method],
      authType: auth,
      responseMode: 'WebhookNode',
      ...(http.parameters ?? {}),
      options: { ...(http.parameters?.options ?? {}), cors },
    }
    const triggerName = http.trigger ?? 'WebhookTriggerNode'
    nodes.push({
      key: item.key, bundle, name: triggerName, summary: item.summary ?? http.summary ?? '接收请求',
      parameters: triggerParams, credentials: item.credentials ?? http.credentials, parent: item.parent, id: item.id,
    })
    types.add(`${splitBundle(bundle).bundleName}\0${triggerName}`)
    if (http.onError !== false) {
      const errorKey = `${item.key}.error`
      nodes.push({
        key: errorKey, bundle, name: 'WebhookResponseNode', summary: http.errorSummary ?? '处理失败',
        parameters: {
          responseType: 'custom',
          outputType: 'json',
          jsonValue: isObject(http.onError) ? http.onError : { code: 500, message: '服务异常，请稍后重试' },
          options: { responseStatusCode: 500 },
        },
        parent: item.parent,
      })
      types.add(`${splitBundle(bundle).bundleName}\0WebhookResponseNode`)
      errorTargets.push({ trigger: item.key, target: errorKey })
    }
    const rules = (http.validate ?? []).map(rule => validateRule(rule, where, report)).filter(Boolean)
    if (!rules.length) {
      if (http.validate === undefined) report.warn(where, '没写 validate：接口有入参时按 http.md「默认校验入参」写；确实没有入参写 "validate": []')
      continue
    }
    const validateKey = `${item.key}.validate`
    const invalidKey = `${item.key}.invalid`
    nodes.push({
      key: validateKey, bundle, name: 'ValidateNode', summary: http.validateSummary ?? '校验参数',
      parameters: { configType: 'rules', rules, keepOtherFields: true }, parent: item.parent,
    })
    nodes.push({
      key: invalidKey, bundle, name: 'WebhookResponseNode', summary: http.invalidSummary ?? '参数错误',
      parameters: {
        responseType: 'custom',
        outputType: 'json',
        jsonValue: http.invalidBody ?? { code: 400, message: '参数不合法', errors: '={{msg.output.errors}}' },
        options: { responseStatusCode: 400 },
      },
      parent: item.parent,
    })
    edges.push([item.key, validateKey], [validateKey, invalidKey, 'Invalid'])
    aliases.set(item.key, validateKey)
    for (const name of ['ValidateNode', 'WebhookResponseNode']) types.add(`${splitBundle(bundle).bundleName}\0${name}`)
  }
  return { nodes, edges, aliases, types, errorTargets }
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

function newIdFactory(taken) {
  return () => {
    for (;;) {
      let id = 'n-'
      for (let i = 0; i < 8; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)]
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

function fieldsByName(properties) {
  return new Map((properties?.schema?.properties ?? []).filter(prop => prop?.name).map(prop => [prop.name, prop]))
}

const NESTED = new Set(['Collection', 'Fixed'])

/** Collection / Fixed 里没有显示条件的必填子字段，服务端即使整块没写也会校验。 */
function missingNested(field, value, path = field.name) {
  const missing = []
  const current = isObject(value) ? value : {}
  for (const child of field.options ?? []) {
    if (!child?.name || !child.uiComponent || child.displayOptions || !child.required) continue
    const childValue = current[child.name]
    const childPath = `${path}.${child.name}`
    if (NESTED.has(child.uiComponent)) {
      if (!isObject(childValue)) missing.push(childPath)
      missing.push(...missingNested(child, childValue, childPath))
    } else if (childValue === undefined || childValue === null || childValue === '') missing.push(childPath)
  }
  return missing
}

/** 按 displayOptions.show / hide 判断字段在当前参数下是否显示（显示了才校验必填）。 */
function isVisible(field, parameters) {
  const matches = (key, values) => {
    const allowed = [].concat(values)
    const current = parameters[key]
    return Array.isArray(current) ? current.some(item => allowed.includes(item)) : allowed.includes(current)
  }
  const show = field.displayOptions?.show
  const hide = field.displayOptions?.hide
  if (isObject(show) && !Object.entries(show).every(([key, values]) => matches(key, values))) return false
  if (isObject(hide) && Object.entries(hide).some(([key, values]) => matches(key, values))) return false
  return true
}

function describeCondition(field) {
  const show = field.displayOptions?.show ?? {}
  return Object.entries(show).map(([key, values]) => `${key}=${[].concat(values).join('|')}`).join(' 且 ')
}

/** 触发器在「由 Webhook 响应节点写回」模式下才要求每条路都走到应答。 */
function waitsForResponse(node) {
  const data = node?.data ?? {}
  if (!data.isTrigger) return false
  const mode = data.parameters?.responseMode ?? (data.name === 'WebhookTriggerNode' ? 'WebhookNode' : null)
  return mode === 'WebhookNode'
}

/**
 * 从触发器往下走到 Webhook 响应为止，找出没有出边的出口：[{ node, exit }]。
 * 触发器自己的出口只在 customErrorOutput 打开时算（关着时引擎直接回标准错误）。
 */
function unansweredExits(trigger, flow, byId, lookup) {
  const result = []
  const seen = new Set([trigger.id])
  const queue = [trigger]
  while (queue.length) {
    const node = queue.shift()
    if (node.data?.name === 'WebhookResponseNode') continue
    const outgoing = flow.edges.filter(edge => edge.source === node.id)
    const checkExits = node !== trigger || trigger.data.parameters?.customErrorOutput === true
    if (checkExits) {
      const { schema, custom } = relationSchema(node, lookup)
      const used = new Set(outgoing.flatMap(edge => (edge.data?.relations ?? []).map(rel => rel.name)))
      for (const exit of [...(schema ?? []), ...custom]) {
        if (exit?.name && !used.has(exit.name)) result.push({ node, exit: exit.name })
      }
    }
    for (const edge of outgoing) {
      const next = byId.get(edge.target)
      if (next && !seen.has(next.id)) {
        seen.add(next.id)
        queue.push(next)
      }
    }
  }
  return result
}

/** 给边加一个出口；这对节点还没有边时新建。 */
function addRelation(flow, edgeById, source, target, relation) {
  const id = `${source.id}_${target.id}`
  const kept = edgeById.get(id)
  if (kept) {
    if (!kept.data.relations.some(item => item.name === relation.name)) kept.data.relations.push(clone(relation))
    return
  }
  const created = { id, type: 'default', source: source.id, target: target.id, data: { relations: [clone(relation)] }, label: '', zIndex: 2000 }
  flow.edges.push(created)
  edgeById.set(id, created)
}

/** http 宏写了 onError：把这条接口上还空着的 Failure 都接到统一的 500 应答。返回没接上任何边、要删掉的应答节点 id。 */
function wireErrorTargets(macro, keyToId, flow, byId, edgeById, lookup) {
  const unused = []
  for (const { trigger, target } of macro.errorTargets) {
    const triggerNode = byId.get(keyToId.get(trigger))
    const errorNode = byId.get(keyToId.get(target))
    if (!triggerNode || !errorNode) continue
    for (const { node, exit } of unansweredExits(triggerNode, flow, byId, lookup)) {
      if (exit !== 'Failure' || node === triggerNode || node === errorNode) continue
      const { schema, custom } = relationSchema(node, lookup)
      const relation = [...(schema ?? []), ...custom].find(item => item.name === 'Failure')
      if (relation) addRelation(flow, edgeById, node, errorNode, relation)
    }
    if (!flow.edges.some(edge => edge.target === errorNode.id)) unused.push(errorNode.id)
  }
  return unused
}

function lintUnanswered(flow, byId, lookup, report) {
  for (const trigger of flow.nodes.filter(waitsForResponse)) {
    const missing = unansweredExits(trigger, flow, byId, lookup)
    if (!missing.length) continue
    const p = trigger.data.parameters ?? {}
    const api = `${[].concat(p.methods ?? []).join('/')} ${p.path ?? ''}`.trim()
    const list = missing.map(({ node, exit }) => `${node.data?.summary || node.data?.name || node.id} 的 ${exit}`).join('、')
    report.warn(`节点 ${trigger.id}（${trigger.data.summary || api}）`,
      `接口 ${api} 有 ${missing.length} 个出口走不到 Webhook 响应，调用方会挂到超时（${p.timeout ?? 5000}ms）再收到 504：${list}。`
      + '用 http 宏时 Failure 会自动接 500 应答（别写 "onError": false）；其他出口接到对应的应答节点')
  }
}

const WRITE_SQL = /^\s*(insert|update|delete|replace|merge)\b/i
const USER_INPUT_DOLLAR = /\$\{\s*msg\.(body|query|pathParams|headers)\b/

/** 整张画布的数据写入检查：多条独立写入、UPDATE / DELETE 不带 WHERE、${} 接用户输入。 */
function lintWrites(flow, report) {
  const writers = []
  for (const node of flow.nodes) {
    const data = node.data ?? {}
    if (!data.name || data.name === 'TransactionExecuteNode') continue
    const sqls = Object.entries(data.parameters ?? {})
      .filter(([key, value]) => key !== 'code' && typeof value === 'string'
        && value.split(';').some(statement => /^\s*(select|insert|update|delete|replace|with)\b/i.test(statement)))
      .map(([, value]) => value)
    const where = `节点 ${node.id}（${data.summary || data.name}）`
    for (const sql of sqls) {
      if (USER_INPUT_DOLLAR.test(sql)) report.warn(where, 'SQL 用 ${} 拼了请求里的值，有注入风险；值一律 #{}，${} 只放表名、列名这类可信标识')
      for (const statement of sql.split(';').filter(item => item.trim())) {
        if (/^\s*(update|delete)\b/i.test(statement) && !/\bwhere\b/i.test(statement)) {
          report.warn(where, `${statement.trim().split(/\s+/)[0].toUpperCase()} 没有 WHERE，会改到整张表`)
        }
      }
    }
    if (/^(Insert|Update|Delete|Upsert)/.test(data.name) || sqls.some(sql => WRITE_SQL.test(sql))) writers.push(node)
  }
  if (writers.length > 1) {
    report.warn('数据一致性', `${writers.map(node => node.data.summary || node.id).join('、')} 分别写库；要一起成功时放进同一个 TransactionExecuteNode，`
      + '否则中途失败前面的写入收不回来（见 data-consistency.md）。确实互相独立可以忽略')
  }
}

/** 表达式写法的常见错误，按 uiComponent 判断。 */
function lintExpressions(where, parameters, fields, report) {
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (typeof value !== 'string') continue
    const field = fields.get(key)
    const ui = field?.uiComponent
    if (value.includes('$json')) report.warn(where, `参数 ${key} 用了 $json，占位名要写 msg`)
    if (ui === 'SqlEditor') {
      if (value.includes('{{')) report.error(where, `参数 ${key} 是 SqlEditor，变量用 #{msg.x}（值）或 \${msg.x}（表名/列名），不要写 {{ }}`)
      continue
    }
    if (ui === 'BooleanExpressionInput') {
      if (value.startsWith('=') || value.includes('{{')) report.warn(where, `参数 ${key} 是布尔表达式，直接写 SpEL（如 msg.output.ok == true），不要 = 前缀和 {{ }}`)
      continue
    }
    // URL 查询串里的 ip={{msg.x}} 也会拼出 ={{，整段以 = 开头时是合法插值，不算误写
    if (!value.startsWith('=') && value.includes('={{')) {
      report.warn(where, `参数 ${key} 里 = 不在第一个字符，表达式不会生效；写成 "=前缀 {{msg.x}}"`)
    }
    if (ui === 'CodeEditor' && field?.typeOptions?.enableExpression === false && !/\/\/|\/\*/.test(value)) {
      report.warn(where, `参数 ${key} 的脚本没有注释，按 expressions.md「JS 节点代码」分段写中文注释`)
    }
  }
}

function buildExecData(spec, lookup, report, useDefaults) {
  const where = `节点 ${spec.key ?? spec.id}`
  const { bundleName, version } = splitBundle(spec.bundle)
  const found = lookup(bundleName, spec.version || version, spec.name)
  if (!found.entry) {
    report.error(where, `${bundleName}@${found.version} 里没有节点 ${spec.name}`)
    return null
  }
  const fields = fieldsByName(found.properties)
  const known = parameterNames(found.properties)
  const slots = new Map(credentialSlots(found.properties).map(slot => [slot.slot, slot]))

  const base = useDefaults ? clone(found.properties?.schema?.defaultValue ?? found.entry.parameters ?? {}) : {}
  const parameters = {}
  if (isObject(base)) for (const [key, value] of Object.entries(base)) if (known.has(key)) parameters[key] = value
  for (const [key, value] of Object.entries(spec.parameters ?? {})) {
    if (!known.has(key)) report.error(where, `参数 ${key} 不在 ${spec.name} 的表单里（可用: ${[...known].join(', ')}）`)
    parameters[key] = clone(value)
  }

  let credentials
  for (const [slot, value] of Object.entries(spec.credentials ?? {})) {
    const info = slots.get(slot)
    if (!info) {
      report.error(where, `${spec.name} 没有凭证槽 ${slot}（${slots.size ? `可用: ${[...slots.keys()].join(', ')}` : '这个节点不需要访问凭证'}）`)
      continue
    }
    if (!value?.type || !value?.name) {
      report.error(where, `凭证槽 ${slot} 要写 { "type", "name" }，取自用户在 project credentials 里点选的那条`)
      continue
    }
    if (info.type && value.type !== info.type) report.error(where, `凭证槽 ${slot} 的类型应为 ${info.type}，现在是 ${value.type}`)
    credentials = { ...credentials, [slot]: { type: value.type, name: value.name } }
    parameters[slot] = { type: value.type, name: value.name }
  }

  for (const [name, field] of fields) {
    if (field.uiComponent === 'CredentialSelect' || !isVisible(field, parameters)) continue
    const value = parameters[name]
    const empty = value === undefined || value === null || value === ''
    const when = field.displayOptions ? `（${describeCondition(field)} 时）` : ''
    if (field.required && empty) report.warn(where, `必填参数 ${name}（${field.label ?? name}）${when}还没填`)
    if (NESTED.has(field.uiComponent)) {
      for (const path of missingNested(field, value)) report.warn(where, `${path} 是必填（校验会报），按 catalog.mjs 摘要补上`)
    }
  }
  for (const [slot, info] of slots) {
    const field = fields.get(slot)
    if (!credentials?.[slot] && (!field || isVisible(field, parameters))) {
      report.warn(where, `凭证槽 ${slot}（${info.type ?? '?'}）没绑定；用户选了「使用时再选」时正常（ship 加 --credentials-later），否则按「凭证」三选一`)
    }
  }
  lintExpressions(where, parameters, fields, report)
  if ([...String(spec.summary ?? '')].length > 8) report.warn(where, `summary「${spec.summary}」超过 8 个字，卡片宽度固定，多出来的字会被截断`)
  if (!spec.summary) report.warn(where, '缺少 summary，写这个节点在本流程里的职责（≤8 字）')

  const data = {
    name: spec.name,
    bundleName,
    bundleVersion: found.version,
    icon: found.entry.icon,
    label: found.entry.label,
    summary: spec.summary ?? '',
    parameters,
  }
  if (found.entry.isTrigger) data.isTrigger = true
  if (credentials) data.credentials = credentials
  if (spec.disabled) data.disabled = true
  if (Array.isArray(spec.relations)) data.relations = clone(spec.relations)
  return data
}

function groupNode(spec, id) {
  const label = String(spec.group)
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    zIndex: 0,
    data: {
      name: 'GroupNode',
      label: 'group',
      summary: label,
      isLayoutNode: true,
      parameters: { groupLabel: label },
    },
  }
}

function commentHeight(markdown) {
  const lines = String(markdown).split('\n').filter(line => line.trim())
  const titles = lines.filter(line => /^\s*#/.test(line)).length
  const height = 28 + 17 * (lines.length - titles) + 20 * titles
  return Math.min(480, Math.max(50, height))
}

function commentNode(spec, id) {
  const width = Math.min(480, Math.max(180, Number(spec.width) || 320))
  return {
    id,
    type: 'comment',
    position: { x: 0, y: 0 },
    zIndex: 2,
    style: { width: `${width}px`, height: `${commentHeight(spec.comment)}px` },
    data: {
      name: 'CommentNode',
      label: 'comment',
      summary: '批注',
      hasInput: false,
      hasOutput: false,
      isLayoutNode: true,
      isShowConfigOnAdd: false,
      autoEdit: false,
      parameters: {
        commentMarkdown: String(spec.comment),
        commentBackground: 'ink',
        commentBackgroundOpacity: 0,
        commentBorderWidth: 1.5,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// 边
// ---------------------------------------------------------------------------

function normalizeEdge(raw) {
  if (Array.isArray(raw)) {
    const [from, to, out] = raw
    return { from, to, out: out == null ? null : String(out).split(',').map(name => name.trim()).filter(Boolean), description: {} }
  }
  const out = raw?.out == null ? null : [].concat(raw.out).flatMap(name => String(name).split(',')).map(name => name.trim()).filter(Boolean)
  return { from: raw?.from, to: raw?.to, out, description: isObject(raw?.description) ? raw.description : {} }
}

function relationSchema(node, lookup) {
  const data = node?.data ?? {}
  const custom = Array.isArray(data.relations) ? data.relations : []
  if (!data.bundleName || !data.name) return { schema: null, custom }
  const found = lookup(data.bundleName, data.bundleVersion, data.name)
  return { schema: Array.isArray(found.relations?.schema) ? found.relations.schema : null, custom }
}

/** 把边上所有指向 oldId 的 source/target 改成 newId，边 id 重算为 {source}_{target}；撞车的边按出口名合并。 */
function rewireNodeId(flow, oldId, newId) {
  const result = []
  const byPair = new Map()
  for (const edge of flow.edges) {
    const source = edge.source === oldId ? newId : edge.source
    const target = edge.target === oldId ? newId : edge.target
    const id = `${source}_${target}`
    const relations = clone(edge.data?.relations ?? []) ?? []
    const kept = byPair.get(id)
    if (kept) {
      for (const rel of relations) {
        if (!kept.data.relations.some(item => item.name === rel.name)) kept.data.relations.push(rel)
      }
      continue
    }
    const next = { ...edge, id, source, target, data: { ...(edge.data ?? {}), relations } }
    byPair.set(id, next)
    result.push(next)
  }
  flow.edges = result
}

/** 原地改参数 / summary / credentials（类型不变）。 */
function patchExistingNode(item, target, lookup, report, pendingParents, keyToId, rows) {
  const data = target.data ?? (target.data = {})
  if (item.summary !== undefined) data.summary = item.summary
  if (item.disabled !== undefined) {
    if (item.disabled === true) data.disabled = true
    else delete data.disabled
  }
  const mergedParams = { ...(data.parameters ?? {}), ...(item.parameters ?? {}) }
  const mergedCreds = { ...(data.credentials ?? {}), ...(item.credentials ?? {}) }
  if (data.bundleName && data.name) {
    const check = createReport()
    const rebuilt = buildExecData({
      key: item.key ?? item.id, bundle: `${data.bundleName}@${data.bundleVersion}`, name: data.name,
      summary: data.summary, parameters: mergedParams, credentials: mergedCreds,
    }, lookup, check, false)
    for (const entry of check.items) report.items.push(entry)
    if (rebuilt) {
      data.parameters = rebuilt.parameters
      if (rebuilt.credentials) data.credentials = rebuilt.credentials
      else delete data.credentials
    }
  } else data.parameters = mergedParams
  if (item.parent !== undefined) pendingParents.push({ node: target, parent: item.parent })
  if (item.key) {
    if (keyToId.has(item.key) && keyToId.get(item.key) !== target.id) {
      report.error(`节点 ${item.key}`, 'key 重复')
      return
    }
    keyToId.set(item.key, target.id)
  }
  keyToId.set(item.id, target.id)
  rows.push([item.key ?? item.id, target.id, `${data.name ?? target.type}（修改）`, data.summary ?? ''])
}

// ---------------------------------------------------------------------------
// 多段原点
// ---------------------------------------------------------------------------

/** 互不连线的几段各给一个粗略原点，排版脚本按它决定段的先后。 */
function assignSegmentOrigins(nodes, edges, order, direction, baseIds) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const topOf = id => {
    let node = byId.get(id)
    while (node?.parentNode && byId.has(node.parentNode)) node = byId.get(node.parentNode)
    return node?.id ?? id
  }
  const boxes = nodes.filter(node => !node.parentNode && !DECORATION_TYPES.has(node.type))
  const parent = new Map(boxes.map(node => [node.id, node.id]))
  const find = id => {
    while (parent.get(id) !== id) id = parent.get(id)
    return id
  }
  for (const edge of edges) {
    const a = topOf(edge.source)
    const b = topOf(edge.target)
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b))
  }
  const components = new Map()
  for (const box of boxes) {
    const root = find(box.id)
    if (!components.has(root)) components.set(root, [])
    components.get(root).push(box)
  }
  if (components.size < 2) return

  const rank = id => {
    const index = order.indexOf(id)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  const along = direction === 'LR' ? 'y' : 'x'
  const placed = [...components.values()]
  const existing = placed.flatMap(list => list.filter(box => baseIds.has(box.id)))
  let next = existing.length ? Math.max(...existing.map(box => box.position?.[along] ?? 0)) + SEGMENT_GAP : 0
  const fresh = placed.filter(list => !list.some(box => baseIds.has(box.id)))
    .sort((a, b) => Math.min(...a.map(box => rank(box.id))) - Math.min(...b.map(box => rank(box.id))))

  for (const list of placed) {
    const anchor = list.find(box => baseIds.has(box.id))
    if (!anchor) continue
    for (const box of list) if (!baseIds.has(box.id)) box.position = { ...anchor.position }
  }
  for (const list of fresh) {
    for (const box of list) box.position = direction === 'LR' ? { x: 0, y: next } : { x: next, y: 0 }
    next += SEGMENT_GAP
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const spec = readJsonFile(args.spec, 'spec')
  if (!Array.isArray(spec?.nodes)) fail('spec 顶层要有 nodes 数组')
  const base = args.base ? readCanvas(args.base) : null
  const flow = base ?? { nodes: [], edges: [] }
  const baseIds = new Set(flow.nodes.map(node => node.id))
  const report = createReport()
  const macro = expandMacros(spec, report)
  spec.nodes = macro.nodes
  spec.edges = [...macro.edges.filter(edge => edge.length === 2), ...(spec.edges ?? []), ...macro.edges.filter(edge => edge.length === 3)]

  const removed = new Set()
  const removedExec = []
  for (const ref of spec.remove ?? []) {
    if (!base) {
      report.error('remove', 'remove 只在 --base 时用')
      break
    }
    if (baseIds.has(ref)) {
      removed.add(ref)
      continue
    }
    const before = flow.edges.length
    flow.edges = flow.edges.filter(edge => edge.id !== ref && `${edge.source}_${edge.target}` !== ref)
    if (flow.edges.length === before) report.error('remove', `${ref} 既不是已有节点 id，也不是已有边 id`)
  }
  if (removed.size) {
    for (const node of flow.nodes) {
      if (!removed.has(node.id) || !node.data?.name || !node.data?.bundleName) continue
      removedExec.push({ id: node.id, name: node.data.name, bundleName: node.data.bundleName })
    }
    const orphans = flow.nodes.filter(node => removed.has(node.parentNode)).map(node => node.id)
    if (orphans.length) report.error('remove', `删掉的分组框里还有节点 ${orphans.join(', ')}，先把它们一起删掉或改 parent`)
    flow.nodes = flow.nodes.filter(node => !removed.has(node.id))
    flow.edges = flow.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target))
  }

  const execSpecs = spec.nodes.filter(item => item?.name)
  const existingSources = flow.nodes.filter(node => node.data?.bundleName && node.data?.name)
  const wanted = [
    ...execSpecs.map(item => {
      const { bundleName, version } = splitBundle(item.bundle)
      return { bundleName, version: item.version || version, name: item.name }
    }),
    ...existingSources.map(node => ({ bundleName: node.data.bundleName, version: node.data.bundleVersion, name: node.data.name })),
  ]
  for (const item of execSpecs) if (!item.bundle) report.error(`节点 ${item.key ?? '?'}`, '缺少 bundle（如 "buildify/core"）')
  if (report.items.some(item => item.level === 'ERROR')) return finish(report, null, args)
  const lookup = await prepareCatalog(wanted.filter(item => item.bundleName), spec, args, macro.types)

  const taken = new Set(flow.nodes.map(node => node.id))
  const newId = newIdFactory(taken)
  const keyToId = new Map()
  const order = []
  const rows = []
  const pendingParents = []
  const switched = []

  for (const item of spec.nodes) {
    if (!isObject(item)) {
      report.error('nodes', `有一项不是对象: ${JSON.stringify(item)}`)
      continue
    }
    const existing = item.id ? flow.nodes.find(node => node.id === item.id) : null
    if (item.id && existing && item.group === undefined && item.comment === undefined) {
      if (!item.name) {
        patchExistingNode(item, existing, lookup, report, pendingParents, keyToId, rows)
        continue
      }
      if (!item.bundle) {
        report.error(`节点 ${item.key ?? item.id}`, '缺少 bundle（如 "buildify/core"）')
        continue
      }
      const { bundleName } = splitBundle(item.bundle)
      const sameType = existing.data?.name === item.name && existing.data?.bundleName === bundleName
      if (sameType) {
        patchExistingNode(item, existing, lookup, report, pendingParents, keyToId, rows)
        continue
      }
      if (item.key && keyToId.has(item.key)) {
        report.error(`节点 ${item.key}`, 'key 重复')
        continue
      }
      const data = buildExecData(item, lookup, report, args.defaults)
      if (!data) continue
      const id = newId()
      const node = { id, type: 'default', position: { ...(existing.position ?? { x: 0, y: 0 }) }, data }
      if (existing.sourcePosition) node.sourcePosition = existing.sourcePosition
      if (existing.targetPosition) node.targetPosition = existing.targetPosition
      if (existing.parentNode) {
        node.parentNode = existing.parentNode
        if (existing.extent) node.extent = existing.extent
      }
      flow.nodes = flow.nodes.filter(entry => entry.id !== existing.id)
      flow.nodes.push(node)
      rewireNodeId(flow, existing.id, id)
      if (isObject(flow.errors)) delete flow.errors[existing.id]
      baseIds.add(id)
      if (item.key) keyToId.set(item.key, id)
      keyToId.set(existing.id, id)
      order.push(id)
      if (item.parent !== undefined) pendingParents.push({ node, parent: item.parent })
      switched.push(node)
      rows.push([item.key ?? existing.id, id, `${data.name}（切换）`, data.summary ?? ''])
      continue
    }
    if (item.id && !item.name && !item.group && item.comment === undefined && !existing) {
      report.error(`节点 ${item.id}`, '没写 name，又不是 --base 画布里已有的节点 id')
      continue
    }
    if (!item.key) {
      report.error('nodes', `新节点要写 key（spec 内引用用）: ${JSON.stringify(item).slice(0, 80)}`)
      continue
    }
    if (keyToId.has(item.key)) {
      report.error(`节点 ${item.key}`, 'key 重复')
      continue
    }
    const id = item.id && !taken.has(item.id) ? (taken.add(item.id), item.id) : newId()
    let node
    if (item.group !== undefined) node = groupNode(item, id)
    else if (item.comment !== undefined) node = commentNode(item, id)
    else if (item.name) {
      const { bundleName } = splitBundle(item.bundle)
      const same = removedExec.filter(entry => entry.name === item.name && entry.bundleName === bundleName)
      if (same.length) {
        report.error(`节点 ${item.key}`,
          `类型没变（${bundleName} ${item.name}），不要 remove ${same.map(entry => entry.id).join('、')} 后再新建。把旧 id 写到这个节点上`)
        continue
      }
      const data = buildExecData(item, lookup, report, args.defaults)
      if (!data) continue
      node = { id, type: 'default', position: { x: 0, y: 0 }, data }
    } else {
      report.error(`节点 ${item.key}`, '要写 name（执行节点）、group（分组框）或 comment（批注）之一')
      continue
    }
    flow.nodes.push(node)
    keyToId.set(item.key, id)
    order.push(id)
    if (item.parent !== undefined) pendingParents.push({ node, parent: item.parent })
    rows.push([item.key, id, node.data.name, node.data.summary ?? ''])
  }

  const byId = new Map(flow.nodes.map(node => [node.id, node]))
  const resolve = ref => keyToId.get(ref) ?? (byId.has(ref) ? ref : null)
  for (const { node, parent } of pendingParents) {
    if (parent === null || parent === '') {
      delete node.parentNode
      delete node.extent
      continue
    }
    const parentId = resolve(parent)
    if (!parentId || byId.get(parentId)?.type !== 'group') {
      report.error(`节点 ${node.id}`, `parent ${parent} 不是分组框的 key / id`)
      continue
    }
    node.parentNode = parentId
    if (!DECORATION_TYPES.has(node.type)) node.extent = 'parent'
  }

  const edgeById = new Map(flow.edges.map(edge => [edge.id, edge]))
  for (const raw of spec.edges ?? []) {
    const edge = normalizeEdge(raw)
    const alias = macro.aliases.get(edge.from)
    if (alias && edge.to !== alias && (!edge.out || edge.out.every(name => name === 'Success'))) edge.from = alias
    const where = `边 ${edge.from} → ${edge.to}`
    const source = resolve(edge.from)
    const target = resolve(edge.to)
    if (!source || !target) {
      report.error(where, `${!source ? edge.from : edge.to} 不是 spec 里的 key，也不是已有节点 id`)
      continue
    }
    const sourceNode = byId.get(source)
    const targetNode = byId.get(target)
    if ([sourceNode, targetNode].some(node => node.type === 'group' || DECORATION_TYPES.has(node.type))) {
      report.error(where, '边只连执行节点，不连分组框或批注')
      continue
    }
    const { schema, custom } = relationSchema(sourceNode, lookup)
    const pool = [...(schema ?? []), ...custom]
    if (!pool.length) {
      report.error(where, `源节点 ${sourceNode.data?.name ?? source} 没有出口目录，先 catalog.mjs fetch 这个节点`)
      continue
    }
    const names = edge.out ?? [pool.some(item => item.name === 'Success') ? 'Success' : pool[0].name]
    const id = `${source}_${target}`
    const kept = edgeById.get(id)
    const relations = kept ? kept.data.relations : []
    for (const name of names) {
      const known = pool.find(item => item.name === name)
      if (!known) {
        report.error(where, `出口 ${name} 不在 ${sourceNode.data?.name} 的出口目录里（可用: ${pool.map(item => item.name).join(' / ')}）`)
        continue
      }
      if (relations.some(item => item.name === name)) continue
      const relation = clone(known)
      if (edge.description[name]) relation.description = String(edge.description[name])
      relations.push(relation)
    }
    if (!relations.length) continue
    if (kept) continue
    const created = { id, type: 'default', source, target, data: { relations }, label: '', zIndex: 2000 }
    flow.edges.push(created)
    edgeById.set(id, created)
  }

  for (const node of switched) {
    const { schema, custom } = relationSchema(node, lookup)
    const pool = [...(schema ?? []), ...custom]
    const allowed = new Set(pool.map(item => item.name))
    for (const edge of flow.edges.filter(entry => entry.source === node.id)) {
      const relations = Array.isArray(edge.data?.relations) ? edge.data.relations : []
      edge.data.relations = relations.filter(rel => allowed.has(rel.name))
      if (!edge.data.relations.length) {
        report.error(`边 ${edge.source} → ${edge.target}`,
          `切换成 ${node.data.name} 后没有可用出口（可用: ${pool.map(item => item.name).join(' / ') || '无'}）；在 spec.edges 里用旧 id 写上新出口`)
      }
    }
  }

  for (const edge of flow.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (source?.data?.name !== 'JsFunctionNode' || !target?.data?.parameters) continue
    if (JSON.stringify(target.data.parameters).includes('msg.output')) {
      report.warn(`节点 ${target.id}（${target.data.summary ?? target.data.name}）`,
        `上游是 JsFunctionNode，它的返回值就是整个 msg，没有 output 这一层；取它返回的字段写 msg.xxx，不是 msg.output.xxx`)
    }
  }

  if (!report.items.some(item => item.level === 'ERROR')) {
    const unused = new Set(wireErrorTargets(macro, keyToId, flow, byId, edgeById, lookup))
    if (unused.size) {
      flow.nodes = flow.nodes.filter(node => !unused.has(node.id))
      for (let i = rows.length - 1; i >= 0; i--) if (unused.has(rows[i][1])) rows.splice(i, 1)
      for (let i = order.length - 1; i >= 0; i--) if (unused.has(order[i])) order.splice(i, 1)
    }
    lintUnanswered(flow, byId, lookup, report)
  }
  lintWrites(flow, report)

  for (const node of flow.nodes) {
    if (node.type !== 'group' || baseIds.has(node.id)) continue
    if (!flow.nodes.some(child => child.parentNode === node.id)) report.warn(`分组 ${node.id}`, '框里没有节点，组内节点要写 parent')
  }

  flow.direction = ['TB', 'LR'].includes(spec.direction) ? spec.direction : (['TB', 'LR'].includes(flow.direction) ? flow.direction : 'TB')
  if (!isObject(flow.errors)) flow.errors = {}
  if (!flow.viewport) flow.viewport = { x: 0, y: 0, zoom: 1 }
  if (!report.items.some(item => item.level === 'ERROR')) {
    assignSegmentOrigins(flow.nodes, flow.edges, order, flow.direction, baseIds)
  }
  return finish(report, { flow, rows }, args)
}

function finish(report, result, args) {
  for (const item of report.items) process.stdout.write(`${item.level} ${item.where}: ${item.message}\n`)
  const errors = report.items.filter(item => item.level === 'ERROR').length
  if (errors || !result) {
    process.stdout.write(`build: ${errors} 个 ERROR，没有写文件。改 spec 后重跑。\n`)
    process.exit(1)
  }
  const { flow, rows } = result
  writeFileSync(args.out, `${JSON.stringify(flow, null, 2)}\n`)
  const width = Math.max(3, ...rows.map(row => String(row[0]).length))
  process.stdout.write(`${rows.map(([key, id, name, summary]) => `${String(key).padEnd(width)}  ${id}  ${name}  ${summary}`).join('\n')}\n`)
  process.stdout.write(`build: ${flow.nodes.length} 个节点，${flow.edges.length} 条边，`
    + `${report.items.length} 个 WARNING，已写入 ${args.out}\n`)
  if (args.layout) {
    try {
      execFileSync(process.execPath, [join(HERE, 'layout.mjs'), args.out], { stdio: 'inherit' })
    } catch (error) {
      process.exit(error.status ?? 3)
    }
  }
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
