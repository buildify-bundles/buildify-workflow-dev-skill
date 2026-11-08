/**
 * 目录缓存：`bundle nodes` / `node-properties` / `node-relations` 的 --json 输出按固定文件名存在一个目录里。
 *
 *   <dir>/<包名>@<版本>.nodes.json
 *   <dir>/<包名>@<版本>.<节点>.properties.json
 *   <dir>/<包名>@<版本>.<节点>.relations.json
 *
 * 包名里的 `/` 换成 `__`。catalog.mjs、build.mjs、check.mjs 共用这里的读写规则。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_DIR = '/tmp/buildify-catalog'

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

export function runCli(cliArgs, profile) {
  const argv = ['--json', ...(profile ? ['--profile', profile] : []), ...cliArgs]
  return new Promise((resolve, reject) => {
    execFile('buildify', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (!stdout) {
        reject(new CatalogError(`buildify ${argv.join(' ')} 执行失败: ${error?.message ?? '没有输出'}`))
        return
      }
      let payload
      try {
        payload = JSON.parse(stdout)
      } catch {
        reject(new CatalogError(`buildify ${argv.join(' ')} 输出不是 JSON`))
        return
      }
      if (payload?.ok === false) {
        const reason = payload.data?.reason ? `（${payload.data.reason}）` : ''
        reject(new CatalogError(`buildify ${argv.join(' ')} 失败${reason}: ${payload.msg ?? ''}`))
        return
      }
      resolve(payload)
    })
  })
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
 * version 为空时先拉 `bundle nodes` 拿到实际版本再拉其余两类。已有缓存默认复用，refresh 为 true 时重拉。
 */
export async function fetchBundle({ dir, bundleName, version, nodes = [], profile, refresh = false }) {
  mkdirSync(dir, { recursive: true })
  let resolved = version
  let nodesPayload
  if (resolved && !refresh && existsSync(catalogFile(dir, bundleName, resolved))) {
    nodesPayload = readJsonFile(catalogFile(dir, bundleName, resolved), '目录')
  } else {
    nodesPayload = await runCli(['bundle', 'nodes', '-b', bundleName, ...(resolved ? ['-V', String(resolved)] : [])], profile)
    resolved = unwrap(nodesPayload, `bundle nodes -b ${bundleName}`)?.bundleVersion ?? resolved
    if (!resolved) throw new CatalogError(`bundle nodes -b ${bundleName} 没有返回 bundleVersion`)
    writeFileSync(catalogFile(dir, bundleName, resolved), JSON.stringify(nodesPayload))
  }
  const known = new Set((unwrap(nodesPayload, 'bundle nodes')?.nodes ?? []).map(node => node?.name))
  const missing = nodes.filter(name => !known.has(name))
  if (missing.length) {
    throw new CatalogError(`${bundleName}@${resolved} 里没有节点 ${missing.join(', ')}（可用: ${[...known].join(', ')}）`)
  }

  const tasks = []
  for (const name of nodes) {
    for (const kind of ['properties', 'relations']) {
      const file = catalogFile(dir, bundleName, resolved, name, kind)
      if (!refresh && existsSync(file)) continue
      tasks.push(async () => {
        const payload = await runCli(['bundle', `node-${kind}`, '-b', bundleName, '-n', name, '-V', String(resolved)], profile)
        writeFileSync(file, JSON.stringify(payload))
      })
    }
  }
  await pool(tasks)
  return resolved
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

/** 读缓存里一个节点的表单或出口（kind = properties | relations），没有缓存返回 null。 */
export function loadNodeFile(dir, bundleName, version, node, kind) {
  const file = catalogFile(dir, bundleName, version, node, kind)
  if (!existsSync(file)) return null
  return unwrap(readJsonFile(file, kind === 'properties' ? '表单' : '出口'), file)
}

// ---------------------------------------------------------------------------
// 表单摘要
// ---------------------------------------------------------------------------

const DISPLAY_ONLY = new Set(['Space', 'Divider', 'Notice', 'Alert', 'Title'])

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

function describeFields(fields, defaults, indent, lines) {
  for (const prop of fields) {
    if (!isField(prop) || DISPLAY_ONLY.has(prop.uiComponent)) continue
    const flags = []
    if (prop.expression || prop.typeOptions?.enableExpression) flags.push('表达式')
    if (prop.uiComponent === 'CredentialSelect' && prop.typeOptions?.credentialsType) flags.push(`凭证 ${prop.typeOptions.credentialsType}`)
    const value = defaults && Object.hasOwn(defaults, prop.name) ? defaults[prop.name] : prop.defaultValue
    const def = value === undefined ? '' : ` 默认=${JSON.stringify(value).slice(0, 60)}`
    lines.push(`${indent}${prop.required ? '*' : ' '}${prop.name} ${prop.uiComponent}${describeEnum(prop)}${def}`
      + `${flags.length ? ` (${flags.join('，')})` : ''}${prop.label ? ` — ${prop.label}` : ''}${describeShow(prop)}`)
    const children = (prop.options ?? []).filter(isField)
    if (children.length) describeFields(children, value && typeof value === 'object' ? value : null, `${indent}    `, lines)
  }
}

/** 一个节点的紧凑摘要（多行文本）：目录字段、参数、凭证槽、出口。 */
export function describeNode({ bundleName, version, entry, properties, relations }) {
  const lines = []
  const name = entry?.name ?? properties?.name ?? relations?.name
  const icon = entry?.icon ?? properties?.icon
  const label = entry?.label ?? properties?.label
  lines.push(`## ${bundleName}@${version} ${name}  label=${label ?? '?'}  icon=${icon ?? '?'}${entry?.isTrigger ? '  触发器' : ''}`)
  if (properties) {
    const fields = properties.schema?.properties ?? []
    if (fields.length) {
      lines.push('参数（* 必填）:')
      describeFields(fields, properties.schema?.defaultValue ?? null, '  ', lines)
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
