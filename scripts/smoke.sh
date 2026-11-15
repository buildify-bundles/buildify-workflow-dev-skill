#!/usr/bin/env bash
# 离线冒烟：用 fixtures/catalog 里的目录跑 build → layout --check → check → result，不调真 buildify。
# 缓存用例用 fixtures/fake-buildify.mjs 记调用次数；缓存目录指到临时目录，不动用户的缓存。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FIX="$HERE/fixtures"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
export BUILDIFY_CATALOG_DIR="$OUT/cache"
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
if (JSON.stringify(Object.keys(group.data.parameters)) !== '["groupLabel"]') fail('分组 parameters 应只有 groupLabel，样式走系统默认')
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

# --base：只改参数保留 id；同类型写了 name 也保留 id；remove 后新建同类型失败；切换类型换新 id；出口对不上失败
HTTP_ID="$(node -e "const f=require('$OUT/flow.json');console.log(f.nodes.find(n=>n.data?.summary==='拉取预报').id)")"
cp "$OUT/flow.json" "$OUT/base.json"
cat >"$OUT/patch.json" <<EOF
{"nodes":[{"id":"$HTTP_ID","parameters":{"timeout":20}}]}
EOF
expect 0 "build --base 只改参数" node "$HERE/build.mjs" "$OUT/patch.json" --base "$OUT/base.json" -o "$OUT/patched.json" --dir "$FIX/catalog" --no-layout
if node -e "
const flow=require('$OUT/patched.json');
const node=flow.nodes.find(n=>n.id==='$HTTP_ID');
if(!node) process.exit(1);
if(node.data.name!=='HttpRequestNode') process.exit(1);
if(node.data.parameters.timeout!==20) process.exit(1);
if(!node.data.parameters.url) process.exit(1);
"; then
  echo "ok   只改参数时 id 不变、参数合并"
else
  echo "FAIL 只改参数时 id 不变、参数合并"; failures=$((failures + 1))
fi

cat >"$OUT/same-type.json" <<EOF
{"nodes":[{"id":"$HTTP_ID","bundle":"buildify/core","name":"HttpRequestNode","summary":"拉取预报","parameters":{"timeout":30}}]}
EOF
expect 0 "build --base 同类型写了 name" node "$HERE/build.mjs" "$OUT/same-type.json" --base "$OUT/base.json" -o "$OUT/same-type-out.json" --dir "$FIX/catalog" --no-layout
if node -e "
const flow=require('$OUT/same-type-out.json');
const node=flow.nodes.find(n=>n.id==='$HTTP_ID');
if(!node) process.exit(1);
if(node.data.name!=='HttpRequestNode') process.exit(1);
if(node.data.parameters.timeout!==30) process.exit(1);
if(!node.data.parameters.url) process.exit(1);
if(flow.nodes.filter(n=>n.data?.name==='HttpRequestNode').length!==1) process.exit(1);
"; then
  echo "ok   同类型写了 name 时 id 不变、参数合并"
else
  echo "FAIL 同类型写了 name 时 id 不变、参数合并"; failures=$((failures + 1))
fi

cat >"$OUT/recreate.json" <<EOF
{"nodes":[{"key":"http2","bundle":"buildify/core","name":"HttpRequestNode","summary":"再拉一次","parameters":{"url":"https://example.com"}}],"remove":["$HTTP_ID"]}
EOF
expect 1 "build --base remove 后新建同类型" node "$HERE/build.mjs" "$OUT/recreate.json" --base "$OUT/base.json" -o "$OUT/recreate-out.json" --dir "$FIX/catalog" --no-layout
if [ -e "$OUT/recreate-out.json" ]; then
  echo "FAIL remove 后新建同类型时不应写文件"
  failures=$((failures + 1))
elif ! grep -q "类型没变" "$OUT/last.log" || ! grep -q "$HTTP_ID" "$OUT/last.log"; then
  echo "FAIL remove 后新建同类型的报错没点出旧 id"
  sed 's/^/     /' "$OUT/last.log"
  failures=$((failures + 1))
else
  echo "ok   remove 后新建同类型不写文件"
fi

