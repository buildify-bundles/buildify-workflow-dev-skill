/**
 * `--help` 打印脚本文件头那段说明（用法、输入格式、退出码），Agent 不用读脚本源码。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function headerDoc(moduleUrl) {
  const text = readFileSync(fileURLToPath(moduleUrl), 'utf8')
  const match = /\/\*\*([\s\S]*?)\*\//.exec(text)
  if (!match) return ''
  return match[1].split('\n').map(line => line.replace(/^\s*\* ?/, '')).join('\n').trim()
}

export function printHelp(moduleUrl) {
  process.stdout.write(`${headerDoc(moduleUrl)}\n`)
  process.exit(0)
}
