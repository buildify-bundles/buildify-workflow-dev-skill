#!/usr/bin/env node
/**
 * 检查本 skill 有没有新版本：本地 ../version.json 对比仓库 main 分支上的 version.json。
 *
 *   node scripts/update-check.mjs [--force] [--url URL]
 *
 * 先读 GitHub raw，失败再读 Gitee raw，每个 3 秒超时；结果缓存 24 小时
 * （~/.cache/buildify/workflow-dev-update.json），--force 跳过缓存。
 * --url 指定远端（http(s):// 或 file://，离线测试用），此时不读写缓存。
 * 环境变量 BUILDIFY_SKILL_NO_UPDATE_CHECK=1 时不联网，只报本地版本。
 *
 * 输出一行 JSON：current、latest、updateAvailable、required（本地低于 minVersion）、notes、skillDir、
 * checked（cache / github / gitee / url / skipped / failed）。
 * 退出码永远是 0：网络不通不能拖住编排。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_FILE = join(homedir(), '.cache', 'buildify', 'workflow-dev-update.json')
const TTL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 3000
const SOURCES = [
  ['github', 'https://raw.githubusercontent.com/buildify-bundles/buildify-workflow-dev-skill/main/version.json'],
  ['gitee', 'https://gitee.com/buildify/buildify-workflow-dev-skill/raw/main/version.json'],
]
const USAGE = 'usage: node scripts/update-check.mjs [--force] [--url URL]\n'

function parseArgs(argv) {
  const args = { force: false, url: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE)
      process.exit(0)
    } else if (arg === '--force') {
      args.force = true
    } else if (arg === '--url' && argv[i + 1]) {
      args.url = argv[++i]
    } else {
      process.stderr.write(`update-check: 忽略未知参数 ${arg}\n${USAGE}`)
    }
  }
  return args
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim())
  return match ? match.slice(1).map(Number) : null
}

function compare(a, b) {
  const left = parseVersion(a) ?? [0, 0, 0]
  const right = parseVersion(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]
  return 0
}

function isManifest(data) {
  return data && typeof data === 'object' && parseVersion(data.version) != null
}

async function fetchManifest(url) {
  if (url.startsWith('file://')) return readJson(fileURLToPath(url))
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return JSON.parse(await response.text())
}

async function remoteManifest(args) {
  if (args.url) {
    try {
      const data = await fetchManifest(args.url)
      return isManifest(data) ? { data, checked: 'url' } : { data: null, checked: 'failed' }
    } catch {
      return { data: null, checked: 'failed' }
    }
  }
  if (!args.force) {
    const cache = readJson(CACHE_FILE)
    if (isManifest(cache?.data) && Date.now() - Number(cache.checkedAt) < TTL_MS) return { data: cache.data, checked: 'cache' }
  }
  for (const [name, url] of SOURCES) {
    try {
      const data = await fetchManifest(url)
      if (!isManifest(data)) continue
      try {
        mkdirSync(dirname(CACHE_FILE), { recursive: true })
        writeFileSync(CACHE_FILE, `${JSON.stringify({ checkedAt: Date.now(), source: name, data })}\n`)
      } catch {}
      return { data, checked: name }
    } catch {}
  }
  return { data: null, checked: 'failed' }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const local = readJson(join(SKILL_DIR, 'version.json'))
  const current = isManifest(local) ? local.version : null
  const result = {
    current, latest: null, updateAvailable: false, required: false, notes: [], date: null, skillDir: SKILL_DIR, checked: 'skipped',
  }
  if (process.env.BUILDIFY_SKILL_NO_UPDATE_CHECK === '1' && !args.url) return result

  const { data, checked } = await remoteManifest(args)
  result.checked = checked
  if (!data) return result
  result.latest = data.version
  result.date = data.date ?? null
  result.updateAvailable = current == null || compare(data.version, current) > 0
  result.required = current != null && data.minVersion != null && compare(current, data.minVersion) < 0
  if (result.updateAvailable) result.notes = Array.isArray(data.notes) ? data.notes.map(String) : []
  return result
}

main()
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => {
    process.stdout.write(`${JSON.stringify({ current: null, latest: null, updateAvailable: false, required: false, notes: [], skillDir: SKILL_DIR, checked: 'failed', error: String(error?.message ?? error) })}\n`)
  })
