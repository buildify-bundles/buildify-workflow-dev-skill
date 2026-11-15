/**
 * 目录缓存：`bundle nodes` / `node-properties` / `node-relations` 的 --json 输出按固定文件名存在一个目录里
 * （`bundle schema` 的返回拆成同样的两份文件）。
 *
 *   <dir>/<包名>@<版本>.nodes.json
 *   <dir>/<包名>@<版本>.<节点>.properties.json
 *   <dir>/<包名>@<版本>.<节点>.relations.json
 *   <dir>/<包名>@<版本>.doc.md                      整份 bundle doc
 *   <dir>/latest.json                              { 包名: { version, at } }：最近一次查到的最新版本
 *
 * 包名里的 `/` 换成 `__`。catalog.mjs、build.mjs、check.mjs 共用这里的读写规则。
 *
 * 有效期：正式版本发布后不能覆盖，目录、表单、出口一直复用；-SNAPSHOT 可以覆盖，超过 SNAPSHOT_TTL 重拉。
 * 「最新版本」超过 LATEST_TTL 重新查；文档可以被 bundle doc set 整份覆盖，超过 DOC_TTL 重拉。--refresh 一律重拉。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const SNAPSHOT_TTL = 10 * 60 * 1000
export const LATEST_TTL = 60 * 60 * 1000
export const DOC_TTL = 24 * 60 * 60 * 1000

/** 持久缓存根目录：BUILDIFY_CATALOG_DIR → XDG_CACHE_HOME → 各系统的用户缓存目录；建不了时退回系统临时目录。 */
function defaultRoot() {
  const env = process.env
  if (env.BUILDIFY_CATALOG_DIR) return env.BUILDIFY_CATALOG_DIR
  let root
  if (env.XDG_CACHE_HOME) root = join(env.XDG_CACHE_HOME, 'buildify', 'catalog')
  else if (process.platform === 'darwin') root = join(homedir(), 'Library', 'Caches', 'buildify', 'catalog')
  else if (process.platform === 'win32') root = join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'buildify', 'cache', 'catalog')
  else root = join(homedir(), '.cache', 'buildify', 'catalog')
  try {
    mkdirSync(root, { recursive: true })
    return root
  } catch {
    return join(tmpdir(), 'buildify-catalog')
  }
}

export const DEFAULT_DIR = defaultRoot()

/** 没写 --dir 时：有 profile 用 <根目录>/<profile>，否则 <根目录>。不同工作区的同名包不串用。 */
export function catalogDir(dir, profile) {
  if (dir) return dir
  return profile ? join(DEFAULT_DIR, profile) : DEFAULT_DIR
}

const isSnapshot = version => /-SNAPSHOT$/i.test(String(version ?? ''))

/** 缓存文件还能不能用：不存在为 false；给了 ttl 按 ttl，SNAPSHOT 版本按 SNAPSHOT_TTL，其余一直有效。 */
export function fresh(file, { version, ttl } = {}) {
  if (!existsSync(file)) return false
  const limit = ttl ?? (isSnapshot(version) ? SNAPSHOT_TTL : null)
  return limit == null || Date.now() - statSync(file).mtimeMs < limit
}

function readLatestFile(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))
  } catch {
    return {}
  }
}

/** 最近一次查到的最新版本；anyAge 为 false 时超过 LATEST_TTL 就不算，needNodes 为 true 时目录文件失效也不算。 */
export function latestVersion(dir, bundleName, { anyAge = false, needNodes = true } = {}) {
  const item = readLatestFile(dir)[bundleName]
  if (!item?.version) return null
  if (anyAge) return item.version
  if (Date.now() - (item.at ?? 0) >= LATEST_TTL) return null
  if (!needNodes) return item.version
  return fresh(catalogFile(dir, bundleName, item.version), { version: item.version }) ? item.version : null
}

function rememberLatest(dir, bundleName, version) {
  const all = readLatestFile(dir)
  all[bundleName] = { version, at: Date.now() }
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(all, null, 2))
}

