#!/usr/bin/env node
/**
 * 步骤 7–8 一次跑完：check（自动 --fix）→ workflow validate → result validate（写回 errors）→ 新建流程（可选）→ save-draft。
 * 新建时用 `workflow create -f` 把画布一起存进去（CLI 1.3.0），不再单独 save-draft。
 * 任何一步没过就停下，打印要改的地方，后面的步骤不执行。
 *
 *   node scripts/ship.mjs flow.json -p P -w W [--profile NAME] [--catalog-dir DIR]
 *   node scripts/ship.mjs flow.json -p P --create "流程名称" --worker WKR [--remark 简介] [--profile NAME]
 *   node scripts/ship.mjs flow.json -p P --validate-only            # 只校验，不保存
 *   … --credentials-later    用户选了「使用时再选」：剩下的 ERROR 全是空着的凭证槽时照常保存，并列出待选的槽
 *
 * 校验结果存在 flow.json 同目录的 validate.json；save-draft 冲突时最新草稿存成 latest-draft.json，
 * 用 build.mjs --base latest-draft.json 重放 spec 改动后再跑本脚本，不要盲目重试。
 * 只剩环时照常保存，但要确认环上有离开循环的出口。
 *
 * 输出最后一行是 `ship: …`，新建时带流程 id（之后 trial / release 用 -w）。
 * 退出码：0 已保存（或 --validate-only 校验通过）；1 check / validate 有 ERROR；4 新建或保存失败（含冲突）；3 参数错误。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CatalogError, catalogDir, credentialSlots, fetchBundle, loadNodeFile, runCliPayload } from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'
import { out, runScript, writeJson } from './lib/run.mjs'

const USAGE = 'usage: node scripts/ship.mjs flow.json -p P (-w W | --create 名称 --worker WKR [--remark R] | --validate-only) [--credentials-later] [--profile NAME] [--catalog-dir DIR]\n'

function fail(message, code = 3) {
  process.stderr.write(`ship: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { flow: null, project: null, workflow: null, create: null, workers: [], remark: null, profile: null, catalogDir: null, validateOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '-p' || arg === '--project') args.project = value()
    else if (arg === '-w' || arg === '--flow') args.workflow = value()
    else if (arg === '--create') args.create = value()
    else if (arg === '--worker') args.workers.push(value())
    else if (arg === '--remark') args.remark = value()
    else if (arg === '--profile') args.profile = value()
    else if (arg === '--catalog-dir') args.catalogDir = value()
    else if (arg === '--validate-only') args.validateOnly = true
    else if (arg === '--credentials-later') args.credentialsLater = true
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else if (!args.flow) args.flow = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.flow || !args.project) fail(`要有 flow.json 和 -p。${USAGE}`)
  if (!args.validateOnly && !args.workflow && !args.create) fail(`保存要 -w 已有流程，或 --create 名称 新建。${USAGE}`)
  if (args.create && !args.workers.length) fail('--create 要带 --worker（和试跑、发布用同一台）')
  return args
}

/**
 * --credentials-later：validate 的 ERROR 全是空着的凭证槽（对照目录表单里的 CredentialSelect）时，
 * 返回「节点 summary 的槽」列表；还有别的 ERROR 返回 null。
 */