cat >"$OUT/switch.json" <<EOF
{"nodes":[{"id":"$HTTP_ID","bundle":"buildify/core","name":"JsFunctionNode","summary":"组装报文",
  "parameters":{"code":"// 入参：msg\\n// 出参：下游整个 msg\\n\\n// --- 1. 返回 ---\\nreturn msg;"}}]}
EOF
expect 0 "build --base 切换类型" node "$HERE/build.mjs" "$OUT/switch.json" --base "$OUT/base.json" -o "$OUT/switched.json" --dir "$FIX/catalog" --no-layout
node - "$OUT/base.json" "$OUT/switched.json" "$HTTP_ID" <<'EOF' >"$OUT/assert-switch.log" 2>&1
const fs = require('node:fs')
const [basePath, switchedPath, oldId] = process.argv.slice(2)
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
const flow = JSON.parse(fs.readFileSync(switchedPath, 'utf8'))
const fail = message => { console.error(message); process.exit(1) }
if (flow.nodes.some(node => node.id === oldId)) fail(`旧 id ${oldId} 还在画布上`)
const fresh = flow.nodes.find(node => node.data?.summary === '组装报文')
if (!fresh) fail('找不到切换后的节点')
if (!/^n-[A-Za-z0-9]{8}$/.test(fresh.id)) fail(`新 id 格式不对: ${fresh.id}`)
if (fresh.id === oldId) fail('切换后仍是旧 id')
if (fresh.data.name !== 'JsFunctionNode') fail('类型没换成 JsFunctionNode')
if ('url' in (fresh.data.parameters ?? {})) fail('旧节点参数 url 被带进了新节点')
if (!String(fresh.data.parameters?.code || '').includes('return msg')) fail('新参数 code 没写上')
const oldEdges = base.edges.filter(edge => edge.source === oldId || edge.target === oldId)
if (!oldEdges.length) fail('基线里没有连到旧节点的边')
for (const edge of oldEdges) {
  const source = edge.source === oldId ? fresh.id : edge.source
  const target = edge.target === oldId ? fresh.id : edge.target
  const found = flow.edges.find(item => item.source === source && item.target === target)
  if (!found) fail(`边没改接到新 id: ${source} → ${target}`)
  if (found.id !== `${source}_${target}`) fail(`边 id 没重算: ${found.id}`)
}
if (flow.edges.some(edge => edge.source === oldId || edge.target === oldId)) fail('还有边指向旧 id')
EOF
if [ $? -eq 0 ]; then echo "ok   切换类型换新 id 并改写边"; else echo "FAIL 切换类型换新 id 并改写边"; sed 's/^/     /' "$OUT/assert-switch.log"; failures=$((failures + 1)); fi

node -e "
const fs=require('node:fs');
const flow=JSON.parse(fs.readFileSync('$OUT/base.json','utf8'));
const edge=flow.edges.find(e=>e.source==='$HTTP_ID' && (e.data.relations||[]).some(r=>r.name==='Failure'));
if(!edge) throw new Error('找不到 Failure 出边');
edge.data.relations=[{name:'BogusExit',label:'假出口'}];
fs.writeFileSync('$OUT/base-bad-exit.json', JSON.stringify(flow,null,2)+'\n');
"
expect 1 "build --base 切换后出口对不上" node "$HERE/build.mjs" "$OUT/switch.json" --base "$OUT/base-bad-exit.json" -o "$OUT/switch-bad.json" --dir "$FIX/catalog" --no-layout
if [ -e "$OUT/switch-bad.json" ]; then
  echo "FAIL 出口对不上时不应写文件"
  failures=$((failures + 1))
else
  echo "ok   出口对不上时不写文件"
fi

if node "$HERE/build.mjs" --help | grep -q "spec 只写业务内容"; then echo "ok   build --help 打印 spec 格式"; else echo "FAIL build --help 没打印 spec 格式"; failures=$((failures + 1)); fi

expect 0 "build 展开 http 宏" node "$HERE/build.mjs" "$FIX/http-spec.json" -o "$OUT/http.json" --dir "$FIX/catalog"
if grep -q "^WARNING" "$OUT/last.log"; then
  echo "FAIL http 宏不应有 WARNING"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