/** 没指定版本时从缓存里挑：只有一个就用它；多个时用最近一次查到的最新版本；挑不出返回 null。 */
export function pickCachedVersion(dir, bundleName) {
  const versions = cachedVersions(dir, bundleName)
  if (versions.length === 1) return versions[0]
  const latest = latestVersion(dir, bundleName, { anyAge: true })
  return latest && versions.includes(latest) ? latest : null
}

export class CatalogError extends Error {}

export const bundleSlug = bundleName => String(bundleName).replaceAll('/', '__')

export function catalogFile(dir, bundleName, version, node, kind) {
  const base = `${bundleSlug(bundleName)}@${version}`
  return join(dir, node ? `${base}.${node}.${kind}.json` : `${base}.nodes.json`)
}

/** 去掉 CLI 外层信封 `{ok, code, msg, data}`，失败的返回直接报错。 */
export function unwrap(payload, source) {
  if (payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload) {
    if (payload.ok === false) throw new CatalogError(`${source} 是失败的返回: ${payload.msg ?? ''}`)
    return payload.data
  }
  return payload
}

export function readJsonFile(file, what = '文件') {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new CatalogError(`读不到${what} ${file}: ${error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new CatalogError(`${what} ${file} 不是合法 JSON: ${error.message}`)
  }
}

/** 调 `buildify --json …`，返回整个信封（ok 为 false 也返回）；没有输出或不是 JSON 时报错。 */
export function runCliPayload(cliArgs, profile, { stdin } = {}) {
  const argv = ['--json', ...(profile ? ['--profile', profile] : []), ...cliArgs]
  return new Promise((resolve, reject) => {
    const child = execFile('buildify', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (!stdout) {
        reject(new CatalogError(`buildify ${argv.join(' ')} 执行失败: ${error?.message ?? '没有输出'}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new CatalogError(`buildify ${argv.join(' ')} 输出不是 JSON`))
      }
    })
    if (stdin != null) child.stdin.end(stdin)
  })
}

export async function runCli(cliArgs, profile) {
  const payload = await runCliPayload(cliArgs, profile)
  if (payload?.ok === false) {
    const reason = payload.data?.reason ? `（${payload.data.reason}）` : ''
    throw new CatalogError(`buildify --json ${cliArgs.join(' ')} 失败${reason}: ${payload.msg ?? ''}`)
  }
  return payload
}

/** 同时最多跑 limit 个任务，结果顺序与输入一致。 */
export async function pool(tasks, limit = 6) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/**
 * 拉一个包的节点目录，以及 nodes 里每个节点的表单和出口，写进缓存目录。
 * version 为空时用 LATEST_TTL 内记下的最新版本，没有再拉 `bundle nodes` 拿到实际版本。已有缓存按 fresh() 复用，refresh 为 true 时重拉。
 */
export async function fetchBundle({ dir, bundleName, version, nodes = [], profile, refresh = false }) {
  mkdirSync(dir, { recursive: true })
  let resolved = version || (refresh ? null : latestVersion(dir, bundleName))
  let nodesPayload
  if (resolved && !refresh && fresh(catalogFile(dir, bundleName, resolved), { version: resolved })) {
    nodesPayload = readJsonFile(catalogFile(dir, bundleName, resolved), '目录')
  } else {
    nodesPayload = await runCli(['bundle', 'nodes', '-b', bundleName, ...(resolved ? ['-V', String(resolved)] : [])], profile)
    resolved = unwrap(nodesPayload, `bundle nodes -b ${bundleName}`)?.bundleVersion ?? resolved
    if (!resolved) throw new CatalogError(`bundle nodes -b ${bundleName} 没有返回 bundleVersion`)
    writeFileSync(catalogFile(dir, bundleName, resolved), JSON.stringify(nodesPayload))
    if (!version) rememberLatest(dir, bundleName, resolved)
  }
  const known = new Set((unwrap(nodesPayload, 'bundle nodes')?.nodes ?? []).map(node => node?.name))
  const missing = nodes.filter(name => !known.has(name))
  if (missing.length) {
    throw new CatalogError(`${bundleName}@${resolved} 里没有节点 ${missing.join(', ')}（可用: ${[...known].join(', ')}）`)
  }

  const stale = (name, kind) => refresh || !fresh(catalogFile(dir, bundleName, resolved, name, kind), { version: resolved })
  const wanted = nodes.filter(name => stale(name, 'properties') || stale(name, 'relations'))
  if (!wanted.length) return resolved
  try {
    await fetchSchema(dir, bundleName, resolved, wanted, profile)
  } catch {
    const tasks = []
    for (const name of wanted) {
      for (const kind of ['properties', 'relations']) {
        if (!stale(name, kind)) continue
        tasks.push(async () => {
          const payload = await runCli(['bundle', `node-${kind}`, '-b', bundleName, '-n', name, '-V', String(resolved)], profile)
          writeFileSync(catalogFile(dir, bundleName, resolved, name, kind), JSON.stringify(payload))
        })
      }
    }
    await pool(tasks)
  }
  return resolved
}

