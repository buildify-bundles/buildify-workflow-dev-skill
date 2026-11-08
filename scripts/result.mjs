#!/usr/bin/env node
/**
 * 把 validate / test-run / deploy 的 --json 输出整理成几行要点，不用把整份响应读进对话。
 *
 *   node scripts/result.mjs validate validate.json [--flow flow.json] [--write-errors]
 *   node scripts/result.mjs test-run test-run.json [--flow flow.json] [--node <id 或 summary>] [--path output.body] [--max 2000]
 *   node scripts/result.mjs deploy   deploy.json
 *
 * validate：列出 issues（带节点 summary），按节点汇总表单 ERROR。加 --write-errors 时写回 flow.json 顶层 errors
 *           （环不计入）。只剩环时提醒核对退出条件。
 * test-run：success / reason、每个节点的状态和出口、没执行到的节点；失败节点打印 msg.error 和截断后的输出。
 *           --node 打印这个节点的输出 payload，--path 取其中一段（相对 payload，如 output.body.daily）。
 * deploy：版本号、发布说明、总体状态和每台服务器的结果，直接照 report.md 画表。
 *
 * 退出码：0 通过（validate 只剩环也算）；1 validate 还有 ERROR / 试跑没通过 / 发布没成功；3 文件或参数错误。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const USAGE = 'usage: node scripts/result.mjs validate|test-run|deploy FILE [--flow flow.json] [--write-errors] [--node ID] [--path a.b] [--max N]\n'
const CYCLE = /环|cycle/i

function fail(message, code = 3) {
  process.stderr.write(`result: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { command: argv[0], file: null, flow: null, writeErrors: false, node: null, path: null, max: 2000 }
  if (args.command === '-h' || args.command === '--help') {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (!['validate', 'test-run', 'deploy'].includes(args.command)) fail(`第一个参数要是 validate、test-run 或 deploy。${USAGE}`)
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '--flow' || arg === '-f') args.flow = value()
    else if (arg === '--write-errors') args.writeErrors = true
    else if (arg === '--node' || arg === '-n') args.node = value()
    else if (arg === '--path') args.path = value()
    else if (arg === '--max') args.max = Number(value()) || 2000
    else if (!args.file) args.file = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.file) fail(`缺少结果文件。${USAGE}`)
  if (args.writeErrors && !args.flow) fail('--write-errors 要和 --flow flow.json 一起用')
  return args
}

function readJson(file, what) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`读不到${what} ${file}: ${error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${what} ${file} 不是合法 JSON（命令是否加了 --json、输出是否重定向到了文件）: ${error.message}`)
  }
}

function envelope(payload, what) {
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    if (payload.ok === false || payload.data == null) {
      const reason = payload.data?.reason ? `（${payload.data.reason}）` : ''
      process.stdout.write(`${what}失败${reason}: ${payload.msg ?? ''}（HTTP ${payload.http_status ?? '?'}）\n`)
      if (payload.data && typeof payload.data === 'object') process.stdout.write(`${truncate(payload.data, 1500)}\n`)
      process.exit(1)
    }
    return payload.data
  }
  return payload
}

function truncate(value, max) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (text == null) return String(value)
  return text.length > max ? `${text.slice(0, max)}\n…（共 ${text.length} 字符，已截断；用 --path 取一段或加大 --max）` : text
}

function pick(value, path) {
  if (!path) return value
  let current = value
  for (const part of path.replace(/^msg\./, '').split('.').filter(Boolean)) {
    if (current == null) return undefined
    current = Array.isArray(current) && /^\d+$/.test(part) ? current[Number(part)] : current[part]
  }
  return current
}

function loadFlow(file) {
  if (!file) return null
  const flow = readJson(file, '画布')
  if (!Array.isArray(flow?.nodes)) fail(`${file} 顶层没有 nodes 数组`)
  return flow
}

function nodeName(flow, id) {
  const node = flow?.nodes.find(item => item.id === id)
  if (!node) return id
  return `${id}（${node.data?.summary || node.data?.label || node.data?.name || node.type}）`
}

// ---------------------------------------------------------------------------

function validate(args) {
  const data = envelope(readJson(args.file, '校验结果'), 'workflow validate ')
  const flow = loadFlow(args.flow)
  const issues = Array.isArray(data.issues) ? data.issues : []
  const errors = issues.filter(item => item.level === 'ERROR')
  const cycles = errors.filter(item => CYCLE.test(item.message ?? ''))
  const blocking = errors.filter(item => !cycles.includes(item))
  const warnings = issues.filter(item => item.level !== 'ERROR')

  for (const item of issues) {
    const where = item.nodeId ? nodeName(flow, item.nodeId) : '画布'
    process.stdout.write(`${item.level} ${where}${item.path ? ` ${item.path}` : ''}: ${item.message}\n`)
  }

  const counts = {}
  for (const item of blocking) if (item.nodeId) counts[item.nodeId] = (counts[item.nodeId] ?? 0) + 1
  process.stdout.write(`validate: ${blocking.length} 个 ERROR${cycles.length ? `，${cycles.length} 个环` : ''}，${warnings.length} 个 WARNING；`
    + `errors = ${JSON.stringify(counts)}\n`)
  if (cycles.length && !blocking.length) {
    process.stdout.write('只剩环：确认环上至少有一条离开循环的边（If / Switch 另一支、失败出口、次数用尽、超时）。有就照常保存试跑，没有就补退出条件。\n')
  }
  if (warnings.length) process.stdout.write('WARNING 也要修：图标、出口 label、自定义出口 icon / _id 从目录补齐（check.mjs --fix 能补）。\n')

  if (args.writeErrors) {
    const before = JSON.stringify(flow.errors ?? null)
    flow.errors = counts
    if (JSON.stringify(counts) !== before) {
      writeFileSync(args.flow, `${JSON.stringify(flow, null, 2)}\n`)
      process.stdout.write(`已把 errors 写回 ${args.flow}\n`)
    } else process.stdout.write(`${args.flow} 的 errors 已是最新\n`)
  }
  process.exit(blocking.length ? 1 : 0)
}

// ---------------------------------------------------------------------------

function testRun(args) {
  const data = envelope(readJson(args.file, '试跑结果'), 'workflow test-run ')
  const flow = loadFlow(args.flow)
  const nodes = Array.isArray(data.nodes) ? data.nodes : []

  if (args.node) {
    const target = nodes.find(item => item.nodeId === args.node)
      ?? nodes.find(item => nodeName(flow, item.nodeId).includes(args.node))
    if (!target) fail(`试跑结果里没有节点 ${args.node}（执行到的: ${nodes.map(item => nodeName(flow, item.nodeId)).join(', ')}）`)
    const outputs = Array.isArray(target.outputs) ? target.outputs : []
    process.stdout.write(`${nodeName(flow, target.nodeId)} ${target.status}，${outputs.length} 条输出\n`)
    outputs.forEach((output, index) => {
      const value = pick(output.payload, args.path)
      const keys = output.payload && typeof output.payload === 'object' ? Object.keys(output.payload).join(', ') : ''
      const body = value === undefined ? `没有 ${args.path}。payload 根级字段: ${keys}` : truncate(value, args.max)
      process.stdout.write(`--- #${index + 1} 出口 ${output.relation ?? '?'}${args.path ? ` ${args.path}` : ''}\n${body}\n`)
    })
    return
  }

  const success = data.success === true && data.reason !== 'timeout'
  process.stdout.write(`test-run: success=${data.success} reason=${data.reason ?? '-'}${data.executionId ? ` executionId=${data.executionId}` : ''}\n`)
  const failed = []
  for (const item of nodes) {
    const outputs = Array.isArray(item.outputs) ? item.outputs : []
    const relations = [...new Set(outputs.map(output => output.relation).filter(Boolean))]
    process.stdout.write(`- ${nodeName(flow, item.nodeId)}: ${item.status}${relations.length ? ` → ${relations.join(', ')}` : ''}`
      + `${outputs.length > 1 ? `（${outputs.length} 条）` : ''}\n`)
    const bad = item.status !== 'completed' || relations.some(name => /fail|error/i.test(name)) || outputs.some(output => output.payload?.error)
    if (bad) failed.push(item)
  }
  if (flow) {
    const ran = new Set(nodes.map(item => item.nodeId))
    const skipped = flow.nodes.filter(node => node.type !== 'group' && !['comment', 'notes', 'text'].includes(node.type)
      && node.data?.isLayoutNode !== true && !ran.has(node.id))
    if (skipped.length) process.stdout.write(`没执行到: ${skipped.map(node => nodeName(flow, node.id)).join(', ')}\n`)
  }
  for (const item of failed) {
    const output = (item.outputs ?? []).find(entry => entry.payload?.error) ?? (item.outputs ?? [])[0]
    const payload = output?.payload
    process.stdout.write(`\n### ${nodeName(flow, item.nodeId)} ${item.status}${output?.relation ? ` → ${output.relation}` : ''}\n`)
    if (payload?.error) process.stdout.write(`error: ${truncate(payload.error, 800)}\n`)
    if (payload?.output !== undefined) process.stdout.write(`output: ${truncate(payload.output, 800)}\n`)
    if (!payload) process.stdout.write(`${truncate(item, 800)}\n`)
  }
  const errorEvents = (Array.isArray(data.events) ? data.events : []).filter(event => /error|fail/i.test(event.action ?? ''))
  for (const event of errorEvents.slice(0, 5)) process.stdout.write(`event ${event.action}: ${truncate(event.data, 600)}\n`)
  if (!success) process.stdout.write(data.reason === 'timeout' ? '\n试跑超时：用 workflow cancel-test 停掉 worker 上的执行。\n' : '\n试跑没通过。\n')
  process.exit(success ? 0 : 1)
}

// ---------------------------------------------------------------------------

function deploy(args) {
  const data = envelope(readJson(args.file, '发布结果'), 'workflow deploy ')
  const summary = data.summary ?? {}
  const lines = [
    `deploy: ${data.deployStatusLabel ?? data.deployStatus ?? '?'}（${data.deployStatus ?? '?'}）`,
    `项目 ${summary.projectName ?? '?'}；流程 ${summary.workflowName ?? '?'}`,
    `版本号 ${data.versionName ?? summary.versionName ?? '?'}；发布说明 ${data.publishRemark ?? summary.publishRemark ?? '—'}`,
    `发布时间 ${data.updatedAt ?? data.createdAt ?? '?'}`,
    '服务器:',
  ]
  for (const server of summary.servers ?? []) {
    lines.push(`- ${server.workerName ?? '?'} | ${server.remark || '无描述'} | ${server.isOnline ? '在线' : '离线'} | `
      + `${server.deployStatusLabel ?? server.deployStatus ?? '?'}（${server.deployStatus ?? '?'}） | ${server.message || '—'}`)
  }
  const credentials = summary.credentials ?? []
  lines.push(credentials.length
    ? `凭证: ${credentials.map(item => `${item.bundleName} ${item.type} ${item.label ?? item.name}`).join('；')}`
    : '凭证: 未引用访问凭证')
  process.stdout.write(`${lines.join('\n')}\n状态符号按 report.md「状态映射」，不要把响应里的 emoji 贴进表格。\n`)
  process.exit(data.deployStatus === 'success' || data.deployStatus === 'warning' ? 0 : 1)
}

const args = parseArgs(process.argv.slice(2))
if (args.command === 'validate') validate(args)
else if (args.command === 'test-run') testRun(args)
else deploy(args)
