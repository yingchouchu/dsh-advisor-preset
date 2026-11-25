# Security

## 这个工具会改什么

| 位置 | 操作 | 可回滚 |
|---|---|---|
| `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 追加一段带 BEGIN/END 标记的配置块 | 是（`--uninstall` + 同目录 `.bak-advisor-*`） |
| `$DSH_HOME/advisor-skills/` | 复制三个技能目录 | 是（`--uninstall` 不删，手动清理） |

不改 `node_modules`，不联网，不读凭据，不执行任何下载内容。

## 它会让 agent 做什么

预设把 `tool-subagent` 路由到另一个 provider。**这消耗的是该 provider 上你自己账号的额度**，
并且子 agent 仍然受 DSH 的沙箱与审批策略约束。本仓库不包含任何绕过沙箱、审批或凭据校验的东西。

## 报告问题

发现路径穿越、把内容写进源目录、或卸载误删他人条目之类的问题，请开 issue 并标注 `security`。
`install.mjs` 的写入目标只有两个（见上表），任何超出范围的行为都算缺陷。