/**
 * CLI 1.3.0 的 `bundle schema` 一次取回多个节点的表单和出口，拆开按 node-properties / node-relations 的格式写缓存。
 * 旧版 CLI 没有这个命令时抛错，由调用方改成逐个节点拉。
 */
async function fetchSchema(dir, bundleName, version, names, profile) {
  const payload = await runCli(['bundle', 'schema', '-b', bundleName, '-n', names.join(','), '-V', String(version)], profile)
  const data = unwrap(payload, 'bundle schema')
  const byName = new Map((data?.nodes ?? []).map(node => [node?.name, node]))
  if (!names.every(name => byName.get(name)?.properties && Array.isArray(byName.get(name)?.relations))) {
    throw new CatalogError('bundle schema 的返回缺节点或字段')
  }
  for (const name of names) {
    const { properties, relations, ...meta } = byName.get(name)
    const head = { bundleName: data.bundleName ?? bundleName, bundleVersion: data.bundleVersion ?? version, ...meta }
    writeFileSync(catalogFile(dir, bundleName, version, name, 'properties'), JSON.stringify({ ok: true, data: { ...head, schema: properties } }))
    writeFileSync(catalogFile(dir, bundleName, version, name, 'relations'), JSON.stringify({ ok: true, data: { ...head, schema: relations } }))
  }
}

// ---------------------------------------------------------------------------
// 文档
// ---------------------------------------------------------------------------

const docFile = (dir, bundleName, version, node) => join(dir, `${bundleSlug(bundleName)}@${version}${node ? `.${node}` : ''}.doc.md`)

/** 整份 bundle doc，按版本缓存 DOC_TTL。没给版本时用记下的最新版本，再不行由 CLI 返回的 bundleVersion 定。 */
export async function fetchDoc({ dir, bundleName, version, profile, refresh = false }) {
  mkdirSync(dir, { recursive: true })
  const known = version || (refresh ? null : latestVersion(dir, bundleName, { needNodes: false }) || pickCachedVersion(dir, bundleName))
  if (known && !refresh && fresh(docFile(dir, bundleName, known), { ttl: DOC_TTL })) {
    return { version: known, content: readFileSync(docFile(dir, bundleName, known), 'utf8'), cached: true }
  }
  const data = unwrap(await runCli(['bundle', 'doc', '-b', bundleName, ...(known ? ['-V', String(known)] : [])], profile), 'bundle doc')
  const resolved = data?.bundleVersion ?? known
  const content = String(data?.content ?? '')
  if (resolved) {
    writeFileSync(docFile(dir, bundleName, resolved), content)
    if (!known) rememberLatest(dir, bundleName, resolved)
  }
  return { version: resolved, content, cached: false }
}

/** 整份文档里找不到节点时退回 CLI 1.3.0 的 `bundle doc --node`，结果同样缓存 DOC_TTL。 */
export async function fetchNodeDoc({ dir, bundleName, version, node, profile, refresh = false }) {
  const file = docFile(dir, bundleName, version, node)
  if (!refresh && fresh(file, { ttl: DOC_TTL })) return readFileSync(file, 'utf8')
  const data = unwrap(await runCli(['bundle', 'doc', '-b', bundleName, '-V', String(version), '--node', node], profile), 'bundle doc --node')
  const content = String(data?.content ?? '')
  if (content) writeFileSync(file, content)
  return content
}

