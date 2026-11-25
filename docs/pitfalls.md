# 踩过的坑（写给下一个做同样事的人）

> 这些不是"注意事项"，是**实际会让你白干几小时**的东西。每条都附了证据形式，好让你自己复核。
> 环境：Windows 11 + DSH（`@deepseek-ai/*` 插件，2026-11 版本）+ Python 3.13。

---

## 1. 新增 preset 必须用 `- insert:`，`- id:` 是覆盖

`cordis.patch.yml` 是**补丁**，不是配置。顶层 `- id: xxx` 的语义是「覆盖已存在的同 id 条目」，
新增一个不存在的 id **不会生效，也不会报错**。

```yaml
# ✅ 新增必须这样
- insert:
    - id: preset-advisor
      name: '@deepseek-ai/dsh-agent-preset'
      config: { id: advisor, order: 3, plugins: [...] }

# ❌ 这样写等于什么都没做（不报错）
- id: preset-advisor
  name: '@deepseek-ai/dsh-agent-preset'
  config: { ... }
```

官方 `standard` 预设本身也是 `insert` 形式——照着它写就不会错。

**怎么确认生效**：读 session 投影里的 `agentPreset.val`，不是看 YAML。

---

## 2. `.agent-presets/<name>/` 目录不是 DSH 的机制

网上/别处会看到把预设写成目录：`.agent-presets/advisor/{agent.cordis.yml,preset.yml}`。
那是某些插件（例如 dsh-purge 类工具）的私有约定，**DSH 本身不读**。
放进去，文件在、格式对、没有任何效果，也不报错。

---

## 3. 下拉菜单里高亮 ≠ 已选中

GUI 里预设列表，**高亮的是悬停/焦点，打勾的才是当前**。
当前会话到底用哪个，只有一个可靠来源：

```json
// storages/session_projcache/sessions/<id>.json
"agentPreset": { "ver": 1, "seq": 92, "val": "advisor" }
```

`val` 是 `standard` 就说明这个会话还是标准模式——不管菜单里显示什么。

另外注意：同一份投影里 `"preset": "danger-full-access"` 是**权限档位**，不是 agent 预设，别混。

---

## 4. 子 agent 会继承父会话的 persona，于是它以为自己是"规划者"

这条是隐形的、危害最大的。

军师模式的 persona 第一句是「你是用户的军师」——子 agent 继承同一套预设，读到这句，
就跑去加载 `brainstorming` / `writing-plans` / `executing-plans`，**迟迟不写代码**。

实测：两个施工子 agent 各自花了 6 次 skill 加载才开始动第一行代码；
等调用方发消息催，一轮上下文已经烧掉了。

**修法（两个一起上）**：
1. persona 里写清双角色：「用户直接跟你说话 → 军师；你收到任务书 → 施工队」
2. 用工作区 `AGENTS.md` 把施工队纪律写成硬条款（自动注入每个会话，包括子 agent）

---

## 5. 技能目录本身就是成本

技能不加载也要占上下文：每个技能的 `name + description` 都会进系统提示。
默认根目录有 5 个（项目 `.dsh/skills`、`.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`、bundled），
几十个技能的目录相当可观，而且**给模型提供了"逐个加载"的选项**。

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false          # 关键：不再扫默认根
    customSkillDirs: ['/path/to/curated-skills']
```

留 3–5 个真正用得上的。空白名单 = 没有技能（不是"全部"）。

---

## 6. `gpt-6.2-sol` 在模型目录里不存在 → 压缩必失败

症状（每次触发压缩都来一次）：

```
Codex error: Unsupported value: 'none' is not supported with the 'gpt-6.2-sol' model.
Supported values are: 'low', 'medium', 'high', 'xhigh', 'max'.
```

根因链：
1. `pi-ai/dist/api/openai-codex-responses.js` 在调用方**没传** `reasoningEffort` 时，会发
   `body.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" }`
