// install.mjs 的自动化测试：node --test test/
// 不依赖任何第三方包；每个用例用独立的临时 DSH_HOME，绝不碰真实配置。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INSTALLER = path.join(HERE, '..', 'install.mjs')

const SEED_PATCH = `- id: ui-theme
  name: '@deepseek-ai/dsh-ui-theme'
  config:
    mode: dark
# 原文件里的注释，安装器不许破坏
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-flash
`

/** 建一个假的 DSH_HOME，返回路径与 patch 路径。 */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshap-'))
  fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true })
  const patch = path.join(home, 'profiles', 'web', 'cordis.patch.yml')
  fs.writeFileSync(patch, SEED_PATCH, 'utf8')
  return { home, patch }
}

/** 跑安装器，返回 { status, stdout, stderr }。 */
function run(args, home) {
  try {
    const stdout = execFileSync(process.execPath, [INSTALLER, ...args], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

const read = (p) => fs.readFileSync(p, 'utf8')
const bakCount = (home) =>
  fs.readdirSync(path.join(home, 'profiles', 'web')).filter((f) => f.includes('.bak-advisor-')).length

test('首次安装：写入预设、保留原有条目与注释、复制技能、留备份', () => {
  const { home, patch } = makeHome()
  const r = run(['--profile', 'web'], home)
  assert.equal(r.status, 0, r.stderr)
  const after = read(patch)

  assert.match(after, /id: preset-advisor/, '预设没写进去')
  assert.match(after, /dsh-advisor-preset BEGIN/, '缺开始标记')
  assert.match(after, /dsh-advisor-preset END/, '缺结束标记')
  assert.match(after, /id: ui-theme/, '原有条目被弄丢了')
  assert.match(after, /原文件里的注释/, '原有注释被破坏')
  assert.match(after, /provider: openai-codex/, '默认路由没写进去')
  assert.match(after, /includeDefaultRoots: false/, '技能收窄没写进去')

  assert.ok(fs.existsSync(path.join(home, 'advisor-skills', 'systematic-debugging', 'SKILL.md')), '技能没复制')
  assert.ok(bakCount(home) >= 1, '没有备份')
  fs.rmSync(home, { recursive: true, force: true })
})

test('幂等：第二次安装必须拒绝，且不改文件', () => {
  const { home, patch } = makeHome()
  assert.equal(run(['--profile', 'web'], home).status, 0)
  const snapshot = read(patch)

  const second = run(['--profile', 'web'], home)
  assert.notEqual(second.status, 0, '第二次居然成功了')
  assert.match(second.stderr, /已经有 preset-advisor|--uninstall/)
  assert.equal(read(patch), snapshot, '被拒绝时不应该改文件')
  fs.rmSync(home, { recursive: true, force: true })
})

test('--dry-run：什么都不写', () => {
  const { home, patch } = makeHome()
  const before = read(patch)
  const r = run(['--profile', 'web', '--dry-run'], home)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /dry-run/)
  assert.equal(read(patch), before, 'dry-run 改了文件')
  assert.equal(bakCount(home), 0, 'dry-run 不该留备份')
  fs.rmSync(home, { recursive: true, force: true })
})

test('--uninstall：移除整块，原有条目完好，且可重复卸载', () => {
  const { home, patch } = makeHome()
  assert.equal(run(['--profile', 'web'], home).status, 0)

  const u = run(['--profile', 'web', '--uninstall'], home)
  assert.equal(u.status, 0, u.stderr)
  const after = read(patch)
  assert.doesNotMatch(after, /id: preset-advisor/, '卸载后还留着预设')
  assert.doesNotMatch(after, /dsh-advisor-preset BEGIN/)
  assert.match(after, /id: ui-theme/, '卸载把别人的条目也删了')
  assert.match(after, /dsh-agent-default-model/, '卸载把别人的条目也删了')

  const again = run(['--profile', 'web', '--uninstall'], home)
  assert.notEqual(again.status, 0, '重复卸载应该失败')
  fs.rmSync(home, { recursive: true, force: true })
})

test('参数生效：自定义 provider/model 写进产物', () => {
  const { home, patch } = makeHome()
  const r = run(
    ['--profile', 'web', '--provider', 'my-provider', '--model', 'my-model', '--effort', 'low'],
    home,
  )
  assert.equal(r.status, 0, r.stderr)
  const after = read(patch)
  assert.match(after, /provider: my-provider/)
  assert.match(after, /model: my-model/)
  assert.match(after, /reasoningEffort: low/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('--help：退出 0 并列出关键参数', () => {
  const { home } = makeHome()
  const r = run(['--help'], home)
  assert.equal(r.status, 0)
  for (const k of ['--profile', '--model', '--dry-run', '--uninstall']) {
    assert.ok(r.stdout.includes(k), '帮助里缺 ' + k)
  }
  fs.rmSync(home, { recursive: true, force: true })
})

test('缺 profile：报可读错误，不写文件', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshap-'))
  const r = run(['--profile', 'nope'], home)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /找不到|profile/i)
  fs.rmSync(home, { recursive: true, force: true })
})
