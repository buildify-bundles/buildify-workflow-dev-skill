#!/usr/bin/env node
/**
 * 步骤 10：生成版本号 → workflow deploy --wait → 发布摘要（result.mjs deploy），一次跑完。
 *
 *   node scripts/release.mjs --stamp                                        # 只打印默认版本号，用来出确认题
 *   node scripts/release.mjs -p P -w W --worker WKR [--worker WKR2] --version-name v20261115-180000 [--remark 说明] [--profile NAME] [-o deploy.json]
 *
 * 版本号默认用确认当下的本地时间 v + yyyyMMdd-HHmmss；用户指定了就照他的，不要改成 v1.0.0。
 * 只发布已经 save-draft 的草稿（不传画布）。--wait 已在 CLI 内轮询，发布后不要再调 workflow deployment / deployments / published。
 * 用户确认版本号和说明之前不要跑。试跑没通过、选了「只保存草稿」或凭证「使用时再选」时不要跑。
 *
 * 退出码：0 发布成功（含 warning）；1 发布没成功（把服务器的 message 原样告诉用户）；3 参数或 CLI 错误。
 */
import { CatalogError, runCliPayload } from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'
import { out, runScript, versionStamp, writeJson } from './lib/run.mjs'

const USAGE = 'usage: node scripts/release.mjs --stamp | -p P -w W --worker WKR --version-name V [--remark R] [--profile NAME] [-o deploy.json]\n'

function fail(message, code = 3) {
  process.stderr.write(`release: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { stamp: false, project: null, workflow: null, workers: [], versionName: null, remark: null, profile: null, out: 'deploy.json' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '--stamp') args.stamp = true
    else if (arg === '-p' || arg === '--project') args.project = value()
    else if (arg === '-w' || arg === '--flow') args.workflow = value()
    else if (arg === '--worker') args.workers.push(value())
    else if (arg === '--version-name') args.versionName = value()
    else if (arg === '--remark') args.remark = value()
    else if (arg === '--profile') args.profile = value()
    else if (arg === '-o' || arg === '--out') args.out = value()
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else fail(`不认识的参数: ${arg}\n${USAGE}`)
  }
  if (args.stamp) return args
  if (!args.project || !args.workflow || !args.workers.length) fail(`要有 -p、-w 和 --worker。${USAGE}`)
  if (!args.versionName) fail('要有 --version-name：先用 --stamp 生成默认版本号，请用户确认后再传进来')
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.stamp) return out(versionStamp())
  const payload = await runCliPayload(['workflow', 'deploy', '-p', args.project, '-w', args.workflow,
    ...args.workers.flatMap(worker => ['--worker', worker]), '--version-name', args.versionName,
    ...(args.remark ? ['--remark', args.remark] : []), '--wait'], args.profile)
  writeJson(args.out, payload)
  const summary = runScript('result.mjs', ['deploy', args.out])
  out(summary.output)
  process.exit(summary.status)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
