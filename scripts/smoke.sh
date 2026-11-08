#!/usr/bin/env bash
# 离线冒烟：用 fixtures/catalog 里的目录跑 build → layout --check → check → result，不调 buildify。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/fixtures"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
failures=0

expect() {
  local want="$1" name="$2"
  shift 2
  "$@" >"$OUT/last.log" 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name（退出码 $got，期望 $want）"
    sed 's/^/     /' "$OUT/last.log"
    failures=$((failures + 1))
  fi
}

expect 0 "build 生成画布" node "$HERE/build.mjs" "$FIX/spec.json" -o "$OUT/flow.json" --dir "$FIX/catalog"
if grep -q "^WARNING" "$OUT/last.log"; then
  echo "FAIL build 不应有 WARNING"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
fi
expect 0 "layout --check 已是自动排版" node "$HERE/layout.mjs" "$OUT/flow.json" --check
expect 0 "check 对照目录" node "$HERE/check.mjs" "$OUT/flow.json" --catalog-dir "$FIX/catalog"
expect 1 "build 拦下错参数和错出口" node "$HERE/build.mjs" "$FIX/bad-spec.json" -o "$OUT/bad.json" --dir "$FIX/catalog"
expect 0 "catalog show 读缓存" node "$HERE/catalog.mjs" show -b buildify/core -n HttpRequestNode --dir "$FIX/catalog"

node - "$OUT/flow.json" <<'EOF' >"$OUT/assert.log" 2>&1
const flow = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))
const fail = message => { console.error(message); process.exit(1) }
const exec = flow.nodes.filter(node => node.type === 'default')
if (exec.length !== 8) fail(`执行节点应为 8 个，现在 ${exec.length}`)
if (!exec.every(node => /^n-[A-Za-z0-9]{8}$/.test(node.id))) fail('节点 id 不是 n- + 8 位')
if (!flow.edges.every(edge => edge.id === `${edge.source}_${edge.target}`)) fail('边 id 不是 {source}_{target}')
if (!flow.edges.every(edge => edge.data.relations.every(rel => rel.name && rel.label))) fail('出口缺 name / label')
const group = flow.nodes.find(node => node.type === 'group')
if (!group?.style?.width) fail('分组框没有排版尺寸')
if (exec.filter(node => node.parentNode === group.id).length !== 6) fail('分组里应有 6 个节点')
const send = exec.find(node => node.data.summary === '发送日报')
if (send.data.credentials?.credentialsId?.name !== 'test-prod' || send.data.parameters.credentialsId?.name !== 'test-prod') fail('凭证没同时写进 credentials 和 parameters')
if ('triggerSeconds' in exec.find(node => node.data.name === 'SchedulerNode').data.parameters) fail('默认值带进了表单外的键')
const hook = exec.find(node => node.data.name === 'WebhookTriggerNode')
if (hook.data.isTrigger !== true || hook.data.icon !== 'webhook.svg') fail('触发器的 isTrigger / icon 没从目录补齐')
if (!(hook.position.x > group.position.x)) fail('第二段应排在第一段右侧')
if (flow.direction !== 'TB' || JSON.stringify(flow.errors) !== '{}') fail('顶层 direction / errors 不对')
EOF
if [ $? -eq 0 ]; then echo "ok   画布内容断言"; else echo "FAIL 画布内容断言"; sed 's/^/     /' "$OUT/assert.log"; failures=$((failures + 1)); fi

SEND_ID="$(node -e "const f=require('$OUT/flow.json');console.log(f.nodes.find(n=>n.data?.summary==='发送日报').id)")"
cat >"$OUT/validate.json" <<EOF
{"ok": true, "data": {"valid": false, "issues": [
  {"level": "ERROR", "nodeId": "$SEND_ID", "path": "data.credentials.credentialsId", "message": "凭证不存在"},
  {"level": "ERROR", "nodeId": null, "path": "graph", "message": "图中存在环"}
]}}
EOF
expect 1 "result validate 写回 errors" node "$HERE/result.mjs" validate "$OUT/validate.json" --flow "$OUT/flow.json" --write-errors
if node -e "const f=require('$OUT/flow.json');process.exit(f.errors['$SEND_ID']===1&&Object.keys(f.errors).length===1?0:1)"; then
  echo "ok   errors 只计表单 ERROR、不计环"
else
  echo "FAIL errors 汇总不对"; failures=$((failures + 1))
fi

if [ "$failures" -eq 0 ]; then echo "smoke: 全部通过"; else echo "smoke: $failures 项失败"; exit 1; fi
