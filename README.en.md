# dsh-advisor-preset

> **Let your strongest judgment model orchestrate, and route the actual work to another provider you already pay for.**
> A DSH (DeepSeek Harness) agent preset that pins `tool-subagent` to a different provider/model, plus the discipline files that keep sub-agents from acting like planners.

[中文说明](README.md) · [Pitfalls (EN)](docs/pitfalls.en.md) · [Pitfalls (中文)](docs/pitfalls.md)

[![ci](https://github.com/yingchouchu/dsh-advisor-preset/actions/workflows/ci.yml/badge.svg)](https://github.com/yingchouchu/dsh-advisor-preset/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

---

## The gap this fills

DSH ships one general-purpose agent: one model does everything. If you want a model that decides *and* a different model that types, there is no switch for it.

The existing preset ecosystem is mature but aimed elsewhere. The best-known manager (`dsh-my-agent-preset` and similar) composes a preset from **persona / skills / tools / runtime-context / metadata** — **there is no `provider` or `model` field**. It narrows what the agent *may do*; it never changes *who does it*.

So routing still has to be hand-written. That is all this repository is:

```yaml
tool-subagent:
  config:
    agentOptions:
      provider: openai-codex
      model: gpt-6.2-sol
      reasoningEffort: high
```

Two problems showed up only after real use, and both are handled here:

| Problem | What actually happens | Fix in this repo |
|---|---|---|
| **Sub-agents think they are the planner** | A sub-agent inherits the session persona. If that persona says "you are the orchestrator", it loads `brainstorming` / `writing-plans` and never writes code. Measured: two worker agents each spent six skill loads before their first edit. | Dual-role persona + worker discipline in a workspace `AGENTS.md` |
| **The skill catalog is an invisible cost** | Every skill's name + description ships in every request, and the catalog invites the model to "load one more". Dozens of skills is real context spent on nothing. | `skill-filesystem` narrowed to one curated directory (3–5 skills) |

---

## What's inside

```
preset/advisor.plugins.yml       The preset body: 17 plugin rows, parameterized
preset/persona.md                Dual-role persona (orchestrator / worker)
preset/AGENTS.template.md        Workspace discipline -> copy to <workspace>/AGENTS.md
preset/skills/                   Three self-contained skills (no external skill pack needed)
install.mjs                      Idempotent installer: backup, self-verify, auto-rollback
tools/check-subagent-model.cjs   Proves routing from runtime records, not config
docs/pitfalls.en.md              THE ten traps (this file is worth more than the code)
```

---

## Quick start

```bash
# install into the default profile (~/.dsh/profiles/web)
node install.mjs

# or be explicit
node install.mjs --profile web --provider openai-codex --model gpt-6.2-sol --effort high

# see what would be written, touch nothing
node install.mjs --dry-run
```

1. **Restart DSH** — presets load at startup only.
2. New session → pick **军师模式 / advisor** in the preset dropdown.
3. Dispatch one trivial job, then prove the routing:

```bash
node tools/check-subagent-model.cjs
#   the sub-agent's source must read openai-codex/gpt-6.2-sol
```

4. Recommended: bring the discipline along

```bash
cp preset/AGENTS.template.md /your/workspace/AGENTS.md
# then fill in the "environment facts" table for your project
```

---

## Requirements

- **DSH** (`@deepseek-ai/*` plugins) with a profile that already boots.
- The target provider already configured and signed in inside DSH (here: `openai-codex`, i.e. the Codex backend of a ChatGPT subscription).
- The orchestrator model is whatever `agent-default-model` says; this preset does not touch it.

> **Model ids move.** Before switching models, confirm the id exists in DSH's catalog:
> `node_modules/@earendil-works/pi-ai/dist/providers/data/openai-codex.json`
> An id that is missing there still runs, but every call that does *not* pass an explicit effort will hit trap #6 in the pitfalls doc.

---

## What the installer does

1. Resolves `DSH_HOME` and the target profile, aborts if either is missing.
2. Reads `preset/advisor.plugins.yml`, substitutes provider / model / effort / summarizer / skills dir.
3. Escapes `preset/persona.md` into the YAML as a JSON string literal (safest round-trip).
4. **Idempotent**: aborts if `preset-advisor` already exists.
5. Backs up to `cordis.patch.yml.bak-advisor-<timestamp>` and **appends** — no other entry or comment is touched.
6. Re-parses the result; **auto-rolls back** if the file no longer parses.
7. Copies the curated skills to `$DSH_HOME/advisor-skills`.

Uninstall: `node install.mjs --uninstall` (removes the marked block, keeps a backup), restart.

## Tests

```bash
node --test      # 7 cases, zero third-party dependencies
```

Covers: first install (pre-existing entries and comments must survive), idempotent refusal,
`--dry-run` writing nothing, `--uninstall` (including a second run), flag substitution,
`--help`, and the missing-profile error path. CI runs the same suite on ubuntu + windows,
node 20/22/24.

---

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--profile` | `web` | Installs into `$DSH_HOME/profiles/<profile>` |
| `--provider` | `openai-codex` | Sub-agent provider |
| `--model` | `gpt-6.2-sol` | Sub-agent model |
| `--effort` | `high` | Sub-agent reasoning effort |
| `--summarizer-provider` | `deepseek-official` | Who compacts. **Do not burn subscription quota on compaction.** |
| `--summarizer-model` | `deepseek-flash` | Same |
| `--dry-run` | — | Print, write nothing |
| `--uninstall` | — | Removes the marked block (falls back to a heuristic for older installs), keeps a backup |
| `--help` | — | List every flag |

Change the persona: edit `preset/persona.md`, remove the old block, re-run `install.mjs`.
Add a skill: drop `preset/skills/<name>/SKILL.md`; it is copied on install.

---

## Honest limitations

1. **Not a "swap the model, get a better agent" button.** On the same question, the reasoning-heavy model often gives a sharper, more decisive answer; the subscription model is steadier and better at executing a contract. Route by **whether the task has machine-checkable acceptance criteria**, not by "which model is smarter".
2. **Subscription quota is finite.** Both a 5-hour window and a weekly window exist. When they cap out, wait. Do not let another model quietly take over — that destroys the one fact your review depends on: *who did the work*.
3. **Community preset plugins cannot do this.** Their preset schema has no provider/model field. Routing has to live in the patch (this repo).
4. **Configure the compactor separately**, or you will spend subscription quota on compaction *and* hit the `effort='none'` trap.
5. **Tested on Windows 11 + DSH (2026-11 build) + Python 3.13.** Path handling is cross-platform in the installer; Linux/macOS untested.

---

## Why `docs/pitfalls.en.md` matters

The code here is 17 lines of YAML and a 200-line installer. The time sink was:

- `- insert:` vs `- id:` in a **patch** file (one adds, one silently overrides)
- `.agent-presets/<name>/` is not a DSH mechanism at all — files sit there, nothing happens, no error
- A preset being *highlighted* in the dropdown is not the same as being *selected*
- Sub-agents inheriting the orchestrator persona
- `gpt-6.2-sol` missing from the model catalog → compaction fails on `effort='none'`, every single step
- Four intuitive ways to tell which model a sub-agent used — all of them wrong; the fifth one is right

Each is written up with symptom, root cause down to file and line, and the fix.

---

## License

MIT
