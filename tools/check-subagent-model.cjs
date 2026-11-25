#!/usr/bin/env node
/**
 * 判路由：读 DSH 的 session 日志，打印每个会话里 assistant 消息**真实使用**的 provider/model。
 *
 *   node check-subagent-model.cjs                 # 列最近 12 个会话
 *   node check-subagent-model.cjs <父会话id>       # 只看这个会话派出的子 agent
 *
 * 为什么不用配置判断：配置存在 ≠ 配置被读取。下拉菜单里勾选 ≠ 实际生效。
 * session 日志里的 message.source 是运行时真值，改不了。
 *
 * 关于预设：session 文件头里的 agentPreset 是**创建时**的静态值，中途切换过的会话
 * 会和现状不符。当前值要去 storages/session_projcache/sessions/<id>.json 里读
 * agentPreset.val。两者不一致时会同时打印出来，避免误读。
 */
const z = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const ROOT = path.join(DSH_HOME, 'sessions')
const PROJ = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')

/** session 文件是多帧 zstd 拼接，逐帧解压后拼起来。 */
function decompress(file) {
  const raw = fs.readFileSync(file)
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let i = 0
  while (i < raw.length - 4) {
    if (raw.compare(MAGIC, 0, 4, i, i + 4) === 0) {
      offsets.push(i)
      i += 4
    } else i++
  }
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k]
    const end = k + 1 < offsets.length ? offsets[k + 1] : raw.length
    try {
      parts.push(z.zstdDecompressSync(raw.subarray(start, end)).toString('utf8'))
    } catch {}
  }
  return parts.join('')
}

/** 当前生效的 agent 预设：优先读投影，回退到文件头（创建时的值）。 */
function currentPreset(id, headerPreset) {
  try {
    const raw = fs.readFileSync(path.join(PROJ, `${id}.json`), 'utf8')
    const m = raw.match(/"agentPreset"\s*:\s*\{[^}]*"val"\s*:\s*"([^"]+)"/)
    if (m) return m[1]
  } catch {}
  return headerPreset || '-'
}

function collectSessions() {
  const out = []
  if (!fs.existsSync(ROOT)) return out
  for (const bucket of fs.readdirSync(ROOT)) {
    const bucketDir = path.join(ROOT, bucket)
    if (!fs.statSync(bucketDir).isDirectory()) continue
    for (const id of fs.readdirSync(bucketDir)) {
      const file = path.join(bucketDir, id, 'session.v4.jsonl.zstd')
      if (!fs.existsSync(file)) continue
      out.push({ id, file, mtime: fs.statSync(file).mtimeMs })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

function inspect(file) {
  const lines = decompress(file).split('\n').filter(Boolean)
  if (!lines.length) return null
  let header
  try {
    header = JSON.parse(lines[0])
  } catch {
    return null
  }
  const sources = new Map()
  for (const line of lines) {
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type !== 'assistant/message') continue
    const src = ev.data?.message?.source
    const key = src ? `${src.provider}/${src.model}` : '(unknown)'
    sources.set(key, (sources.get(key) || 0) + 1)
  }
  return { header, sources }
}

const filterParent = process.argv[2]
let printed = 0

for (const s of collectSessions()) {
  if (printed >= 12) break
  const info = inspect(s.file)
  if (!info) continue
  const h = info.header
  if (filterParent && h.parentSession !== filterParent) continue
  printed++

  const kind = h.origin === 'subagent' ? `subagent(depth ${h.delegationDepth})` : 'main'
  const created = h.agentPreset || '-'
  const active = currentPreset(h.id, h.agentPreset)
  const label = active === created ? active : `${active} (created as ${created})`

  console.log(`\n=== ${h.id}\n    ${kind}  preset ${label}`)
  if (h.parentSession) console.log(`    parent ${h.parentSession}`)
  if (!info.sources.size) {
    console.log('    (无 assistant 消息)')
    continue
  }
  for (const [src, n] of info.sources) console.log(`    source: ${src}  x${n}`)
}

if (!printed) console.log('没有匹配的会话（检查 DSH_HOME 是否正确）')
