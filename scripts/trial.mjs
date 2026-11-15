#!/usr/bin/env node
/**
 * 步骤 9 试跑一次跑完，输出 result.mjs 的摘要。
 *
 *   node scripts/trial.mjs flow.json -p P --worker WKR [-w W] [--timeout 60] [--profile NAME]
 *        [--base URL] [--request JSON] [--invalid JSON | --no-invalid] [--header "Name: value"]… [--manual]
 *
 * 普通流程（定时、手动等）：直接 test-run，结果存 flow.json 同目录的 test-run.json。
 *
 * HTTP 流程（画布里有 WebhookTriggerNode）：
 *   1. 环境预检：参数里写了 localhost / 127.0.0.1 / 内网地址时提示——它指的是服务器本机，不是你的电脑。
 *   2. 访问地址：按这台服务器在 project workers 里的 accessUrls 顺序（旧版 CLI 是 externalHost / publicIp / httpPort）
 *      逐个测连接（任何 HTTP 状态码都算通）。--base 指定时只测它。都不通：列出原因，退出 5，不试跑。
 *   3. 后台起 test-run，向 BASE + /@test + 触发器 path 发正常请求。请求默认按触发器和 ValidateNode 规则生成
 *      （路径参数、必填字段填示例值）；--request '{"path":"/orders/1","query":{},"body":{},"headers":{}}' 覆盖。
 *   4. 画布里有 ValidateNode 时再试跑一次，发一条不合法请求（缺第一个必填字段或路径参数换成 abc），
 *      检查是否走了 Invalid、下游没执行。--invalid 指定这条请求，--no-invalid 跳过。
 *   触发器开了入站认证：用 --header 传用户提供的认证头；没有就加 --manual，脚本打印测试地址并等用户自己调用。
 *   不要猜密钥，也不要从凭证里取明文。
 *
 * 流程里有写库、发消息、调外部接口的节点时，试跑会真的执行，跑之前先和用户确认用测试数据还是真实环境。
 *
 * 退出码：0 试跑通过（有不合法请求时也已被拦下）；1 试跑没通过或不合法请求没被拦下；
 *         5 访问地址都不通（问用户：填地址 / 重新检测 / 换服务器 / 只保存草稿）；3 参数或 CLI 错误。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CatalogError, runCliPayload } from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'
import { out, runScript, writeJson } from './lib/run.mjs'

const USAGE = 'usage: node scripts/trial.mjs flow.json -p P --worker WKR [-w W] [--timeout 60] [--profile NAME] [--base URL] [--request JSON] [--invalid JSON|--no-invalid] [--header "K: V"] [--manual]\n'
const LOCAL_HOST = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/

function fail(message, code = 3) {
  process.stderr.write(`trial: ${message}\n`)
  process.exit(code)
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${what} 不是合法 JSON: ${error.message}`)
  }
}

function parseArgs(argv) {
  const args = {
    flow: null, project: null, worker: null, workflow: null, timeout: 60, profile: null, base: null,
    request: null, invalid: null, noInvalid: false, headers: {}, manual: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '-p' || arg === '--project') args.project = value()
    else if (arg === '--worker') args.worker = value()
    else if (arg === '-w' || arg === '--flow') args.workflow = value()
    else if (arg === '--timeout') args.timeout = Number(value()) || 60
    else if (arg === '--profile') args.profile = value()
    else if (arg === '--base') args.base = value().replace(/\/+$/, '')
    else if (arg === '--request') args.request = parseJson(value(), '--request')
    else if (arg === '--invalid') args.invalid = parseJson(value(), '--invalid')
    else if (arg === '--no-invalid') args.noInvalid = true
    else if (arg === '--manual') args.manual = true
    else if (arg === '--header') {
      const raw = value()
      const at = raw.indexOf(':')
      if (at < 1) fail('--header 写成 "Name: value"')
      args.headers[raw.slice(0, at).trim()] = raw.slice(at + 1).trim()
    } else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else if (!args.flow) args.flow = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.flow || !args.project || !args.worker) fail(`要有 flow.json、-p 和 --worker。${USAGE}`)
  if (!existsSync(args.flow)) fail(`找不到 ${args.flow}`)
  return args
}

const sleep = ms => new Promise(done => setTimeout(done, ms))

// ---------------------------------------------------------------------------
// 画布分析
// ---------------------------------------------------------------------------

function localHostWarnings(flow) {
  const hits = []
  for (const node of flow.nodes) {
    const text = JSON.stringify(node.data?.parameters ?? {})
    const match = LOCAL_HOST.exec(text)
    if (match) hits.push(`${node.data?.summary || node.data?.name}（${match[1]}）`)
  }
  return hits
}

const SAMPLE = { string: 'test', number: 1, integer: 1, boolean: true, array: [], object: {} }

/** 按 ValidateNode 规则给字段一个能通过的示例值。 */
function sampleFor(rules) {
  const find = check => rules.find(rule => rule.check === check)
  const oneOf = find('oneOf')?.oneOf
  if (oneOf) return String(oneOf).split(/[\n,]/)[0].trim()
  const type = find('type')?.typeName
  const pattern = find('pattern')?.pattern
  if (pattern && /\\d|\[0-9\]/.test(pattern)) return type === 'number' || type === 'integer' ? 1 : '1'
  const min = find('min')?.min
  if (min != null && min !== '') return Number(min)
  const minLength = Number(find('minLength')?.minLength) || 0
  if (type && type !== 'string') return SAMPLE[type]
  return 'test'.padEnd(Math.max(4, minLength), 'x')
}

