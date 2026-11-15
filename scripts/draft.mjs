#!/usr/bin/env node
/**
 * 把 get-draft 的输出整理成「spec 视图」，改已有流程时看它写 --base spec，不用读原始画布 JSON。
 *
 *   buildify --json workflow get-draft -p P -w W > draft.json
 *   node scripts/draft.mjs draft.json [--node <id 或 summary>] [--full] [-o canvas.json] [--dir DIR] [--profile NAME]
 *
 * 默认输出：
 *   - 流程名、方向、节点数和边数、顶层 errors
 *   - 每个执行节点一行：id、包、类型、summary、所在分组；下面列「和表单默认值不同」的参数
 *     （目录缓存里有这个节点时才能比较，没有缓存就列全部参数），长文本（代码、SQL）截断，凭证写成 槽=类型/名称
 *   - 分组框、批注各一行
 *   - 边写成 spec 的形式 ["源 id", "目标 id", "出口,出口"]，后面带两端的 summary
 * --node   打印这一颗节点的完整 parameters（JSON），改代码或 SQL 时用
 * --full   参数不截断
 * -o FILE  另存纯画布（去掉 get-draft 外层），可直接给 build.mjs --base 或 check.mjs 用
 *
 * 退出码：0 成功；3 文件或参数错误。
 */
import { writeFileSync } from 'node:fs'
import { CatalogError, catalogDir, loadNodeFile, profilesWithCache, readJsonFile, unwrap } from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'

const USAGE = 'usage: node scripts/draft.mjs draft.json [--node ID] [--full] [-o canvas.json] [--dir DIR] [--profile NAME]\n'
const DECORATION_TYPES = new Set(['text', 'comment', 'notes'])
const CLIP = 80

