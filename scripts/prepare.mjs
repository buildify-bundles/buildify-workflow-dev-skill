#!/usr/bin/env node
/**
 * 步骤 1–3 一次跑完：密钥、skill 版本、工作区、项目、服务器、凭证、同名流程，输出点选题要用的几行。
 *
 *   node scripts/prepare.mjs [--profile P] [-p 项目id或名称] [--last 项目id] [-b 包,包] [--flow 名称关键词]
 *   node scripts/prepare.mjs --pin -p 项目id [--worker 服务器id] [--profile P]     # 写 .buildify-project 固定项目
 *
 * 并行执行 key test、config profiles、update-check、project list。项目按下面顺序定下来，定了就继续并行查
 * 这个项目的 project workers、project credentials（-b 给了就按包过滤）和 workflow list（--flow 给了就按名称过滤）：
 *   1. -p：用户点名的项目（id 或名称，名称要唯一匹配）
 *   2. .buildify-project：从当前目录往上找，工作区一致且项目还在时直接用
 *   3. --last：本次对话里已经确认过的项目
 *   4. 工作区只有一个项目
 * 都不满足时列出候选项目（多个工作区时写成「工作区 / 项目」），由 Agent 出点选题。
 *
 * 工作区：给了 --profile 或 BUILDIFY_OPENAPI_PROFILE 就用它；否则 config profiles 按 tenantId 去重后只有一个就用它；
 * 不止一个时并行查每个工作区的 project list，选定后之后每条命令都加输出里提示的 --profile。
 *
 * --pin 把项目（和可选的默认服务器）写到当前目录的 .buildify-project，只存公开 id，不含密钥：
 *   { "workspace": "<tenantId>", "project": "p-…", "projectName": "…", "worker": "wkr-…" }
 *
 * 退出码：0 正常（可能还有待选项）；2 密钥不可用（输出 reason，按 workspace.md「密钥」处理）；3 参数或 CLI 错误。
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CatalogError, pool, runCliPayload } from './lib/catalog-store.mjs'
import { printHelp } from './lib/help.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PIN_FILE = '.buildify-project'
const USAGE = 'usage: node scripts/prepare.mjs [--profile P] [-p 项目] [--last 项目id] [-b 包,包] [--flow 关键词] | --pin -p 项目id [--worker id]\n'
/** CLI 1.3.0 起 key test 直接返回 missingScopes；这份清单只在旧版 CLI 返回 scopes 时用。 */
const REQUIRED_SCOPES = [
  'bundle:view', 'worker:view', 'project:view', 'project:credentials:view', 'project:workflow:view',
  'project:workflow:create', 'project:workflow:draft', 'project:workflow:submit_test_task', 'project:workflow:deploy',
]

