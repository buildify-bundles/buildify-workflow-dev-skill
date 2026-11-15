#!/usr/bin/env node
/**
 * 搜软件包、批量拉节点目录 / 表单 / 出口进缓存并打印紧凑摘要（代替逐条调用 + 临时脚本抽字段）。
 *
 *   node scripts/catalog.mjs find 微信支付,wechat,pay [--profile NAME]
 *   node scripts/catalog.mjs fetch -b buildify/core -n SchedulerNode,HttpRequestNode \
 *        -b buildify/dingtalk-bot -n SendMarkdownMsgNode [-V 版本] [--hints] [--dir DIR] [--profile NAME] [--refresh]
 *   node scripts/catalog.mjs show  -b buildify/core [-n HttpRequestNode] [--hints] [--dir DIR] [--profile NAME]
 *   node scripts/catalog.mjs doc   -b buildify/core [-V 版本] [--node WebhookResponseNode,CodeNode] [--section 硬规则] [--refresh]
 *   node scripts/catalog.mjs cache [--clear] [--profile NAME]
 *
 * find：每个关键词并行跑一次 `bundle list -k`，合并去重，每个包一行（包名@最新版本、显示名、简介前 40 字）。
 *       一次给齐同义词（中文、英文、厂商名），都没命中就是缺软件包。
 * fetch：-b 后面可以写 `包名@版本`，也可以紧跟 -V；-n 和 -V 作用于前一个 -b。没有 -n 时只列出包里的节点。
 *       调 `bundle nodes` 和一次 `bundle schema`（旧版 CLI 退回逐个 node-properties / node-relations），已有缓存直接复用（--refresh 重拉）。
 *       没写版本时 1 小时内复用上次查到的最新版本；-SNAPSHOT 版本的缓存 10 分钟后重拉。
 * show：只读缓存，不联网。
 * doc：整份 `bundle doc` 每个版本拉一次（1 天内复用），本地按标题切开：--node 只出那个节点的一节，
 *      --section 出标题含关键词的一节（如 硬规则、表达式约定、选型口诀），都不写时出带行数的目录。
 *      整份文档里找不到的节点再调 `bundle doc --node`。
 * cache：看缓存目录、文件数、大小和记下的最新版本；--clear 清空（加 --profile 只清那个工作区）。
 * --hints：每个参数下多一行表单里的说明（description / hint，如路径参数在 msg.pathParams、表达式写法），
 *          参数含义不清时加它，通常不用再读文档。
 *
 * 缓存目录持久保存：BUILDIFY_CATALOG_DIR，否则 $XDG_CACHE_HOME/buildify/catalog，否则 macOS ~/Library/Caches/buildify/catalog、
 * Linux ~/.cache/buildify/catalog、Windows %LOCALAPPDATA%\buildify\cache\catalog；建不了时退回系统临时目录下 buildify-catalog。
 * 加了 --profile 时是其下的 <profile> 子目录。build.mjs、check.mjs、draft.mjs 用同样的规则，同一个 --profile 就读同一份。
 *
 * 退出码：0 成功（find 没命中也是 0，输出会写明）；3 参数错误、拉取失败或缓存里没有。
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CatalogError, DEFAULT_DIR, cachedVersions, catalogDir, describeNode, docSections, fetchBundle, fetchDoc, fetchNodeDoc,
  loadNodeFile, loadNodes, matchSections, nodeSection, pickCachedVersion, pool, runCli, unwrap,
} from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'

const USAGE = 'usage: node scripts/catalog.mjs find KW[,KW…] | fetch|show -b BUNDLE[@VER] [-V VER] [-n Node,Node] ... [--hints]'
  + ' | doc -b BUNDLE [-V VER] [--node Node,Node] [--section 关键词] | cache [--clear]  [--dir DIR] [--profile NAME] [--refresh]\n'

function fail(message, code = 3) {
  process.stderr.write(`catalog: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { command: argv[0], bundles: [], keywords: [], dir: null, profile: null, refresh: false, hints: false, section: null, clear: false }
  if (args.command === '-h' || args.command === '--help') printHelp(import.meta.url)
  if (!['fetch', 'show', 'find', 'doc', 'cache'].includes(args.command)) fail(`第一个参数要是 find、fetch、show、doc 或 cache。${USAGE}`)
  let current = null
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null || next.startsWith('-')) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '-b' || arg === '--bundle') {
      const [bundleName, version] = value().split('@')
      current = { bundleName, version: version || null, nodes: [] }
      args.bundles.push(current)
    } else if (arg === '-V' || arg === '--version') {
      if (!current) fail('-V 要写在 -b 后面')
      current.version = value()
    } else if (arg === '-n' || arg === '--node') {
      if (!current) fail('-n 要写在 -b 后面')
      current.nodes.push(...value().split(',').map(name => name.trim()).filter(Boolean))
    } else if (arg === '--dir') args.dir = value()
    else if (arg === '--profile') args.profile = value()
    else if (arg === '--refresh') args.refresh = true
    else if (arg === '--hints') args.hints = true
    else if (arg === '--section' && args.command === 'doc') args.section = value()
    else if (arg === '--clear' && args.command === 'cache') args.clear = true
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else if (args.command === 'find' && !arg.startsWith('-')) {
      args.keywords.push(...arg.split(/[,，]/).map(word => word.trim()).filter(Boolean))
    } else fail(`不认识的参数: ${arg}`)
  }
  if (args.command === 'find' && !args.keywords.length) fail(`find 后面写关键词，逗号分隔。${USAGE}`)
  if (!['find', 'cache'].includes(args.command) && !args.bundles.length) fail(`至少要一个 -b。${USAGE}`)
  args.dir = catalogDir(args.dir, args.profile)
  return args
}

function listNodes(bundleName, version, entries) {
  const lines = [`# ${bundleName}@${version}（${entries.size} 个节点）`]
  for (const entry of entries.values()) {
    lines.push(`- ${entry.name}  label=${entry.label ?? '?'}  icon=${entry.icon ?? '?'}${entry.isTrigger ? '  触发器' : ''}`
      + `${entry.summary ? ` — ${entry.summary}` : ''}`)
  }
  return lines.join('\n')
}

function resolveCachedVersion(dir, bundleName, version) {
  if (version) return version
  const picked = pickCachedVersion(dir, bundleName)
  if (picked) return picked
  const versions = cachedVersions(dir, bundleName)
  if (!versions.length) fail(`缓存里没有 ${bundleName}，先 fetch`)
  fail(`缓存里 ${bundleName} 有多个版本（${versions.join(', ')}），用 -V 指定`)
}

async function find(args) {
  const results = await pool(args.keywords.map(word => async () => {
    try {
      return { word, list: unwrap(await runCli(['bundle', 'list', '-k', word], args.profile), 'bundle list') ?? [] }
    } catch (error) {
      return { word, error: error.message }
    }
  }))
  const bundles = new Map()
  const lines = []
  for (const { word, list, error } of results) {
    if (error) {
      lines.push(`关键词「${word}」查询失败: ${error}`)
      continue
    }
    const items = Array.isArray(list) ? list : []
    lines.push(`关键词「${word}」: ${items.length ? items.map(item => item.bundleName).join(', ') : '没有'}`)
    for (const item of items) if (item?.bundleName && !bundles.has(item.bundleName)) bundles.set(item.bundleName, item)
  }
  lines.push('')
  if (!bundles.size) lines.push('都没有命中：按「环境里没有对应节点」处理缺软件包。')
  for (const item of bundles.values()) {
    const summary = String(item.summary ?? '').replace(/\s+/g, ' ')
    lines.push(`- ${item.bundleName}@${item.latestVersion ?? '?'}  ${String(item.displayName ?? '').trim()}`
      + `${summary ? ` — ${summary.slice(0, 40)}${summary.length > 40 ? '…' : ''}` : ''}`)
  }
  if (bundles.size) lines.push('', '下一步: catalog.mjs fetch -b <包名> 列出节点，再 -n 拉要用的节点。')
  process.stdout.write(`${lines.join('\n')}\n`)
}

const lineCount = text => text.split('\n').length

async function doc(args) {
  const [bundle] = args.bundles
  if (args.bundles.length > 1) fail('doc 一次只看一个包')
  const { version, content, cached } = await fetchDoc({ ...bundle, dir: args.dir, profile: args.profile, refresh: args.refresh })
  const sections = docSections(content)
  const out = []
  for (const node of bundle.nodes) {
    const hit = nodeSection(sections, node)
    if (hit) out.push(hit.text)
    else {
      const text = version
        ? await fetchNodeDoc({ dir: args.dir, bundleName: bundle.bundleName, version, node, profile: args.profile, refresh: args.refresh })
          .catch(() => '')
        : ''
      out.push(text.trim() || `（${bundle.bundleName}@${version ?? '?'} 的文档里没有 ${node} 这一节，节点名以 catalog.mjs fetch 列出的为准）`)
    }
  }
  if (args.section) {
    const hits = matchSections(sections, args.section)
    if (!hits.length) out.push(`（标题里没有「${args.section}」，不带 --section 看目录）`)
    else {
      out.push(hits[0].text)
      if (hits.length > 1) out.push(`另有 ${hits.length - 1} 节标题也含「${args.section}」: ${hits.slice(1).map(item => item.title).join(' / ')}`)
    }
  }
  if (!out.length) {
    const toc = sections.filter(item => item.level <= 3)
      .map(item => `${'  '.repeat(item.level - 1)}- ${item.title}（${lineCount(item.text)} 行）`)
    out.push(`# ${bundle.bundleName}@${version ?? '?'} 文档目录（共 ${lineCount(content)} 行）`, toc.join('\n') || '（没有标题）',
      '用 --node 节点名 或 --section 标题关键词 只看一节。')
  }
  process.stdout.write(`${out.join('\n\n')}\n`)
  if (!cached) process.stdout.write(`\n文档已缓存到 ${args.dir}（1 天内复用，--refresh 重拉）\n`)
}

function cache(args) {
  const { dir } = args
  const files = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(item => item.isFile()) : []
  if (args.clear) {
    for (const item of files) rmSync(join(dir, item.name))
    process.stdout.write(`已清空 ${dir}（删除 ${files.length} 个文件）\n`)
    return
  }
  const size = files.reduce((sum, item) => sum + statSync(join(dir, item.name)).size, 0)
  const count = suffix => files.filter(item => item.name.endsWith(suffix)).length
  const lines = [
    `缓存目录: ${dir}`,
    `${files.length} 个文件，${(size / 1024).toFixed(1)} KB（目录 ${count('.nodes.json')}、表单 ${count('.properties.json')}、出口 ${count('.relations.json')}、文档 ${count('.doc.md')}）`,
  ]
  if (existsSync(join(dir, 'latest.json'))) {
    const latest = Object.entries(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')))
    for (const [bundleName, item] of latest) {
      lines.push(`最新版本 ${bundleName}@${item.version}（${Math.round((Date.now() - item.at) / 60000)} 分钟前查的）`)
    }
  }
  if (!args.profile && dir === DEFAULT_DIR && existsSync(dir)) {
    const profiles = readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name)
    if (profiles.length) lines.push(`各 profile 的缓存（加 --profile 查看或清理）: ${profiles.join(', ')}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'find') return find(args)
  if (args.command === 'doc') return doc(args)
  if (args.command === 'cache') return cache(args)
  const out = []
  for (const bundle of args.bundles) {
    const version = args.command === 'fetch'
      ? await fetchBundle({ ...bundle, dir: args.dir, profile: args.profile, refresh: args.refresh })
      : resolveCachedVersion(args.dir, bundle.bundleName, bundle.version)
    const entries = loadNodes(args.dir, bundle.bundleName, version)
    if (!entries) fail(`缓存里没有 ${bundle.bundleName}@${version}，先 fetch`)
    if (!bundle.nodes.length) {
      out.push(listNodes(bundle.bundleName, version, entries))
      continue
    }
    for (const name of bundle.nodes) {
      const entry = entries.get(name)
      if (!entry) fail(`${bundle.bundleName}@${version} 里没有节点 ${name}（可用: ${[...entries.keys()].join(', ')}）`)
      const properties = loadNodeFile(args.dir, bundle.bundleName, version, name, 'properties')
      const relations = loadNodeFile(args.dir, bundle.bundleName, version, name, 'relations')
      if (!properties || !relations) fail(`缓存里缺 ${bundle.bundleName}@${version} ${name} 的表单或出口，先 fetch -n ${name}`)
      out.push(describeNode({ bundleName: bundle.bundleName, version, entry, properties, relations, hints: args.hints }))
    }
  }
  process.stdout.write(`${out.join('\n\n')}\n`)
  if (args.command === 'fetch') process.stdout.write(`\n缓存目录: ${args.dir}\n`)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