function setPath(target, path, value) {
  const parts = path.split('.')
  let current = target
  for (const part of parts.slice(0, -1)) current = current[part] ??= {}
  current[parts.at(-1)] = value
}

function analyse(flow) {
  const trigger = flow.nodes.find(node => node.data?.name === 'WebhookTriggerNode')
  if (!trigger) return null
  const params = trigger.data.parameters ?? {}
  const methods = [].concat(params.methods ?? ['GET'])
  const validators = flow.nodes.filter(node => node.data?.name === 'ValidateNode')
  const rules = validators.flatMap(node => (node.data.parameters?.rules ?? []).filter(rule => rule?.field))
  const byField = new Map()
  for (const rule of rules) {
    if (!byField.has(rule.field)) byField.set(rule.field, [])
    byField.get(rule.field).push(rule)
  }
  return { trigger, path: String(params.path ?? '/'), method: methods[0], authType: params.authType ?? 'none', validators, byField }
}

function defaultRequest(info) {
  const request = { pathParams: {}, query: {}, body: {}, headers: {} }
  for (const [field, rules] of info.byField) {
    if (!rules.some(rule => ['required', 'notBlank'].includes(rule.check)) && rules.every(rule => rule.skipIfMissing)) continue
    const [root, ...rest] = field.split('.')
    if (!['pathParams', 'query', 'body', 'headers'].includes(root) || !rest.length) continue
    setPath(request[root], rest.join('.'), sampleFor(rules))
  }
  for (const [, name] of info.path.matchAll(/:([A-Za-z0-9_]+)/g)) request.pathParams[name] ??= '1'
  return request
}

function invalidRequest(info, valid) {
  const request = JSON.parse(JSON.stringify(valid))
  for (const [field, rules] of info.byField) {
    const [root, ...rest] = field.split('.')
    if (root === 'pathParams' && rules.some(rule => rule.check === 'pattern')) {
      request.pathParams[rest.join('.')] = 'abc'
      return { request, why: `路径参数 ${rest.join('.')} 换成 abc` }
    }
    if (rules.some(rule => rule.check === 'required') && ['query', 'body'].includes(root)) {
      let current = request[root]
      for (const part of rest.slice(0, -1)) current = current?.[part]
      if (current) delete current[rest.at(-1)]
      return { request, why: `去掉必填字段 ${field}` }
    }
  }
  return null
}

