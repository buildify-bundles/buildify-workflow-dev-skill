#!/usr/bin/env node
/**
 * 批量拉节点目录、表单和出口，存进缓存目录，并打印紧凑摘要（代替逐条调用 + 临时脚本抽字段）。
 *
 *   node scripts/catalog.mjs fetch -b buildify/core -n SchedulerNode,HttpRequestNode \
 *        -b buildify/dingtalk-bot -n SendMarkdownMsgNode [-V 版本] [--dir DIR] [--profile NAME] [--refresh]
 *   node scripts/catalog.mjs show  -b buildify/core [-n HttpRequestNode] [--dir DIR]
 *
 * -b 后面可以写 `包名@版本`，也可以紧跟 -V；-n 和 -V 作用于前一个 -b。没有 -n 时只列出包里的节点。
 * fetch 并行调用 `bundle nodes` / `node-properties` / `node-relations`，已有缓存直接复用（--refresh 重拉）；
 * show 只读缓存，不联网。缓存目录默认 /tmp/buildify-catalog，build.mjs 和 check.mjs --catalog-dir 读同一份。
 *
 * 退出码：0 成功；3 参数错误、拉取失败或缓存里没有。
 */
import {
  CatalogError, DEFAULT_DIR, cachedVersions, describeNode, fetchBundle, loadNodeFile, loadNodes,
} from './lib/catalog-store.mjs'

const USAGE = 'usage: node scripts/catalog.mjs fetch|show -b BUNDLE[@VER] [-V VER] [-n Node,Node] ... [--dir DIR] [--profile NAME] [--refresh]\n'

function fail(message, code = 3) {
  process.stderr.write(`catalog: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { command: argv[0], bundles: [], dir: DEFAULT_DIR, profile: null, refresh: false }
  if (args.command === '-h' || args.command === '--help') {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (!['fetch', 'show'].includes(args.command)) fail(`第一个参数要是 fetch 或 show。${USAGE}`)
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
    else fail(`不认识的参数: ${arg}`)
  }
  if (!args.bundles.length) fail(`至少要一个 -b。${USAGE}`)
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
  const versions = cachedVersions(dir, bundleName)
  if (versions.length === 1) return versions[0]
  if (!versions.length) fail(`缓存里没有 ${bundleName}，先 fetch`)
  fail(`缓存里 ${bundleName} 有多个版本（${versions.join(', ')}），用 -V 指定`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
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
      out.push(describeNode({ bundleName: bundle.bundleName, version, entry, properties, relations }))
    }
  }
  process.stdout.write(`${out.join('\n\n')}\n`)
  if (args.command === 'fetch') process.stdout.write(`\n缓存目录: ${args.dir}\n`)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