function fail(message, code = 3) {
  process.stderr.write(`draft: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { file: null, node: null, full: false, out: null, dir: null, profile: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '--node' || arg === '-n') args.node = value()
    else if (arg === '--full') args.full = true
    else if (arg === '-o' || arg === '--out') args.out = value()
    else if (arg === '--dir') args.dir = value()
    else if (arg === '--profile') args.profile = value()
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else if (!args.file) args.file = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.file) fail(`缺少 draft.json。${USAGE}`)
  args.explicitDir = Boolean(args.dir)
  args.dir = catalogDir(args.dir, args.profile)
  return args
}

function readDraft(file) {
  const payload = readJsonFile(file, '草稿')
  if (payload?.ok === false) fail(`${file} 是失败的返回: ${payload.msg ?? ''}`)
  const data = unwrap(payload, file)
  let canvas = data?.workflowJson !== undefined ? data.workflowJson : data
  if (typeof canvas === 'string') {
    try {
      canvas = JSON.parse(canvas)
    } catch (error) {
      fail(`${file} 的 workflowJson 不是合法 JSON: ${error.message}`)
    }
  }
  if (!Array.isArray(canvas?.nodes)) fail(`${file} 里没有画布 nodes 数组`)
  if (!Array.isArray(canvas.edges)) canvas.edges = []
  return { meta: data?.workflowJson !== undefined ? data : {}, canvas }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function clip(value, full) {
  const text = JSON.stringify(value)
  if (full || text.length <= CLIP) return text
  if (typeof value !== 'string') {
    return text.length <= CLIP * 2 ? text : `${text.slice(0, CLIP * 2)}…（共 ${text.length} 字，--node 看全部）`
  }
  return `${JSON.stringify(value.replace(/\s+/g, ' ').slice(0, CLIP))}…（共 ${value.length} 字，--node 看全部）`
}

function changedParameters(node, dir) {
  const data = node.data ?? {}
  const parameters = data.parameters ?? {}
  const slots = new Set(Object.keys(data.credentials ?? {}))
  const properties = data.bundleName && data.name && data.bundleVersion
    ? loadNodeFile(dir, data.bundleName, data.bundleVersion, data.name, 'properties')
    : null
  const defaults = properties?.schema?.defaultValue ?? null
  const entries = Object.entries(parameters).filter(([key, value]) => {
    if (slots.has(key)) return false
    if (defaults && Object.hasOwn(defaults, key) && same(defaults[key], value)) return false
    return !(value === '' || value == null)
  })
  return { entries, compared: properties != null }
}

function label(node) {
  return node?.data?.summary || node?.data?.label || node?.data?.name || node?.type || '?'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const { meta, canvas } = readDraft(args.file)
  const byId = new Map(canvas.nodes.map(node => [node.id, node]))

  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(canvas, null, 2)}\n`)
  }

  if (args.node) {
    const node = byId.get(args.node) ?? canvas.nodes.find(item => item.data?.summary === args.node)
      ?? canvas.nodes.find(item => String(item.data?.summary ?? '').includes(args.node))
    if (!node) fail(`没有节点 ${args.node}`)
    process.stdout.write(`${node.id}  ${node.data?.bundleName ?? ''} ${node.data?.name ?? node.type}  「${label(node)}」\n`)
    process.stdout.write(`${JSON.stringify(node.data?.parameters ?? {}, null, 2)}\n`)
    if (node.data?.credentials) process.stdout.write(`credentials: ${JSON.stringify(node.data.credentials)}\n`)
    return
  }

  const exec = canvas.nodes.filter(node => node.type !== 'group' && !DECORATION_TYPES.has(node.type) && node.data?.isLayoutNode !== true)
  const groups = canvas.nodes.filter(node => node.type === 'group')
  const comments = canvas.nodes.filter(node => DECORATION_TYPES.has(node.type))
  const lines = []
  const name = meta.workflowName ? `流程「${meta.workflowName}」${meta.workflowId ? ` ${meta.workflowId}` : ''}；` : ''
  lines.push(`${name}方向 ${canvas.direction ?? 'TB'}；${exec.length} 个执行节点，${canvas.edges.length} 条边`
    + `${groups.length ? `，${groups.length} 个分组` : ''}${comments.length ? `，${comments.length} 个批注` : ''}`)
  const errors = Object.entries(canvas.errors ?? {}).filter(([, count]) => count)
  if (errors.length) lines.push(`errors: ${errors.map(([id, count]) => `${id}（${label(byId.get(id))}）${count}`).join('，')}`)

  const uncompared = []
  lines.push('', '节点（参数只列和表单默认值不同的键）:')
  for (const node of exec) {
    const data = node.data ?? {}
    const parent = node.parentNode ? `  [分组 ${node.parentNode}「${label(byId.get(node.parentNode))}」]` : ''
    lines.push(`- ${node.id}  ${data.bundleName ?? '?'} ${data.name ?? '?'}  「${data.summary ?? ''}」${data.isTrigger ? '  触发器' : ''}`
      + `${data.disabled ? '  已停用' : ''}${parent}`)
    const { entries, compared } = changedParameters(node, args.dir)
    if (!compared) uncompared.push(data)
    for (const [key, value] of entries) lines.push(`    ${key} = ${clip(value, args.full)}`)
    for (const [slot, value] of Object.entries(data.credentials ?? {})) {
      lines.push(`    凭证 ${slot} = ${value?.type ?? '?'}/${value?.name ?? '?'}`)
    }
  }
  for (const node of groups) lines.push(`- ${node.id}  分组「${node.data?.parameters?.groupLabel ?? label(node)}」`)
  for (const node of comments) {
    const text = String(node.data?.parameters?.commentMarkdown ?? '')
    lines.push(`- ${node.id}  批注（${text.length} 字）${text ? `：${text.replace(/\s+/g, ' ').slice(0, 30)}…` : ''}`)
  }

  lines.push('', '边（spec 写法）:')
  for (const edge of canvas.edges) {
    const outs = (edge.data?.relations ?? []).map(rel => rel?.name).filter(Boolean).join(',')
    lines.push(`  ["${edge.source}", "${edge.target}", "${outs}"]  # ${label(byId.get(edge.source))} → ${label(byId.get(edge.target))}`)
  }
  if (uncompared.length) {
    const profiles = args.profile || args.explicitDir ? [] : [...new Set(uncompared.flatMap(data => (
      data.bundleName && data.name && data.bundleVersion ? profilesWithCache(data.bundleName, data.bundleVersion, data.name) : []
    )))]
    lines.push('', `有 ${uncompared.length} 个节点的目录不在缓存里，列的是全部参数；`
      + (profiles.length
        ? `缓存在 --profile ${profiles.join(' / ')} 下，加上它重跑（之后每个脚本都要带）。`
        : '先 catalog.mjs fetch 这些节点可以只看改过的键。'))
  }
  if (args.out) lines.push(`已另存纯画布到 ${args.out}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

try {
  main()
} catch (error) {
  fail(error instanceof CatalogError ? error.message : error.stack)
}
