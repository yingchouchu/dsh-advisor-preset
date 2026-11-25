# Contributing

欢迎补坑。这个仓库的价值主要在 `docs/pitfalls*.md`——**你踩到的坑比你的代码更值钱**。

## 提 issue

- 新坑：请附 **症状 / 根因（精确到文件行号或结构路径）/ 修法 / 你的环境（DSH 版本、Node、OS）**
- 装不上：贴 `node install.mjs --dry-run` 的输出，以及 `DSH_HOME` 的实际值
- 不要贴凭据、token、账号 id。贴了我会删。

## 提 PR

```bash
node --test        # 必须过，7 条用例
node install.mjs --dry-run   # 目测一下产物
```

改 `install.mjs` 的写入逻辑时，**必须同时加或改用例**：现有的 7 条覆盖了
幂等、dry-run、卸载、参数替换、错误路径——新逻辑至少要能落进其中一条。

## 两条硬规矩

1. **不许为了让测试变绿而改断言。** 断言写错了可以改，但要在 PR 说明里写清
   「原来的断言为什么是错的」，而不是「改成能过」。
2. 不要把个人路径、凭据、内部仓库地址提交进来。`install.mjs` 里所有路径都必须从
   `DSH_HOME` / `os.homedir()` 推导。

## 版本

- 打标签 = 可运行版本，`docs` 更新不打标签
- CHANGELOG 按 Keep a Changelog 格式追加