fi
node - "$OUT/http.json" <<'EOF' >"$OUT/assert-http.log" 2>&1
const flow = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'))
const fail = message => { console.error(message); process.exit(1) }
const byName = name => flow.nodes.filter(node => node.data?.name === name)
const [hook] = byName('WebhookTriggerNode')
const [check] = byName('ValidateNode')
const responses = byName('WebhookResponseNode')
if (!hook || !check || responses.length !== 3) fail('应展开成触发器 + 校验 + 三个应答（400、500、业务）')
const p = hook.data.parameters
if (JSON.stringify(p.methods) !== '["GET"]' || p.responseMode !== 'WebhookNode' || p.options?.cors?.enabled !== false) fail('触发器默认值不对')
if (JSON.stringify(p.options.cors.allowedMethods) !== '["GET"]') fail('CORS allowedMethods 应与 methods 一致')
const rules = check.data.parameters.rules
if (rules.length !== 3 || rules[0].check !== 'required' || rules[1].pattern !== '^\\d+$' || rules[2].skipIfMissing !== true) fail(`校验规则不对: ${JSON.stringify(rules)}`)
const invalid = responses.find(node => node.data.parameters.options?.responseStatusCode === 400)
if (!invalid) fail('没有 400 应答')
const edge = (from, to) => flow.edges.find(item => item.source === from.id && item.target === to.id)
if (!edge(hook, check)) fail('触发器没接到校验')
if (edge(check, invalid)?.data.relations[0].name !== 'Invalid') fail('Invalid 没接到 400 应答')
const failed = responses.find(node => node.data.parameters.options?.responseStatusCode === 500)
if (!failed) fail('没有 500 应答')
if (edge(check, failed)?.data.relations[0].name !== 'Failure') fail('校验节点的 Failure 没接到 500 应答')
const reply = responses.find(node => node !== invalid && node !== failed)
if (edge(check, reply)?.data.relations[0].name !== 'Success') fail('宏 key 出发的边应接在校验通过之后')
if (edge(hook, reply)) fail('不应从触发器直接连到应答')
EOF
if [ $? -eq 0 ]; then echo "ok   http 宏内容断言"; else echo "FAIL http 宏内容断言"; sed 's/^/     /' "$OUT/assert-http.log"; failures=$((failures + 1)); fi

cat >"$OUT/http-js.json" <<'EOF'
{"nodes":[
  {"key":"api","http":{"method":"GET","path":"/echo/:id","validate":["pathParams.id"]}},
  {"key":"work","bundle":"buildify/core","name":"JsFunctionNode","summary":"组装结果",
   "parameters":{"code":"// 入参：msg.pathParams.id；出参：{ id }\n\n// --- 1. 返回 ---\nreturn { id: msg.pathParams.id };"}},
  {"key":"reply","bundle":"buildify/core","name":"WebhookResponseNode","summary":"返回结果",
   "parameters":{"responseType":"custom","outputType":"json","jsonValue":"={{msg}}"}}
],"edges":[["api","work"],["work","reply"]]}
EOF
expect 0 "http 宏自动接 Failure" node "$HERE/build.mjs" "$OUT/http-js.json" -o "$OUT/http-js-out.json" --dir "$FIX/catalog" --no-layout
if grep -q "^WARNING" "$OUT/last.log"; then
  echo "FAIL 接好 Failure 后不应有 WARNING"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
elif node -e "
const flow=require('$OUT/http-js-out.json');
const err=flow.nodes.find(n=>n.data?.parameters?.options?.responseStatusCode===500);
const js=flow.nodes.find(n=>n.data?.name==='JsFunctionNode');
const e=flow.edges.find(x=>x.source===js.id&&x.target===err.id);
process.exit(e&&e.data.relations.some(r=>r.name==='Failure')?0:1)"; then
  echo "ok   JS 的 Failure 接到了 500 应答"
else
  echo "FAIL JS 的 Failure 没接到 500 应答"; failures=$((failures + 1))