2. `pi-ai/dist/providers/data/openai-codex.json` 里**没有** `gpt-6.2-sol` 这个条目（只有 `gpt-6-sol`）
3. 查不到 → `off` 回落成字符串 `"none"` → 后端拒绝

**两个修法，建议都做**：
- **配置层**（首选，不动 `node_modules`）：让压缩用没这个毛病的模型
  ```yaml
  - id: compaction-basic
    config: { summarizationProvider: 'deepseek-official', summarizationModel: 'deepseek-flash' }
  ```
  顺带把压缩的 token 从订阅额度里挪出去。
- **数据层**（治本，升级要重放）：往 `openai-codex.json` 插一条 `gpt-6.2-sol`，`thinkingLevelMap.off = null`。
  `null` 会让适配器**完全不发** reasoning 字段。只影响"没显式传 effort"的调用（压缩、摘要这类）。

> 压缩失败不会让回合崩，它会继续跑——但上下文不再收敛，长任务到窗口上限就死。
> 更阴的是：它每步都会重试一次压缩，失败也是真花额度。

---

## 7. 判断"子 agent 到底走哪个模型"，别用这四种方法

我试过并失败过的：

| 方法 | 为什么不行 |
|---|---|
| 看配置 | 配置存在 ≠ 被读取（坑 1、坑 3） |
| 看 `session.jsonl` 的原始字段 | v4 格式是**多帧 zstd 拼接**，只看第一帧只有 header，看起来像"解析不出来" |
| 看代理连接日志（Clash 等） | `HTTPS_PROXY` 是全局的，两个 provider 都走同一个代理 |
| 看回答风格 | prompt 够硬时，不同模型能给出高度相似的风格；不硬时又分不清是风格还是能力 |

**靠得住的**（从硬到软）：

1. **session 日志里的 `message.source`** —— 运行时真值
   ```
   subagent 76a4932a…  source: openai-codex/gpt-6.2-sol  x3
   subagent 7beaabd6…  source: deepseek-official/deepseek-flash  x2   ← 对照
   ```
   `tools/check-subagent-model.cjs` 就是干这个的。
2. **破坏性探针**：把目标 provider 的凭据临时改成无效值，再派活。
   还能正常答 → 它根本没走那条路。非黑即白，没有解释空间。
3. **额度增量**：消耗是客观事实。但百分比粒度粗（5 小时窗口按整百分点跳），
   小任务测不出来，只适合当旁证。

---

## 8. 施工方会给自己出题——别让它改判据

真实事故：施工方为了让自测变绿，去改测试文件里的期望值；
又在验收方开始跑测试**之后**继续改测试文件，导致验收方拿到的是旧版测试的"通过"。

**两条硬规矩**：
- 被验收的一方不许改判据（测试、验收标准），哪怕只改两行
- 验收前先冻结哈希 → 跑验收 → **跑完再核一次哈希**；施工方还在跑时不许开始验收

```powershell
Get-FileHash *.py -Algorithm SHA256   # 前后各一次，逐字节比
```

---

## 9. 契约要写得能机验，否则回来的东西没法验收

坏判据：「输出看起来正常」「功能可用」「性能可接受」。
好判据：「`python x.py summary <draft>` 输出的 `duration_us` 与 CLI 一致」「写操作前后源目录全量 SHA256 不变」。

写任务书时给每条判据配一条**第三方能复跑的命令**。判据写不出来的部分，就是你自己没想清楚的部分。

---

## 10. 子 agent 的 skill 仪式、整读大文件，会把上下文撑爆

`read` 一个 1700 行的文件 ≈ 25k token，读 5 次 ≈ 125k。
再叠加压缩坏掉（坑 6），就是必死。

**写进工作区 `AGENTS.md` 的硬条款**：
- 不加载 skill
- 不整读大文件：`grep` 拿行号 → `read` 带 `offset`/`limit` 只读 40–80 行
- 同一个 >500 行的文件整读两次以上 = 违规
