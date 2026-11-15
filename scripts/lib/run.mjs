/**
 * 组合脚本（ship / trial / release）共用：调同目录的其他脚本、写结果文件、生成版本号。
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 跑 scripts/<name>，返回 { status, output }（stdout + stderr 合在一起）。 */
export function runScript(name, args) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, name), ...args], { encoding: 'utf8' })
  return { status: result.status ?? 3, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd() }
}

export function writeJson(file, payload) {
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
}

/** 本地时间 v + yyyyMMdd-HHmmss。 */
export function versionStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `v${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function out(lines) {
  process.stdout.write(`${[].concat(lines).filter(line => line != null).join('\n')}\n`)
}