fi
sed 's/"validate":\["pathParams.id"\]/"validate":["pathParams.id"],"onError":false/' "$OUT/http-js.json" >"$OUT/http-js-off.json"
expect 0 "onError false 时照常生成" node "$HERE/build.mjs" "$OUT/http-js-off.json" -o "$OUT/http-js-off-out.json" --dir "$FIX/catalog" --no-layout
if grep -q "走不到 Webhook 响应" "$OUT/last.log" && grep -q "组装结果 的 Failure" "$OUT/last.log"; then
  echo "ok   预校验提示走不到应答的出口"
else
  echo "FAIL 预校验没提示走不到应答的出口"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
fi
expect 0 "draft 看没有默认值的节点" node "$HERE/draft.mjs" "$OUT/http-js-out.json" --dir "$FIX/catalog"
if grep -q "不在缓存里" "$OUT/last.log"; then
  echo "FAIL JS 节点没有默认值不应算成缺缓存"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
else
  echo "ok   draft 不把没有默认值当成缺缓存"
fi

expect 0 "draft 输出 spec 视图" node "$HERE/draft.mjs" "$OUT/http.json" --dir "$FIX/catalog"
if grep -q '"Invalid"\]  # 校验参数 → 参数错误' "$OUT/last.log" && grep -q 'rules = ' "$OUT/last.log" && ! grep -q 'keepOtherFields' "$OUT/last.log"; then
  echo "ok   draft 列出边和改过的参数、省掉默认值"
else
  echo "FAIL draft 视图内容不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
fi

expect 0 "build 预校验写入风险" node "$HERE/build.mjs" "$FIX/lint-spec.json" -o "$OUT/lint.json" --dir "$FIX/catalog" --no-layout
for needle in "没有 WHERE" "注入风险" "数据一致性" "jwtAuth"; do
  if grep -q "$needle" "$OUT/last.log"; then echo "ok   预校验提示 $needle"; else echo "FAIL 预校验没提示 $needle"; failures=$((failures + 1)); fi
done

cat >"$OUT/deploy.json" <<'EOF'
{"ok": true, "data": {"deployStatus": "success_with_warnings", "versionName": "v20261115-180000",
  "summary": {"projectName": "测试项目", "workflowName": "回显", "servers": [
    {"workerName": "mac", "remark": "", "isOnline": false, "deployStatus": "failed", "message": "connection refused"}]}}}
EOF
expect 0 "result deploy 有警告也算通过" node "$HERE/result.mjs" deploy "$OUT/deploy.json"
if grep -q "! 有警告" "$OUT/last.log" && grep -q "○ 离线 | ✗ 失败 | connection refused" "$OUT/last.log"; then
  echo "ok   发布摘要按枚举出状态符号"
else
  echo "FAIL 发布摘要状态符号不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1))
fi

# 缓存：假 buildify 记下每次调用，按调用次数判断复用和过期
mkdir -p "$OUT/bin"
printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$FIX/fake-buildify.mjs" >"$OUT/bin/buildify"
chmod +x "$OUT/bin/buildify"
export FAKE_CLI_LOG="$OUT/cli.log"
calls() { : >"$FAKE_CLI_LOG"; PATH="$OUT/bin:$PATH" "$@" >"$OUT/last.log" 2>&1; wc -l <"$FAKE_CLI_LOG" | tr -d ' '; }
expect_calls() {
  local want="$1" name="$2" got
  shift 2
  got="$(calls "$@")"
  if [ "$got" = "$want" ]; then echo "ok   $name"; else
    echo "FAIL $name（调了 $got 次 buildify，期望 $want）"; sed 's/^/     /' "$FAKE_CLI_LOG" "$OUT/last.log"; failures=$((failures + 1))
  fi
}
CAT="$HERE/catalog.mjs"
expect_calls 2 "fetch 不写版本：nodes + schema" node "$CAT" fetch -b demo/pkg -n EchoNode
expect_calls 0 "1 小时内复用最新版本" node "$CAT" fetch -b demo/pkg -n EchoNode
node -e "const f='$OUT/cache/latest.json',fs=require('node:fs'),j=JSON.parse(fs.readFileSync(f));j['demo/pkg'].at-=2*3600e3;fs.writeFileSync(f,JSON.stringify(j))"
expect_calls 1 "最新版本过期只重查 nodes" node "$CAT" fetch -b demo/pkg -n EchoNode
expect_calls 2 "SNAPSHOT 首次拉取" node "$CAT" fetch -b demo/pkg@1.0.0-SNAPSHOT -n EchoNode
expect_calls 0 "SNAPSHOT 10 分钟内复用" node "$CAT" fetch -b demo/pkg@1.0.0-SNAPSHOT -n EchoNode
touch -t 202001010000 "$OUT/cache"/demo__pkg@1.0.0-SNAPSHOT.*
expect_calls 2 "SNAPSHOT 过期重拉" node "$CAT" fetch -b demo/pkg@1.0.0-SNAPSHOT -n EchoNode
expect_calls 0 "正式版本旧文件也复用" node "$CAT" fetch -b demo/pkg@2.0.0 -n EchoNode
expect_calls 2 "--refresh 重拉" node "$CAT" fetch -b demo/pkg@2.0.0 -n EchoNode --refresh

