# dsh-advisor-preset · 军师模式

> **DeepSeek 当军师（定方向、拆任务、验收），施工派给你已付费的 ChatGPT 订阅额度。**
> A DSH agent preset that routes sub-agents to a different provider while keeping the main model as the orchestrator.

[English](README.en.md) · [Pitfalls (EN)](docs/pitfalls.en.md) · [踩坑记录（中文）](docs/pitfalls.md)

[![ci](https://github.com/yingchouchu/dsh-advisor-preset/actions/workflows/ci.yml/badge.svg)](https://github.com/yingchouchu/dsh-advisor-preset/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

---

## 它解决什么

默认的 DSH agent 是"一个模型干所有事"。你想让更会判断的模型做决策、让另一个模型写代码时，没有现成的开关：
社区里的 agent 预设插件管的是**人设 / 技能 / 工具范围**，**都不管 provider 和 model**。

这个预设只做一件事——把 `tool-subagent` 的 `agentOptions` 钉死到另一个 provider：

```yaml
tool-subagent:
  config:
    agentOptions:
      provider: openai-codex
      model: gpt-6.2-sol
      reasoningEffort: high
```

配套解决另外两个真实问题（不是理论问题，是实测踩出来的）：

| 问题 | 现象 | 这里的解法 |
|---|---|---|
| 子 agent 以为自己是"规划者" | 它继承同一份 persona，读到"你是军师"，于是去加载 brainstorming / writing-plans，迟迟不写代码 | persona 写双角色 + 工作区 `AGENTS.md` 写施工队硬条款 |
| 技能目录是隐性成本 | 几十个技能的 description 每轮都进上下文，还诱导模型逐个加载 | `skill-filesystem` 收窄到一个精选目录（留 3–5 个） |

---

## 三个组成部分

```
preset/advisor.plugins.yml   预设本体（17 个插件行，占位符参数化）
preset/persona.md            人格正文（军师 + 施工队双角色）
preset/AGENTS.template.md    工作区纪律模板 → 复制到你工作区根目录改名 AGENTS.md
preset/skills/               精选技能（3 个自洽的小技能，不依赖外部技能包）
install.mjs                  安装器：幂等、带备份、写完自校验、失败自动回滚
tools/check-subagent-model.cjs  判路由工具：读 session 日志的运行时真值
docs/pitfalls.md             ★ 踩过的 10 个坑（这个文件比代码值钱）
```

---

## 快速开始

```bash
# 1. 装到默认 profile（~/.dsh/profiles/web）
node install.mjs

# 想指定 profile / 模型
node install.mjs --profile web --provider openai-codex --model gpt-6.2-sol --effort high

# 先看看会写什么，不落盘
node install.mjs --dry-run
```

2. **重启 DSH**（预设只在启动时装载）
3. 新建会话 → 预设下拉选「军师模式」
4. 派一个最小活，然后验路由：

```bash
node tools/check-subagent-model.cjs
#   子 agent 的 source 必须是 openai-codex/gpt-6.2-sol
```

5. 强烈建议把工作区纪律也带上：

```bash
cp preset/AGENTS.template.md /你的工作区/AGENTS.md
# 然后按你的项目改「环境事实速查」那张表
```

---

## 前置条件

- **DSH**（`@deepseek-ai/*` 插件），已有一个能启动的 profile
- 目标 provider 已经在 DSH 里配好并登录过（本例是 `openai-codex`，走 ChatGPT 订阅的 Codex 后端）
- 主会话模型（军师）用哪个都行，`agent-default-model` 决定，与本预设无关

> **模型 id 会变。** 换模型前先确认它在 DSH 的模型目录里存在：
> `node_modules/@earendil-works/pi-ai/dist/providers/data/openai-codex.json`
> 目录里没有的 id 也能跑，但"没显式传 effort 的调用"会踩 docs/pitfalls.md 第 6 条。

---

## 安装器做了什么

1. 检查 `DSH_HOME` 与目标 profile 是否存在
2. 读 `preset/advisor.plugins.yml`，替换占位符（provider / model / effort / 压缩模型 / 技能目录）
3. 把 `preset/persona.md` 正文以 JSON 字符串安全转义后塞进 YAML
4. **幂等**：已有 `preset-advisor` 就中止
5. 备份成 `cordis.patch.yml.bak-advisor-<时间戳>`，**纯追加**到文件末尾（不动任何其它条目和注释）
6. 写完重新解析，解析不过**自动回滚**
7. 复制精选技能到 `$DSH_HOME/advisor-skills`

卸载：`node install.mjs --uninstall`（按标记整块移除，留备份），重启。

## 测试

```bash
node --test      # 7 条用例，零第三方依赖
```

覆盖：首次安装（原有条目与注释必须完好）、幂等拒绝、`--dry-run` 不落盘、
`--uninstall`（含重复卸载）、参数替换、`--help`、缺 profile 的报错路径。
CI 在 ubuntu + windows × node 20/22/24 上跑同一套。

---

## 可配置项

| 参数 | 默认 | 说明 |
|---|---|---|
| `--profile` | `web` | 装到 `$DSH_HOME/profiles/<profile>` |
| `--provider` | `openai-codex` | 子 agent 的 provider |
| `--model` | `gpt-6.2-sol` | 子 agent 的模型 |
| `--effort` | `high` | 子 agent 的 reasoning effort |
| `--summarizer-provider` | `deepseek-official` | 压缩用哪个 provider（**别用订阅额度跑压缩**） |
| `--summarizer-model` | `deepseek-flash` | 同上 |
| `--dry-run` | — | 只打印，不落盘 |
| `--uninstall` | — | 按 BEGIN/END 标记整块移除（旧版安装自动回退启发式切割），留备份 |
| `--help` | — | 列出全部参数 |

改人格：改 `preset/persona.md` → 删掉 patch 里的旧段 → 重跑 `install.mjs`。
改技能：往 `preset/skills/<name>/SKILL.md` 里加，重装时自动复制。

---

## 已知限制（诚实版）

1. **这不是"换模型就变强"的银弹。** 同一道题，DeepSeek 直接答往往更敢下判断；GPT 更稳、更适合按契约施工。
   分工的依据是**任务是否有可机验的对错标准**，不是"谁更聪明"。
2. **订阅额度有限。** 5 小时窗口 + 周窗口都会撞顶。撞了就等，别换模型顶上去——
   那会污染"谁做的"这个基本事实，让验收和对比失效。
3. **社区插件管不了模型路由。** `Zkbnfcnb/dsh-my-agent-preset` 这类插件解决的是人格收窄与工具最小化，
   预设组成里**没有 provider/model**。要路由只能手写 patch（也就是这个仓库做的事）。
4. **压缩模型要单独配**，否则用订阅额度跑压缩，撞上 `effort='none'` 那个坑（docs/pitfalls.md 第 6 条）。
5. **只在 Windows + 上述 DSH 版本上实测过。** Linux/macOS 理论一致（路径分隔符已在安装器里处理），未实测。

---

## 为什么值得看 docs/pitfalls.md

代码只有 17 行 YAML，真正花时间的是下面这些：

- `- insert:` vs `- id:` 的语义差
- `.agent-presets/` 目录根本不是 DSH 的机制
- 下拉菜单高亮 ≠ 已选中
- 子 agent 继承 persona 导致"人格错位"
- `gpt-6.2-sol` 不在模型目录 → 压缩每次必失败
- 四种"判断子 agent 用了哪个模型"的方法都是错的，正确的方法只有一个

每条都有症状、根因（精确到文件与行号）和修法。**先读它，能省掉你复现这些的半天。**

---

## License

MIT