function buildUrl(base, info, request) {
  const path = (request.path ?? info.path).replace(/:([A-Za-z0-9_]+)/g, (_, name) => encodeURIComponent(String(request.pathParams?.[name] ?? '1')))
  const query = new URLSearchParams(Object.entries(request.query ?? {}).map(([key, value]) => [key, String(value)])).toString()
  return `${base}/@test${path.startsWith('/') ? '' : '/'}${path}${query ? `?${query}` : ''}`
}

// ---------------------------------------------------------------------------
// 访问地址
// ---------------------------------------------------------------------------

function candidates(worker) {
  const list = []
  const add = url => {
    if (url && !list.includes(url)) list.push(url)
  }
  if (Array.isArray(worker?.accessUrls)) {
    for (const url of worker.accessUrls) add(String(url).trim().replace(/\/+$/, ''))
    return list
  }
  const external = String(worker?.externalHost ?? '').trim()
  const port = worker?.httpPort
  let protocol = 'http'
  let host = external
  let explicitPort = null
  if (external) {
    const match = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(external)
    if (match) [, protocol, host, explicitPort] = match
    else {
      const [onlyHost, onlyPort] = external.split(':')
      host = onlyHost
      explicitPort = onlyPort ?? null
    }
  }
  const defaultPort = protocol === 'https' ? '443' : '80'
  const usePort = explicitPort ?? (port ? String(port) : null)
  const url = (h, p) => `${protocol}://${h}${p && p !== defaultPort ? `:${p}` : ''}`
  if (host) add(url(host, usePort))
  if (worker?.publicIp && worker.publicIp !== host) add(url(worker.publicIp, usePort))
  if (usePort && usePort !== defaultPort) add(url(worker?.publicIp || host, defaultPort))
  return list
}

async function probe(url) {
  try {
    const response = await fetch(`${url}/`, { method: 'GET', signal: AbortSignal.timeout(8000), redirect: 'manual' })
    return { ok: true, detail: `HTTP ${response.status}` }
  } catch (error) {
    const code = error?.cause?.code ?? error?.name ?? 'ERROR'
    const why = { ECONNREFUSED: '连接被拒绝', ENOTFOUND: '域名解析失败', TimeoutError: '连接超时', UND_ERR_CONNECT_TIMEOUT: '连接超时',
      ECONNRESET: '连接被重置', EHOSTUNREACH: '主机不可达' }[code] ?? code
    return { ok: false, detail: why }
  }
}

// ---------------------------------------------------------------------------
// 试跑
// ---------------------------------------------------------------------------

function testRunArgs(args) {
  return ['workflow', 'test-run', '-p', args.project, '-f', args.flow, '--worker', args.worker, '--timeout', String(args.timeout),
    ...(args.workflow ? ['-w', args.workflow] : [])]
}

async function send(url, info, request, headers) {
  const method = (request.method ?? info.method).toUpperCase()
  const hasBody = !['GET', 'HEAD'].includes(method) && request.body && Object.keys(request.body).length
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(request.headers ?? {}), ...headers },
        body: hasBody ? JSON.stringify(request.body) : undefined,
        signal: AbortSignal.timeout(30000),
      })
      const text = await response.text()
      if (response.status === 404 && attempt < 3) {
        await sleep(2000)
        continue
      }
      const body = text.includes('消息已经接收到') ? '测试确认（消息已经接收到，业务正文看下面节点结果）' : text.replace(/\s+/g, ' ').slice(0, 300)
      return `${method} ${url} → HTTP ${response.status} ${body}`
    } catch (error) {
      if (attempt === 3) return `${method} ${url} → 请求失败 ${error?.cause?.code ?? error.message}`
      await sleep(2000)
    }
  }
  return `${method} ${url} → 一直 404，测试监听没起来`
}