function fail(message, code = 3) {
  process.stderr.write(`prepare: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { profile: process.env.BUILDIFY_OPENAPI_PROFILE || null, project: null, last: null, bundles: [], flow: null, pin: false, worker: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next == null) fail(`${arg} 后面要跟值`)
      return next
    }
    if (arg === '--profile') args.profile = value()
    else if (arg === '-p' || arg === '--project') args.project = value()
    else if (arg === '--last') args.last = value()
    else if (arg === '-b' || arg === '--bundle') args.bundles.push(...value().split(',').map(item => item.trim()).filter(Boolean))
    else if (arg === '--flow') args.flow = value()
    else if (arg === '--pin') args.pin = true
    else if (arg === '--worker') args.worker = value()
    else if (arg === '-h' || arg === '--help') printHelp(import.meta.url)
    else fail(`不认识的参数: ${arg}\n${USAGE}`)
  }
  if (args.pin && !args.project) fail('--pin 要和 -p 项目id 一起用')
  return args
}

const data = payload => (payload?.ok === false ? null : payload?.data ?? null)
const list = value => (Array.isArray(value) ? value : Array.isArray(value?.records) ? value.records : Array.isArray(value?.data) ? value.data : [])

function updateCheck() {
  return new Promise(done => {
    execFile(process.execPath, [join(HERE, 'update-check.mjs')], { encoding: 'utf8', timeout: 10000 }, (error, stdout) => {
      try {
        done(JSON.parse(stdout))
      } catch {
        done(null)
      }
    })
  })
}

function findPin(start = process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    const file = join(dir, PIN_FILE)
    if (existsSync(file)) {
      try {
        return { file, ...JSON.parse(readFileSync(file, 'utf8')) }
      } catch {
        return { file, invalid: true }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function matchProject(projects, ref) {
  if (!ref) return null
  const byId = projects.find(item => item.projectId === ref)
  if (byId) return byId
  const exact = projects.filter(item => item.projectName === ref)
  if (exact.length === 1) return exact[0]
  const loose = projects.filter(item => String(item.projectName ?? '').includes(ref))
  return loose.length === 1 ? loose[0] : null
}

async function pin(args) {
  const key = await runCliPayload(['key', 'test'], args.profile)
  if (key?.ok === false) fail(`密钥不可用: ${key.data?.reason ?? key.msg}`, 2)
  const projects = list(data(await runCliPayload(['project', 'list'], args.profile)))
  const project = matchProject(projects, args.project)
  if (!project) fail(`工作区里没有唯一匹配「${args.project}」的项目`)
  const content = { workspace: key.data.tenantId, project: project.projectId, projectName: project.projectName }
  if (args.worker) content.worker = args.worker
  writeFileSync(join(process.cwd(), PIN_FILE), `${JSON.stringify(content, null, 2)}\n`)
  process.stdout.write(`已写入 ${join(process.cwd(), PIN_FILE)}：项目「${project.projectName}」${args.worker ? `，默认服务器 ${args.worker}` : ''}。`
    + '只含公开 id，可以提交到仓库。\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.pin) return pin(args)
  const lines = []
  const [key, profilesPayload, update] = await Promise.all([
    runCliPayload(['key', 'test'], args.profile),
    runCliPayload(['config', 'profiles']).catch(() => null),
    updateCheck(),
  ])

  if (update?.required) lines.push(`Skill: 当前 ${update.current} 低于最低版本，最新 ${update.latest}：${(update.notes ?? []).join('；')}。必须先问用户是否更新`)
  else if (update?.updateAvailable) lines.push(`Skill: 可从 ${update.current} 更新到 ${update.latest}：${(update.notes ?? []).join('；')}`)

  if (key?.ok === false) {
    const reason = key.data?.reason ?? 'unknown'
    lines.unshift(`密钥: 不可用 reason=${reason}（${key.msg ?? ''}）`)
    if (reason === 'profile_required') {
      const profiles = list(key.data?.profiles ?? data(profilesPayload)?.profiles)
      lines.push(`本机密钥: ${profiles.map(item => `${item.name}（${item.tenantId ?? '?'}，${item.keyName ?? '?'}）`).join('；')}`)
    }
    process.stdout.write(`${lines.join('\n')}\n`)
    process.exit(2)
  }
  const keyData = key.data ?? {}
  const scopes = Array.isArray(keyData.scopes) ? keyData.scopes : []
  const missing = Array.isArray(keyData.missingScopes) ? keyData.missingScopes
    : scopes.includes('*') ? [] : REQUIRED_SCOPES.filter(scope => !scopes.some(have => have === scope
      || (have.endsWith(':*') && scope.startsWith(have.slice(0, -1)))))
  const profiles = list(data(profilesPayload)?.profiles)
  const workspaces = new Map()
  for (const item of profiles) {
    if (!item?.tenantId) continue
    const kept = workspaces.get(item.tenantId)
    if (!kept || (item.current && !kept.current)) workspaces.set(item.tenantId, item)
  }
  const currentProfile = args.profile ?? profiles.find(item => item.tenantId === keyData.tenantId && item.current)?.name
    ?? profiles.find(item => item.tenantId === keyData.tenantId)?.name ?? null
  lines.unshift(`密钥: 可用（工作区 ${currentProfile ?? '?'} ${keyData.tenantId ?? ''}，密钥 ${keyData.keyName ?? '?'}）`
    + `${missing.length ? `；缺少权限 ${missing.join(', ')}` : ''}`)

  const pinned = findPin()
  const workspaceFixed = Boolean(args.profile) || workspaces.size <= 1
    || Boolean(pinned && !pinned.invalid && pinned.workspace === keyData.tenantId)
  const targets = workspaceFixed
    ? [{ profile: args.profile, name: currentProfile, tenantId: keyData.tenantId }]
    : [...workspaces.values()].map(item => ({ profile: item.name, name: item.name, tenantId: item.tenantId }))
  lines.push(workspaceFixed ? `工作区: ${currentProfile ?? '默认'}${workspaces.size > 1 ? `（本机共 ${workspaces.size} 个工作区）` : ''}`
    : `工作区: 本机有 ${workspaces.size} 个，还没定；下面按「工作区 / 项目」列出`)

  const projectLists = await pool(targets.map(target => async () => {
    const payload = await runCliPayload(['project', 'list'], target.profile).catch(error => ({ ok: false, msg: error.message }))
    return { target, ok: payload?.ok !== false, msg: payload?.msg, projects: list(data(payload)) }
  }))

  let chosen = null
  let source = ''
  if (workspaceFixed) {
    const { projects } = projectLists[0]
    if (args.project) {
      chosen = matchProject(projects, args.project)
      source = '用户点名'
      if (!chosen) lines.push(`项目: 没有唯一匹配「${args.project}」的项目，请用户点选`)
    }
    if (!chosen && pinned && !pinned.invalid && pinned.workspace === keyData.tenantId) {
      chosen = projects.find(item => item.projectId === pinned.project) ?? null
      source = `仓库固定 ${pinned.file}`
      if (!chosen) lines.push(`项目: ${pinned.file} 里的项目 ${pinned.project} 已不存在，忽略它`)
    } else if (pinned?.invalid) lines.push(`项目: ${pinned.file} 不是合法 JSON，忽略它`)
    else if (pinned && pinned.workspace !== keyData.tenantId && !chosen) {
      lines.push(`项目: ${pinned.file} 固定的是工作区 ${pinned.workspace}，当前密钥是 ${keyData.tenantId}，忽略它`)
    }
    if (!chosen && args.last) {
      chosen = projects.find(item => item.projectId === args.last) ?? null
      source = '本次对话已确认'
    }
    if (!chosen && projects.length === 1) {
      chosen = projects[0]
      source = '工作区只有这一个项目'
    }
  }

  if (!chosen) {
    lines.push('项目: 待选')
    for (const { target, ok, msg, projects } of projectLists) {
      const prefix = workspaceFixed ? '' : `${target.name} / `
      if (!ok) {
        lines.push(`  （工作区 ${target.name} 暂时查不到项目：${msg ?? '未知原因'}）`)
        continue
      }
      for (const item of projects) {
        lines.push(`  - ${prefix}${item.projectName} ${item.projectId}${item.remark ? ` — ${item.remark}` : ''}`
          + `${workspaceFixed ? '' : `  [--profile ${target.profile}]`}`)
      }
      if (!projects.length) lines.push(`  （${prefix || '本工作区'}没有项目）`)
    }
    lines.push('选定后带 -p（多工作区再带 --profile）重跑本脚本，查服务器、凭证和流程。')
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }

  const profile = args.profile
  lines.push(`项目: 「${chosen.projectName}」${chosen.projectId}（${source}）`)
  const credentialQueries = args.bundles.length ? args.bundles.map(bundle => ['-b', bundle]) : [[]]
  const [workers, flows, ...credentialPayloads] = await Promise.all([
    runCliPayload(['project', 'workers', '-p', chosen.projectId], profile),
    runCliPayload(['workflow', 'list', '-p', chosen.projectId, ...(args.flow ? ['-k', args.flow] : [])], profile),
    ...credentialQueries.map(extra => runCliPayload(['project', 'credentials', '-p', chosen.projectId, ...extra], profile)),
  ])

  const workerList = list(data(workers))
  const online = workerList.filter(item => item.isOnline)
  lines.push(`服务器（${online.length}/${workerList.length} 在线）:`)
  for (const item of workerList) {
    const fixed = pinned?.worker && pinned.worker === item.workerId ? '  [仓库默认]' : ''
    lines.push(`  - ${item.workerName} ${item.workerId} ${item.isOnline ? '在线' : '离线，不能试跑'}${item.remark ? ` — ${item.remark}` : ''}${fixed}`)
  }
  if (!workerList.length) lines.push('  （项目里没有服务器，先到控制台「节点管理」添加）')

  const credentials = credentialPayloads.flatMap(payload => list(data(payload)))
  lines.push(`凭证${args.bundles.length ? `（${args.bundles.join(', ')}）` : ''}: ${credentials.length ? '' : '没有'}`)
  for (const item of credentials) lines.push(`  - ${item.bundleName} ${item.type} name=${item.name}「${item.label ?? item.name}」`)

  const flowList = list(data(flows))
  const shown = flowList.slice(0, args.flow ? 20 : 8)
  lines.push(`流程${args.flow ? `（名称含「${args.flow}」）` : ''}: 共 ${flowList.length} 条${shown.length < flowList.length ? `，列前 ${shown.length} 条` : ''}`)
  for (const item of shown) {
    lines.push(`  - ${item.workflowName} ${item.workflowId} ${item.publishedVersionId ? '已发布' : '仅草稿'}${item.updatedAt ? ` 更新于 ${item.updatedAt}` : ''}`)
  }
  if (workspaces.size > 1 && profile) lines.push(`之后每条命令和脚本都加 --profile ${profile}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

main().catch(error => fail(error instanceof CatalogError ? error.message : error.stack))
