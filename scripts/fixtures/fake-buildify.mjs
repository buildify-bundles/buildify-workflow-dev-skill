#!/usr/bin/env node
// smoke.sh 用的假 buildify：把参数记到 $FAKE_CLI_LOG，按 bundle nodes / schema / doc 返回固定数据。
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2).filter((arg, index, all) => arg !== '--json' && arg !== '--profile' && all[index - 1] !== '--profile')
appendFileSync(process.env.FAKE_CLI_LOG, `${argv.join(' ')}\n`)
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null)
const bundleName = option('-b')
const bundleVersion = option('-V') ?? process.env.FAKE_LATEST ?? '2.0.0'
const reply = data => process.stdout.write(JSON.stringify({ ok: true, code: 0, msg: 'ok', data }))
const node = { name: 'EchoNode', label: 'Echo', icon: 'echo.svg', isTrigger: false }

if (argv[0] === 'bundle' && argv[1] === 'nodes') reply({ bundleName, bundleVersion, nodes: [node] })
else if (argv[0] === 'bundle' && argv[1] === 'schema') {
  reply({ bundleName, bundleVersion, nodes: [{ ...node, properties: [], relations: [{ name: 'Success', label: '成功' }] }] })
} else if (argv[0] === 'bundle' && argv[1] === 'doc' && option('--node')) {
  process.stdout.write(JSON.stringify({ ok: false, code: 1, msg: `文档中没有节点 ${option('--node')} 的章节`, data: null }))
} else if (argv[0] === 'bundle' && argv[1] === 'doc') {
  const content = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'doc.md'), 'utf8')
  reply({ bundleName, bundleVersion, content })
} else {
  process.stdout.write(JSON.stringify({ ok: false, code: 2, msg: `假 buildify 不支持: ${argv.join(' ')}`, data: null }))
}