/** 按 Markdown 标题切节（跳过 ``` / ~~~ 代码块里以 # 开头的行）：[{ level, title, start, end, text }]，end 是下一个同级或更高级标题。 */
export function docSections(markdown) {
  const lines = String(markdown).split('\n')
  const heads = []
  let fence = null
  lines.forEach((line, index) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)
    if (mark) {
      if (!fence) fence = mark[1]
      else if (line.trim().startsWith(fence)) fence = null
      return
    }
    if (fence) return
    const head = /^(#{1,6})\s+(.*\S)\s*$/.exec(line)
    if (head) heads.push({ level: head[1].length, title: head[2], start: index })
  })
  heads.forEach((head, k) => {
    const next = heads.slice(k + 1).find(item => item.level <= head.level)
    head.end = next ? next.start : lines.length
    head.text = lines.slice(head.start, head.end).join('\n').trimEnd()
  })
  return heads
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 节点那一节。先认「### Webhook 响应（WebhookResponseNode · Webhook Response）」，
 * 再认标题里作为独立单词出现的节点名（如「## `SelectNode`」），避免 SelectNode 命中 StreamSelectNode。
 */
export function nodeSection(sections, node) {
  const name = escapeRegExp(node)
  const bracket = new RegExp(`[（(]\\s*${name}\\s*[·)）]`)
  const word = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`)
  return sections.find(item => bracket.test(item.title)) ?? sections.find(item => word.test(item.title)) ?? null
}

/** 标题含关键词的各节（不分大小写）。 */
export function matchSections(sections, keyword) {
  const word = String(keyword).toLowerCase()
  return sections.filter(item => item.title.toLowerCase().includes(word))
}

/** 缓存目录里某个包有哪些版本。 */
export function cachedVersions(dir, bundleName) {
  if (!existsSync(dir)) return []
  const prefix = `${bundleSlug(bundleName)}@`
  return readdirSync(dir)
    .filter(file => file.startsWith(prefix) && file.endsWith('.nodes.json'))
    .map(file => file.slice(prefix.length, -'.nodes.json'.length))
}

/** 读缓存里一个包某个版本的节点目录，返回 Map<节点名, 目录条目>；没有缓存返回 null。 */
export function loadNodes(dir, bundleName, version) {
  const file = catalogFile(dir, bundleName, version)
  if (!existsSync(file)) return null
  const data = unwrap(readJsonFile(file, '目录'), file)
  return new Map((data?.nodes ?? []).filter(node => node?.name).map(node => [node.name, node]))
}

/** 没写 --profile 却读不到缓存时，看哪些 profile 的缓存里有这个节点，用来提示漏了 --profile。 */
export function profilesWithCache(bundleName, version, node) {
  if (!existsSync(DEFAULT_DIR)) return []
  return readdirSync(DEFAULT_DIR, { withFileTypes: true })
    .filter(entry => {
      if (!entry.isDirectory()) return false
      const dir = join(DEFAULT_DIR, entry.name)
      const versions = version ? [version] : cachedVersions(dir, bundleName)
      return versions.some(item => existsSync(catalogFile(dir, bundleName, item, node, 'properties')))
    })
    .map(entry => entry.name)
}

/** 读缓存里一个节点的表单或出口（kind = properties | relations），没有缓存返回 null。 */
export function loadNodeFile(dir, bundleName, version, node, kind) {
  const file = catalogFile(dir, bundleName, version, node, kind)
  if (!existsSync(file)) return null
  return unwrap(readJsonFile(file, kind === 'properties' ? '表单' : '出口'), file)
}

// ---------------------------------------------------------------------------
// 表单摘要
// ---------------------------------------------------------------------------

const DISPLAY_ONLY = new Set(['Space', 'Divider', 'Notice', 'Alert', 'Title', 'Tag'])

const isField = item => item && typeof item === 'object' && typeof item.name === 'string' && item.uiComponent

/** 表单里的 CredentialSelect 槽位：[{ slot, type, required }]。 */
export function credentialSlots(properties) {
  const slots = []
  for (const prop of properties?.schema?.properties ?? []) {
    if (prop?.uiComponent !== 'CredentialSelect') continue
    slots.push({ slot: prop.name, type: prop.typeOptions?.credentialsType ?? null, required: prop.required === true })
  }
  return slots
}

/** 顶层参数名（不含纯展示组件）。 */
export function parameterNames(properties) {
  return new Set((properties?.schema?.properties ?? [])
    .filter(prop => isField(prop) && !DISPLAY_ONLY.has(prop.uiComponent))
    .map(prop => prop.name))
}

function describeShow(prop) {
  const show = prop.displayOptions?.show
  if (!show || typeof show !== 'object') return ''
  const parts = Object.entries(show).map(([key, values]) => `${key}=${[].concat(values).join('|')}`)
  return parts.length ? `  [当 ${parts.join(' 且 ')}]` : ''
}

function describeEnum(prop) {
  const values = (prop.options ?? []).filter(item => item && typeof item === 'object' && 'value' in item)
  if (!values.length) return ''
  const shown = values.slice(0, 10).map(item => String(item.value))
  return ` {${shown.join('|')}${values.length > 10 ? `|…共${values.length}项` : ''}}`
}

const HINT_MAX = 160

/** 表单里给人看的用法说明（description + hint），去掉 Markdown 反引号、合并成一行。 */
function fieldNotes(prop) {
  const notes = [prop.description, ...[].concat(prop.hint ?? [])]
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.replace(/\s+/g, ' ').trim())
  if (!notes.length) return ''
  const text = [...new Set(notes)].join(' ')
  return text.length > HINT_MAX ? `${text.slice(0, HINT_MAX)}…` : text
}

function describeFields(fields, defaults, indent, lines, hints) {
  for (const prop of fields) {
    if (!isField(prop) || DISPLAY_ONLY.has(prop.uiComponent)) continue
    const flags = []
    if (prop.expression || prop.typeOptions?.enableExpression) flags.push('表达式')
    if (prop.uiComponent === 'CredentialSelect' && prop.typeOptions?.credentialsType) flags.push(`凭证 ${prop.typeOptions.credentialsType}`)
    const value = defaults && Object.hasOwn(defaults, prop.name) ? defaults[prop.name] : prop.defaultValue
    const def = value === undefined ? '' : ` 默认=${JSON.stringify(value).slice(0, 60)}`
    lines.push(`${indent}${prop.required ? '*' : ' '}${prop.name} ${prop.uiComponent}${describeEnum(prop)}${def}`
      + `${flags.length ? ` (${flags.join('，')})` : ''}${prop.label ? ` — ${prop.label}` : ''}${describeShow(prop)}`)
    const notes = hints ? fieldNotes(prop) : ''
    if (notes) lines.push(`${indent}     ↳ ${notes}`)
    const children = (prop.options ?? []).filter(isField)
    if (children.length) describeFields(children, value && typeof value === 'object' ? value : null, `${indent}    `, lines, hints)
  }
}

/** 一个节点的紧凑摘要（多行文本）：目录字段、参数、凭证槽、出口。hints 为 true 时每个参数下附一行表单说明。 */
export function describeNode({ bundleName, version, entry, properties, relations, hints = false }) {
  const lines = []
  const name = entry?.name ?? properties?.name ?? relations?.name
  const icon = entry?.icon ?? properties?.icon
  const label = entry?.label ?? properties?.label
  lines.push(`## ${bundleName}@${version} ${name}  label=${label ?? '?'}  icon=${icon ?? '?'}${entry?.isTrigger ? '  触发器' : ''}`)
  if (properties) {
    const fields = properties.schema?.properties ?? []
    if (fields.length) {
      lines.push('参数（* 必填）:')
      describeFields(fields, properties.schema?.defaultValue ?? null, '  ', lines, hints)
    } else lines.push('参数: 无')
    const slots = credentialSlots(properties)
    lines.push(`凭证槽: ${slots.length ? slots.map(slot => `${slot.slot} → ${slot.type ?? '?'}`).join('，') : '无（不需要访问凭证）'}`)
  }
  if (relations) {
    const schema = Array.isArray(relations.schema) ? relations.schema : []
    lines.push(`出口: ${schema.length ? schema.map(item => `${item.name}「${item.label ?? ''}」`).join(' / ') : '无'}`)
  }
  return lines.join('\n')
}
