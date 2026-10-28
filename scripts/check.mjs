#!/usr/bin/env node
/**
 * 保存草稿前检查 flow.json 的边、出口关系和节点图标。
 *
 *   node scripts/check.mjs flow.json [--fetch [--profile NAME]] [--catalog FILE ...] [--fix] [-o out.json]
 *
 * 目录来源（可同时用）：
 *   --fetch           按画布里用到的 bundle 调 `buildify --json bundle nodes` / `bundle node-relations`
 *   --catalog FILE    读已保存的上述两条命令的 --json 输出
 * 没有目录时只做结构、格式和一致性检查，图标是否用对、出口名是否存在要靠目录才能判断。
 *
 * 退出码：0 没有 ERROR（可能有 WARNING）；1 还有 ERROR；3 文件、参数或拉目录失败。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const DECORATION_TYPES = new Set(['text', 'comment', 'notes'])
const ICON_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png|jpe?g|gif|webp)$/i

function fail(message, code = 3) {
  process.stderr.write(`check: ${message}\n`)
  process.exit(code)
}

const USAGE = 'usage: node scripts/check.mjs flow.json [--fetch [--profile NAME]] [--catalog FILE ...] [--fix] [-o out.json]\n'

function parseArgs(argv) {
  const args = { file: null, out: null, fix: false, fetch: false, profile: null, catalogs: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--fix') args.fix = true
    else if (arg === '--fetch') args.fetch = true
    else if (arg === '--profile') args.profile = argv[++i]
    else if (arg === '--catalog') args.catalogs.push(argv[++i])
    else if (arg === '-o' || arg === '--out') args.out = argv[++i]
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE)
      process.exit(0)
    } else if (!args.file) args.file = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.file) fail(`缺少 flow.json 路径。${USAGE}`)
  if (args.catalogs.some(file => !file)) fail('--catalog 后面要跟文件路径')
  if (args.profile === undefined) fail('--profile 后面要跟配置档名称')
  if (args.out && !args.fix) fail('-o 只和 --fix 一起用')
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
    fail(`${what} ${file} 不是合法 JSON: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// 目录
// ---------------------------------------------------------------------------

const nodeKey = (bundleName, name) => `${bundleName}\0${name}`

function createCatalog() {
  return { nodes: new Map(), relations: new Map(), bundles: new Set() }
}

/** 收下 `bundle nodes` 或 `bundle node-relations` 的 --json 输出（带不带外层信封都行）。 */
function addToCatalog(catalog, payload, source) {
  const data = payload && typeof payload === 'object' && 'data' in payload && 'ok' in payload ? payload.data : payload
  if (payload?.ok === false) fail(`${source} 是失败的返回: ${payload.msg ?? ''}`)
  if (Array.isArray(data?.nodes) && data.bundleName) {
    catalog.bundles.add(data.bundleName)
    for (const node of data.nodes) {
      if (!node?.name) continue
      catalog.nodes.set(nodeKey(data.bundleName, node.name), {
        icon: node.icon ?? null,
        label: node.label ?? null,
        isTrigger: node.isTrigger === true,
      })
    }
    return
  }
  if (Array.isArray(data?.schema) && data.bundleName && data.name) {
    catalog.relations.set(nodeKey(data.bundleName, data.name), data.schema)
    if (data.icon && !catalog.nodes.has(nodeKey(data.bundleName, data.name))) {
      catalog.nodes.set(nodeKey(data.bundleName, data.name), {
        icon: data.icon,
        label: data.label ?? null,
        isTrigger: null,
      })
    }
    return
  }
  fail(`${source} 不是 bundle nodes / bundle node-relations 的输出`)
}

