#!/usr/bin/env node
/**
 * 安装「军师模式（advisor）」预设到本机 DSH。
 *
 *   node install.mjs                        # 装到 ~/.dsh/profiles/web
 *   node install.mjs --profile web --model gpt-6.2-sol --provider openai-codex
 *   node install.mjs --dry-run              # 只打印将要写入的内容
 *
 * 设计原则：
 *   1. 幂等：已经有 preset-advisor 就中止，不重复插入
 *   2. 可回滚：写入前在同目录留 .bak-advisor-<时间戳>
 *   3. 不改注释、不动其它条目：**纯追加**到 patch 文件末尾
 *   4. 写完自己重新解析一遍，解析不过就自动回滚
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ── 参数 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes('--' + name)

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = opt('profile', 'web')
const PROVIDER = opt('provider', 'openai-codex')
const MODEL = opt('model', 'gpt-6.2-sol')
const EFFORT = opt('effort', 'high')
const SUM_PROVIDER = opt('summarizer-provider', 'deepseek-official')
const SUM_MODEL = opt('summarizer-model', 'deepseek-flash')
const DRY = flag('dry-run')

const PROFILE_DIR = path.join(DSH_HOME, 'profiles', PROFILE)
const PATCH = path.join(PROFILE_DIR, 'cordis.patch.yml')
const SKILLS_DEST = path.join(DSH_HOME, 'advisor-skills')

function fail(msg, code = 1) {
  console.error('\n[FAIL] ' + msg)
  process.exit(code)
}

// ── 前置检查 ───────────────────────────────────────────────────────────
if (!fs.existsSync(PATCH)) {
  fail(`找不到 ${PATCH}\n       先用 dsh 启动过一次，或换 --profile 指定已有 profile`)
}

// js-yaml 由 DSH 自带；公共环境里从几个候选位置找，找不到就跳过校验并提示
function resolveYaml() {
  const candidates = [PROFILE_DIR, DSH_HOME, process.cwd()]
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, 'noop.js'))('js-yaml')
    } catch {}
  }
  try {
    return createRequire(import.meta.url)('js-yaml')
  } catch {}
  return null
}
const yaml = resolveYaml()

// ── 读模板 ─────────────────────────────────────────────────────────────
const persona = fs.readFileSync(path.join(HERE, 'preset', 'persona.md'), 'utf8').trim()
const pluginsTemplate = fs.readFileSync(path.join(HERE, 'preset', 'advisor.plugins.yml'), 'utf8')

const filled = pluginsTemplate
  .replaceAll('__PROVIDER__', PROVIDER)
  .replaceAll('__MODEL__', MODEL)
  .replaceAll('__EFFORT__', EFFORT)
  .replaceAll('__SUMMARIZER_PROVIDER__', SUM_PROVIDER)
  .replaceAll('__SUMMARIZER_MODEL__', SUM_MODEL)
  .replaceAll('__SKILLS_DIR__', SKILLS_DEST.replaceAll('\\', '/'))

// 人格正文用 JSON 字符串塞回 YAML：JSON 的双引号转义是 YAML 双引号标量的合法子集
const personaLiteral = JSON.stringify(persona)
const withPersona = filled.replace(/^(\s*prefix:\s*)__PERSONA__\s*$/m, (_m, p) => p + personaLiteral)

// 剩下的 __XXX__ 只允许出现在注释行（模板头部的说明注释里就有占位符名字）
const leftover = withPersona
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#') && /__[A-Z_]+__/.test(l))
if (leftover.length) {
  fail('模板里还有没替换的占位符：\n       ' + leftover.slice(0, 3).join('\n       '))
}

// plugins 是 YAML 列表：必须换行并整体缩进到 config 之下（8 + 2 = 10 空格）
const indentedPlugins = withPersona
  .trimEnd()
  .split('\n')
  .map((l) => (l.trim() ? '          ' + l : l))
  .join('\n')

const BEGIN_MARK = '# >>> dsh-advisor-preset BEGIN'
const END_MARK = '# <<< dsh-advisor-preset END'

const block = `
${BEGIN_MARK} — 由 install.mjs 管理，块内请勿手改
# ── 军师模式（advisor 预设）──────────────────────────────────────────────
# DeepSeek 主控 + 子 agent 走 ${PROVIDER}/${MODEL}。
# 卸载：node install.mjs --uninstall      改配置：改 preset/ 下的源文件后重跑
- insert:
    - id: preset-advisor
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: advisor
        order: 3
        plugins:
${indentedPlugins}
${END_MARK}
`

// ── 帮助 ───────────────────────────────────────────────────────────────
if (flag('help') || flag('h')) {
  console.log(`dsh-advisor-preset installer

  node install.mjs [options]

  --profile <name>              目标 profile，默认 web       (env: DSH_HOME 决定根目录)
  --provider <id>               子 agent provider，默认 openai-codex
  --model <id>                  子 agent 模型，默认 gpt-6.2-sol
  --effort <level>              子 agent 推理强度，默认 high
  --summarizer-provider <id>    压缩用 provider，默认 deepseek-official
  --summarizer-model <id>       压缩用模型，默认 deepseek-flash
  --dry-run                     只打印将写入的内容，不落盘
  --uninstall                   从 patch 里移除本预设（保留备份）
  --help, -h                    显示本帮助

  退出码：0 成功 / 1 前置检查或写入失败 / 2 参数错误
`)
  process.exit(0)
}

// ── 幂等 + 写入 / 卸载 ──────────────────────────────────────────────────
const raw = fs.readFileSync(PATCH, 'utf8')

if (flag('uninstall')) {
  const begin = raw.indexOf(BEGIN_MARK)
  if (begin < 0) fail('这个 profile 里没有本预设的安装标记，无需卸载')
  const endIdx = raw.indexOf(END_MARK, begin)
  let next
  if (endIdx >= 0) {
    next = raw.slice(0, begin) + raw.slice(endIdx + END_MARK.length)
  } else {
    // 旧版安装没有结束标记：切到下一个顶层条目（列 0 的 "- "）
    const lines = raw.slice(begin).split('\n')
    let cut = lines.length
    for (let i = 1; i < lines.length; i++) {
      if (/^- /.test(lines[i])) {
        cut = i
        break
      }
    }
    next = raw.slice(0, begin) + lines.slice(cut).join('\n')
  }
  const bak = PATCH + '.bak-advisor-uninstall-' + new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(PATCH, bak)
  fs.writeFileSync(PATCH, next.replace(/\s+$/, '') + '\n', 'utf8')
  console.log('[uninstall] 已移除预设块')
  console.log('[backup]    ' + bak)
  console.log('重启 dsh 后生效。技能目录 ' + SKILLS_DEST + ' 未删除，需要的话手动清理。')
  process.exit(0)
}

if (/id:\s*preset-advisor/.test(raw)) {
  fail('这个 profile 里已经有 preset-advisor 了。先卸载再装：node install.mjs --uninstall')
}

if (DRY) {
  console.log('=== --dry-run：以下内容将追加到 ' + PATCH + ' ===')
  console.log(block)
  console.log('=== 同时会把 preset/skills/ 复制到 ' + SKILLS_DEST + ' ===')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const bak = PATCH + '.bak-advisor-' + stamp
fs.copyFileSync(PATCH, bak)
const next = raw.replace(/\s+$/, '') + '\n' + block
fs.writeFileSync(PATCH, next, 'utf8')
console.log('[write] ' + PATCH)
console.log('[backup] ' + bak)

// 自校验：解析不过自动回滚
if (yaml) {
  try {
    const doc = yaml.load(fs.readFileSync(PATCH, 'utf8'))
    const adv = doc.find((e) => e.insert)?.insert?.find((x) => x.id === 'preset-advisor')
    if (!adv) throw new Error('写进去但解析不出 preset-advisor')
    const sub = adv.config.plugins.find((p) => p.id === 'delegation').config.find((c) => c.id === 'tool-subagent')
    console.log('[verify] 插件数:', adv.config.plugins.length)
    console.log('[verify] 子 agent 路由:', JSON.stringify(sub.config.agentOptions))
    console.log('[verify] persona 长度:', String(adv.config.plugins.find((p) => p.id === 'persona').config.prefix).length)
  } catch (e) {
    fs.copyFileSync(bak, PATCH)
    fail('写完后 YAML 解析失败，已自动回滚：' + e.message)
  }
} else {
  console.warn('[warn] 没找到 js-yaml，跳过解析校验。请重启 dsh 确认能起来；起不来就用备份回滚：')
  console.warn('       copy "' + bak + '" "' + PATCH + '"')
}

// ── 技能目录 ───────────────────────────────────────────────────────────
// 自己实现递归复制：fs.cpSync 在部分 Node 24 / Windows 组合上会硬崩（0xC0000409）
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else if (ent.isFile()) fs.copyFileSync(s, d)
  }
}

const srcSkills = path.join(HERE, 'preset', 'skills')
if (fs.existsSync(srcSkills)) {
  copyDir(srcSkills, SKILLS_DEST)
  const count = fs.readdirSync(SKILLS_DEST).length
  console.log('[skills] ' + count + ' 个技能已复制到 ' + SKILLS_DEST)
}

console.log('')
console.log('完成。接下来：')
console.log('')
console.log('1. 重启 dsh（预设只在启动时装载）')
console.log('2. 新建会话 → 预设下拉选「军师模式」')
console.log('3. 派一个最小活验证路由：node tools/check-subagent-model.cjs')
console.log('   子 agent 的 source 必须是 ' + PROVIDER + '/' + MODEL + '（看运行时记录，不看配置）')
console.log('4. 想把工作区纪律也带上：把 preset/AGENTS.template.md 复制到工作区根目录改名 AGENTS.md')
console.log('')