async function pendingCredentials(validation, args) {
  const issues = (validation?.data?.issues ?? []).filter(issue => issue?.level === 'ERROR')
  const flow = JSON.parse(readFileSync(args.flow, 'utf8'))
  const byId = new Map((flow.nodes ?? []).map(node => [node.id, node]))
  const dir = catalogDir(args.catalogDir, args.profile)
  const pending = []
  for (const issue of issues) {
    const data = byId.get(issue.nodeId)?.data
    const slot = /^data\.(?:parameters|credentials)\.([^.]+)$/.exec(issue.path ?? '')?.[1]
    if (!data?.bundleName || !slot) return null
    const version = await fetchBundle({ dir, bundleName: data.bundleName, version: data.bundleVersion, nodes: [data.name], profile: args.profile })
    const slots = credentialSlots(loadNodeFile(dir, data.bundleName, version, data.name, 'properties'))
    if (!slots.some(item => item.slot === slot)) return null
    pending.push(`${data.summary ?? issue.nodeId} 的 ${slot}`)
  }
  return pending.length ? pending : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const profileArgs = args.profile ? ['--profile', args.profile] : []
  const folder = dirname(args.flow)

  const check = runScript('check.mjs', [args.flow, '--fetch', '--fix', ...profileArgs,
    ...(args.catalogDir ? ['--catalog-dir', args.catalogDir] : [])])
  out(check.output)
  if (check.status !== 0) {
    out(`ship: check 没过（退出码 ${check.status}），改 spec 重跑 build 后再 ship。`)
    process.exit(check.status === 1 ? 1 : 3)
  }

  const validation = await runCliPayload(['workflow', 'validate', '-p', args.project, '-f', args.flow], args.profile)
  const validateFile = join(folder, 'validate.json')
  writeJson(validateFile, validation)
  const result = runScript('result.mjs', ['validate', validateFile, '--flow', args.flow, '--write-errors'])
  out(result.output)
  if (result.status !== 0) {
    const pending = args.credentialsLater ? await pendingCredentials(validation, args) : null
    if (!pending) {
      const hint = args.credentialsLater ? '（除了空着的凭证槽还有别的 ERROR）' : ''
      out(`ship: validate 有 ERROR${hint}，没有保存。按上面的节点改 spec / 参数后重跑 build 和 ship。`)
      process.exit(1)
    }
    if (args.validateOnly) return out(`ship: 只剩凭证待选（${pending.join('、')}），其余校验通过（--validate-only，没有保存）`)
    out(`凭证待选: ${pending.join('、')}。保存后用户在控制台打开流程再选；补上之前不要试跑、不要发布。`)
  }
  if (args.validateOnly) return out('ship: 校验通过（--validate-only，没有保存）')

  let workflow = args.workflow
  if (args.create) {
    const createArgs = ['workflow', 'create', '-p', args.project, '-n', args.create,
      ...args.workers.flatMap(worker => ['--worker', worker]), ...(args.remark ? ['--remark', args.remark] : [])]
    let created
    let withCanvas = true
    try {
      created = await runCliPayload([...createArgs, '-f', args.flow], args.profile)
    } catch {
      withCanvas = false
      created = await runCliPayload(createArgs, args.profile)
    }
    if (created?.ok === false) {
      out(`ship: 新建流程失败: ${created.msg ?? ''}（HTTP ${created.http_status ?? '?'}）`)
      process.exit(4)
    }
    workflow = created.data?.workflowId ?? created.data?.id
    if (!workflow) {
      out(`ship: 新建返回里没有流程 id: ${JSON.stringify(created.data).slice(0, 300)}`)
      process.exit(4)
    }
    if (withCanvas) {
      const version = created.data?.version
      out(`ship: 已新建流程「${args.create}」并保存草稿 -w ${workflow}${version != null ? `（version ${version}）` : ''}`)
      return
    }
    out(`已新建流程「${args.create}」${workflow}`)
  }

  const saved = await runCliPayload(['workflow', 'save-draft', '-p', args.project, '-w', workflow, '-f', args.flow], args.profile)
  if (saved?.ok === false) {
    if (saved.data && typeof saved.data === 'object') {
      const latest = join(folder, 'latest-draft.json')
      writeJson(latest, saved)
      out(`ship: 保存冲突，最新草稿已存到 ${latest}。用 build.mjs spec.json --base ${latest} 重放改动后再 ship -w ${workflow}。`)
    } else out(`ship: 保存失败: ${saved.msg ?? ''}（HTTP ${saved.http_status ?? '?'}）`)
    process.exit(4)
  }
  const version = saved.data?.version ?? saved.data?.draftVersion
  out(`ship: 草稿已保存 -w ${workflow}${version != null ? `（version ${version}）` : ''}`)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