function runCli(cliArgs, profile) {
  const argv = ['--json', ...(profile ? ['--profile', profile] : []), ...cliArgs]
  let stdout
  try {
    stdout = execFileSync('buildify', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    stdout = error.stdout
    if (!stdout) fail(`buildify ${argv.join(' ')} 执行失败: ${error.message}`)
  }
  let payload
  try {
    payload = JSON.parse(stdout)
  } catch {
    fail(`buildify ${argv.join(' ')} 输出不是 JSON`)
  }
  if (payload?.ok === false) {
    const reason = payload.data?.reason ? `（${payload.data.reason}）` : ''
    fail(`buildify ${argv.join(' ')} 失败${reason}: ${payload.msg ?? ''}`)
  }
  return payload
}

function fetchCatalog(catalog, execNodes, edges, profile) {
  const versions = new Map()
  for (const node of execNodes) {
    const { bundleName, bundleVersion } = node.data ?? {}
    if (bundleName && !versions.has(bundleName)) versions.set(bundleName, bundleVersion)
  }
  for (const [bundleName, version] of versions) {
    if (catalog.bundles.has(bundleName)) continue
    const cliArgs = ['bundle', 'nodes', '-b', bundleName, ...(version ? ['-V', String(version)] : [])]
    addToCatalog(catalog, runCli(cliArgs, profile), `bundle nodes -b ${bundleName}`)
  }
  const byId = new Map(execNodes.map(node => [node.id, node]))
  const sources = new Set()
  for (const edge of edges) {
    const data = byId.get(edge?.source)?.data
    if (data?.bundleName && data?.name) sources.add(nodeKey(data.bundleName, data.name))
  }
  for (const key of sources) {
    if (catalog.relations.has(key)) continue
    const [bundleName, name] = key.split('\0')
    addToCatalog(catalog, runCli(['bundle', 'node-relations', '-b', bundleName, '-n', name], profile), `bundle node-relations -n ${name}`)
  }
}

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

function isExecNode(node) {
  return node && !DECORATION_TYPES.has(node.type) && node.type !== 'group' && node.data?.isLayoutNode !== true
}

const filled = value => typeof value === 'string' && value.trim() !== ''

function createReport() {
  const items = []
  return {
    items,
    error: (where, message, fixed = false) => items.push({ level: 'ERROR', where, message, fixed }),
    warn: (where, message, fixed = false) => items.push({ level: 'WARNING', where, message, fixed }),
  }
}

/** 同一对 source + target 合成一条边，出口按 name 去重，缺的字段从后来的同名出口补上。 */
function mergeEdges(edges, report, fix) {
  const byPair = new Map()
  const result = []
  for (const edge of edges) {
    const pair = `${edge?.source}\0${edge?.target}`
    const kept = byPair.get(pair)
    if (!kept) {
      byPair.set(pair, edge)
      result.push(edge)
      continue
    }
    report.error(`边 ${edge.id ?? '?'}`, `与 ${kept.id ?? '?'} 是同一对 ${edge.source} → ${edge.target}，多个出口要放进一条边的 data.relations 数组`, fix)
    if (!fix) {
      result.push(edge)
      continue
    }
    const relations = Array.isArray(kept.data?.relations) ? kept.data.relations : []
    for (const relation of Array.isArray(edge.data?.relations) ? edge.data.relations : []) {
      relations.push(relation)
    }
    kept.data = { ...kept.data, relations }
  }
  return result
}

function checkRelations(edge, sourceNode, catalog, report, fix) {
  const where = `边 ${edge.id}`
  const relations = edge.data?.relations
  if (!Array.isArray(relations) || !relations.length) {
    report.error(where, 'data.relations 必须是至少一项的数组，写上接到这个下游的所有出口')
    return
  }

  const merged = []
  const byName = new Map()
  for (const relation of relations) {
    if (!filled(relation?.name)) {
      report.error(where, '有出口缺少 name')
      merged.push(relation)
      continue
    }
    const same = byName.get(relation.name)
    if (!same) {
      byName.set(relation.name, relation)
      merged.push(relation)
      continue
    }
    report.error(where, `出口 ${relation.name} 重复出现，同一条边里每个出口只写一次`, fix)
    if (!fix) merged.push(relation)
    else for (const [key, value] of Object.entries(relation)) if (same[key] == null || same[key] === '') same[key] = value
  }
  if (fix) edge.data.relations = merged

  const data = sourceNode?.data ?? {}
  const schema = catalog.relations.get(nodeKey(data.bundleName, data.name))
  const custom = Array.isArray(data.relations) ? data.relations : []
  for (const relation of edge.data.relations) {
    if (!filled(relation?.name)) continue
    const known = schema?.find(item => item?.name === relation.name)
      ?? custom.find(item => item?.name === relation.name)
    if (schema && !known) {
      const names = schema.map(item => item.name).join(' / ')
      report.error(where, `出口 ${relation.name} 不在 ${data.name} 的关系目录里（可用: ${names}）`)
    }
    if (!filled(relation.label)) {
      const canFill = fix && filled(known?.label)
      if (canFill) relation.label = known.label
      const hint = known?.label ? `，目录里是「${known.label}」` : '，从 bundle node-relations 原样拷贝'
      report.error(where, `出口 ${relation.name} 缺少 label${hint}`, canFill)
    }
    if (known && filled(known.label) && filled(relation.label) && relation.label !== known.label) {
      report.warn(where, `出口 ${relation.name} 的 label「${relation.label}」与目录「${known.label}」不同，画布出口文字会和其他流程不一致`)
    }
    for (const field of ['icon', '_id']) {
      if (known?.[field] && !relation[field]) {
        if (fix) relation[field] = known[field]
        report.error(where, `自定义出口 ${relation.name} 缺少 ${field}，要和源节点 data.relations 那份一致`, fix)
      }
    }
  }
}

function checkEdges(flow, byId, catalog, report, fix) {
  const edges = Array.isArray(flow.edges) ? flow.edges : []
  const result = mergeEdges(edges, report, fix)
  if (fix) flow.edges = result

  for (const edge of result) {
    const expected = `${edge?.source}_${edge?.target}`
    const label = `边 ${edge?.id ?? '?'}`
    if (!edge?.source || !edge?.target) {
      report.error(label, '缺少 source 或 target')
      continue
    }
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      report.error(label, `source / target 指向不存在的节点（${edge.source} → ${edge.target}）`)
    }
    if (edge.id !== expected) {
      report.error(label, `id 应为 ${expected}，一对节点之间只有一条边，不按出口拆 id`, fix)
      if (fix) edge.id = expected
    }
    if (edge.data == null || typeof edge.data !== 'object') edge.data = {}
    checkRelations(edge, byId.get(edge.source), catalog, report, fix)
    if (edge.label != null && edge.label !== '') {
      report.warn(`边 ${edge.id}`, `边自身 label 要留空，出口文字写在 relations[].label`, fix)
      if (fix) edge.label = ''
    }
  }
}

