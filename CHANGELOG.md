# Changelog

重要变更记录于此。版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-11-25

首个发布版本。

### 功能

- **跨 provider 子 agent 路由**：`tool-subagent.agentOptions` 固定 provider / model / reasoningEffort，
  主会话继续用编排模型，施工派给另一条已付费的订阅额度。
- **双角色人格**：军师（定方向、拆任务、验收）与施工队（按任务书执行）在同一套预设内切换，
  避免子 agent 把编排者的身份带进执行现场。
- **技能目录收窄**：`skill-filesystem` 关闭默认根目录、只扫自定义目录，目录本身不再占用每轮上下文。
- **压缩独立路由**：`compaction-basic` 可指向另一个 provider，压缩不消耗被路由模型的额度。
- **幂等安装器**：写入前备份、写后自校验、YAML 解析失败自动回滚；`--uninstall` 按标记整块移除。
- **路由核验工具**：从 session 日志的 `message.source` 读取运行时真值，回答"子 agent 实际用了哪个模型"。

### 文档

- `docs/pitfalls.md` / `docs/pitfalls.en.md`：10 个实测陷阱，每条含症状、根因（精确到文件与行号）、修法。
- `README.md` / `README.en.md`：安装、参数、已知限制。
- `preset/AGENTS.template.md`：工作区纪律模板，由 `dsh-agent-instructions` 自动注入每个会话。

### 测试

- `node --test`：7 条用例覆盖安装、幂等拒绝、`--dry-run` 不落盘、卸载（含重复卸载）、
  参数替换、`--help`、缺 profile 的错误路径。
- CI：ubuntu + windows × node 20 / 22 / 24。