expect_calls 1 "doc 整份拉一次" node "$CAT" doc -b demo/pkg --node EchoNode
if grep -q "回显结尾" "$OUT/last.log" && ! grep -q "其他说明" "$OUT/last.log"; then echo "ok   doc --node 只出这一节、跳过代码块里的 #"; else
  echo "FAIL doc --node 切节不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi
expect_calls 0 "doc 1 天内复用" node "$CAT" doc -b demo/pkg --section 硬规则
if grep -q "规则二" "$OUT/last.log" && ! grep -q "EchoNode" "$OUT/last.log"; then echo "ok   doc --section 出整节"; else
  echo "FAIL doc --section 切节不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi
expect_calls 0 "doc 目录" node "$CAT" doc -b demo/pkg
if grep -q "回显（EchoNode · Echo）（" "$OUT/last.log" && ! grep -q "代码注释" "$OUT/last.log"; then echo "ok   doc 目录带行数、不含代码块"; else
  echo "FAIL doc 目录不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi
expect_calls 0 "反引号标题的节点本地切出" node "$CAT" doc -b demo/pkg --node PlainNode
if grep -q "纯名称标题说明" "$OUT/last.log" && ! grep -q "流式说明" "$OUT/last.log"; then echo "ok   PlainNode 不误中 StreamPlainNode"; else
  echo "FAIL 反引号标题切节不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi
expect_calls 1 "文档里没有的节点退回 --node" node "$CAT" doc -b demo/pkg --node MissingNode
if grep -q "没有 MissingNode 这一节" "$OUT/last.log"; then echo "ok   没有的节点给出提示"; else
  echo "FAIL 没有的节点没提示"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi

expect 0 "cache 查看" node "$CAT" cache
if grep -q "文档 1" "$OUT/last.log" && grep -q "最新版本 demo/pkg@2.0.0" "$OUT/last.log"; then echo "ok   cache 列出文件和最新版本"; else
  echo "FAIL cache 输出不对"; sed 's/^/     /' "$OUT/last.log"; failures=$((failures + 1)); fi
expect 0 "cache --clear" node "$CAT" cache --clear
if [ -z "$(ls -A "$OUT/cache")" ]; then echo "ok   cache --clear 清空"; else echo "FAIL cache --clear 后还有文件"; failures=$((failures + 1)); fi

check_update() {
  local name="$1" fixture="$2" want="$3"
  local got
  got="$(node "$HERE/update-check.mjs" --url "file://$FIX/$fixture" | node -e "
const r=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
console.log([r.checked,r.updateAvailable,r.required,r.notes.length>0].join(','))")"
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name（$got，期望 $want）"; failures=$((failures + 1)); fi
}
check_update "update-check 有新版本" version-newer.json "url,true,false,true"
check_update "update-check 低于 minVersion" version-required.json "url,true,true,true"
check_update "update-check 取不到不报错" missing.json "failed,false,false,false"

if [ "$failures" -eq 0 ]; then echo "smoke: 全部通过"; else echo "smoke: $failures 项失败"; exit 1; fi