function checkNodes(execNodes, catalog, report, fix) {
  const iconsByType = new Map()
  for (const node of execNodes) {
    const data = node.data ?? {}
    const where = `节点 ${node.id}`
    const type = `${data.bundleName ?? '?'} ${data.name ?? '?'}`
    const entry = catalog.nodes.get(nodeKey(data.bundleName, data.name))

    if (catalog.bundles.has(data.bundleName) && !entry) {
      report.error(where, `${type} 不在 bundle nodes 目录里，节点名要以目录为准`)
    }

    if (!filled(data.icon)) {
      const canFill = fix && filled(entry?.icon)
      if (canFill) data.icon = entry.icon
      report.error(where, `缺少 data.icon${entry?.icon ? `，目录里是 ${entry.icon}` : '，从 bundle nodes 原样拷贝'}`, canFill)
    } else if (!ICON_FILE.test(data.icon)) {
      const canFill = fix && filled(entry?.icon)
      report.error(where, `data.icon「${data.icon}」不是目录里的图标文件名（如 js.svg），不要写 URL、路径或 emoji`, canFill)
      if (canFill) data.icon = entry.icon
    } else if (entry?.icon && data.icon !== entry.icon) {
      report.error(where, `${type} 的图标应为 ${entry.icon}，现在是 ${data.icon}`, fix)
      if (fix) data.icon = entry.icon
    }

    if (entry?.label && data.label !== entry.label) {
      report.warn(where, `data.label 应为目录里的「${entry.label}」，本流程职责写在 summary`, fix)
      if (fix) data.label = entry.label
    }
    if (entry?.isTrigger != null && (data.isTrigger === true) !== entry.isTrigger) {
      report.error(where, `data.isTrigger 应为 ${entry.isTrigger}`, fix)
      if (fix) data.isTrigger = entry.isTrigger
    }

    if (filled(data.icon)) {
      const key = nodeKey(data.bundleName, data.name)
      if (!iconsByType.has(key)) iconsByType.set(key, new Map())
      const icons = iconsByType.get(key)
      if (!icons.has(data.icon)) icons.set(data.icon, [])
      icons.get(data.icon).push(node.id)
    }
  }

  for (const [key, icons] of iconsByType) {
    if (icons.size < 2) continue
    const [bundleName, name] = key.split('\0')
    if (catalog.nodes.has(key)) continue
    const detail = [...icons].map(([icon, ids]) => `${icon}（${ids.join(', ')}）`).join('；')
    report.error(`${bundleName} ${name}`, `同一种节点用了不同图标: ${detail}。复制节点时图标要一起照抄`)
  }
}

// ---------------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  const flow = readJson(args.file, '画布')
  if (!flow || !Array.isArray(flow.nodes)) fail('顶层缺少 nodes 数组（要传画布 JSON，而不是整个草稿响应）')

  const byId = new Map(flow.nodes.filter(node => node?.id).map(node => [node.id, node]))
  const execNodes = flow.nodes.filter(isExecNode)
  const catalog = createCatalog()
  for (const file of args.catalogs) addToCatalog(catalog, readJson(file, '目录'), file)
  if (args.fetch) fetchCatalog(catalog, execNodes, Array.isArray(flow.edges) ? flow.edges : [], args.profile)

  const report = createReport()
  checkEdges(flow, byId, catalog, report, args.fix)
  checkNodes(execNodes, catalog, report, args.fix)

  const open = report.items.filter(item => !item.fixed)
  const fixed = report.items.filter(item => item.fixed)
  for (const item of open) process.stdout.write(`${item.level} ${item.where}: ${item.message}\n`)
  for (const item of fixed) process.stdout.write(`FIXED ${item.where}: ${item.message}\n`)

  const errors = open.filter(item => item.level === 'ERROR').length
  const warnings = open.length - errors
  const scope = catalog.nodes.size ? '已对照目录' : '没有目录，图标和出口名只查了格式与一致性（加 --fetch 对照目录）'
  process.stdout.write(`check: ${execNodes.length} 个节点，${(flow.edges ?? []).length} 条边；${errors} 个 ERROR，${warnings} 个 WARNING`
    + `${fixed.length ? `，已修 ${fixed.length} 处` : ''}。${scope}\n`)

  if (args.fix && fixed.length) {
    writeFileSync(args.out || args.file, `${JSON.stringify(flow, null, 2)}\n`)
    process.stdout.write(`已写入 ${args.out || args.file}\n`)
  }
  process.exit(errors ? 1 : 0)
}

main()