async function runOnce(args, file, info, base, request) {
  const pending = runCliPayload(testRunArgs(args), args.profile)
  let sent = null
  if (info) {
    await sleep(3000)
    const url = buildUrl(base, info, request)
    if (args.manual) {
      process.stdout.write(`请调用测试地址（${args.timeout} 秒内）: ${(request.method ?? info.method).toUpperCase()} ${url}\n`)
    } else sent = await send(url, info, request, args.headers)
  }
  const payload = await pending
  writeJson(file, payload)
  return { payload, sent }
}

function invalidCaught(payload, info) {
  const nodes = payload?.data?.nodes ?? []
  const ids = new Set(info.validators.map(node => node.id))
  return nodes.some(item => ids.has(item.nodeId) && (item.outputs ?? []).some(output => output.relation === 'Invalid'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const flow = JSON.parse(readFileSync(args.flow, 'utf8'))
  const folder = dirname(args.flow)
  const info = analyse(flow)
  const lines = []

  const local = localHostWarnings(flow)
  if (local.length) {
    lines.push(`环境预检: ${local.join('、')} 写的是本机或内网地址，试跑时指的是服务器 ${args.worker} 那台机器；`
      + '服务器不在这台电脑上、或那个服务没启动时会连不上。')
  }

  let base = null
  if (info) {
    if (info.authType !== 'none' && !Object.keys(args.headers).length && !args.manual) {
      out([...lines, `trial: 触发器开了入站认证（${info.authType}）。请用户提供认证头后用 --header 传入，或加 --manual 让用户自己调用测试地址。`])
      process.exit(3)
    }
    const workers = await runCliPayload(['project', 'workers', '-p', args.project], args.profile)
    const worker = (workers?.data ?? []).find(item => item.workerId === args.worker)
    if (worker && !worker.isOnline) {
      out([...lines, `trial: 服务器 ${worker.workerName} 离线，不能试跑，请换一台在线的。`])
      process.exit(5)
    }
    const list = args.base ? [args.base] : candidates(worker)
    const tried = []
    for (const url of list) {
      const result = await probe(url)
      tried.push(`${url}：${result.detail}`)
      if (result.ok) {
        base = url
        break
      }
    }
    if (!base) {
      out([...lines, list.length ? '访问地址都不通:' : '控制台还没有这台服务器的访问地址。', ...tried.map(item => `  - ${item}`),
        'trial: 没有试跑。问用户：填访问地址（--base）/ 已处理重新检测 / 换一台服务器 / 先只保存草稿。'])
      process.exit(5)
    }
    lines.push(`访问地址: ${base}${base !== list[0] ? `（控制台登记的 ${list[0]} 不通，提示用户到「节点管理」改访问地址）` : ''}`)
  }

  const request = info ? { ...defaultRequest(info), ...(args.request ?? {}) } : null
  const file = join(folder, 'test-run.json')
  const first = await runOnce(args, file, info, base, request ?? {})
  if (first.sent) lines.push(`正常请求: ${first.sent}`)
  out(lines)
  const summary = runScript('result.mjs', ['test-run', file, '--flow', args.flow])
  out(summary.output)
  if (summary.status !== 0) process.exit(1)

  if (!info || !info.validators.length || args.noInvalid || args.manual) return
  const bad = args.invalid ? { request: args.invalid, why: '按 --invalid' } : invalidRequest(info, request)
  if (!bad) return out('不合法请求: 校验规则里没有能构造反例的必填字段或格式规则，跳过。')
  const second = await runOnce(args, join(folder, 'test-run-invalid.json'), info, base, { ...request, ...bad.request })
  const caught = invalidCaught(second.payload, info)
  out([`不合法请求（${bad.why}）: ${second.sent ?? ''}`,
    caught ? '不合法请求: 已被拦下，走了 Invalid 出口。' : '不合法请求: 没有走 Invalid 出口，检查 ValidateNode 规则。'])
  process.exit(caught ? 0 : 1)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
