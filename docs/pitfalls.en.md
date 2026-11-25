# Ten traps (English)

> These are not "considerations". Each one cost real hours. Symptom, root cause, fix.
> Environment: Windows 11 + DSH (`@deepseek-ai/*` plugins, 2026-11 build) + Python 3.13.
>
> Full-length Chinese version with extra evidence: [pitfalls.md](pitfalls.md)

---

## 1. A new preset needs `- insert:`; `- id:` is an override

`cordis.patch.yml` is a **patch**, not a config file. A top-level `- id: something` means
"override the existing entry with this id". If the id does not exist yet, it **does nothing and reports nothing**.

```yaml
# correct — this adds an entry
- insert:
    - id: preset-advisor
      name: '@deepseek-ai/dsh-agent-preset'
      config: { id: advisor, order: 3, plugins: [...] }

# wrong — silently ignored
- id: preset-advisor
  name: '@deepseek-ai/dsh-agent-preset'
  config: { ... }
```

The official `standard` preset is itself an `insert` block. Copy its shape and you cannot get this wrong.

**How to confirm it took effect**: read `agentPreset.val` in the session projection. Not the YAML.

---

## 2. `.agent-presets/<name>/` is not a DSH mechanism

You will find write-ups describing a preset as a directory:
`.agent-presets/advisor/{agent.cordis.yml, preset.yml}`.
That is a convention of certain third-party tooling (purge-style managers). **DSH itself never reads it.**
The files are there, the shape is right, and nothing happens — with no error.

---

## 3. Highlighted in the dropdown is not selected

In the GUI preset menu, the **highlight is hover/focus; the checkmark is current**.
The only reliable answer for "what is this session actually running":

```json
// storages/session_projcache/sessions/<id>.json
"agentPreset": { "ver": 1, "seq": 92, "val": "advisor" }
```

`val: standard` means the session is still standard mode regardless of the menu.
Also note: in the same projection, `"preset": "danger-full-access"` is the **permission tier**, not the agent preset.

**This trap is not only for people reading the UI — it also bites tool authors.**
The `agentPreset` field in a session **header** is frozen at creation time: a session created
under `standard` and switched to `advisor` later will still say `standard` there.
For the current value, read the projection:

```
storages/session_projcache/sessions/<sessionId>.json  ->  "agentPreset": { "val": "advisor" }
```

`tools/check-subagent-model.cjs` in this repository does exactly that, and prints both values
when they differ.

---

## 4. Sub-agents inherit the persona — and conclude they are the planner

This is the expensive one, because nothing errors.

An orchestrator persona typically opens with "you are the strategist, not a support agent".
A sub-agent inherits the same preset, reads that line, and goes off to load
`brainstorming` / `writing-plans` / `executing-plans` instead of writing code.

Measured: two worker sub-agents each spent **six** skill loads before their first edit.
By the time the parent nudged them, a full context window was gone.

**Fix, both halves:**
1. Make the persona **dual-role**: "user is talking to you → orchestrator; you received a task spec → worker".
2. Put worker discipline in a workspace `AGENTS.md`, which is injected into every session including sub-agents.

---

## 5. The skill catalog is a cost even when nothing is loaded

Every skill contributes `name` + `description` to the system prompt. Default roots are five
(project `.dsh/skills`, `.agents/skills`, `~/.dsh/skills`, `~/.agents/skills`, bundled),
and dozens of entries is meaningful context — plus it hands the model the option to go "load one more".

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false              # stop scanning the default roots
    customSkillDirs: ['/path/to/curated']   # only what you actually use
```

Keep 3–5. Note: an **empty** whitelist means *no skills*, not *all skills*.

---

## 6. `gpt-6.2-sol` is absent from the model catalog → compaction always fails

Symptom, on every compaction trigger:

```
Codex error: Unsupported value: 'none' is not supported with the 'gpt-6.2-sol' model.
Supported values are: 'low', 'medium', 'high', 'xhigh', 'max'.
```

Root-cause chain:

1. `pi-ai/dist/api/openai-codex-responses.js` — when the caller passes **no** `reasoningEffort`, it emits
   `body.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" }`
2. `pi-ai/dist/providers/data/openai-codex.json` has **no** entry for `gpt-6.2-sol` (only `gpt-6-sol`)
3. Lookup misses → `off` falls back to the string `"none"` → the backend rejects it

**Two fixes; do both if you like:**

- **Config level (preferred, no `node_modules` edits).** Point compaction at a model that has no such quirk:
  ```yaml
  - id: compaction-basic
    config: { summarizationProvider: 'deepseek-official', summarizationModel: 'deepseek-flash' }
  ```
  This also moves compaction cost off your subscription quota.
- **Data level (root fix, must be re-applied after upgrades).** Add a `gpt-6.2-sol` entry to
  `openai-codex.json` with `thinkingLevelMap.off = null`. `null` makes the adapter omit the
  reasoning field entirely. It only affects calls that do not pass an explicit effort (compaction, summaries).

> A failed compaction does not crash the turn — it continues. But the context never converges,
> so a long task eventually dies at the window limit. And it retries on every step, so the failures
> cost quota too.

---

## 7. Four intuitive ways to check "which model did the sub-agent use" — all wrong

| Method | Why it fails |
|---|---|
| Read the config | Config existing ≠ config being read (traps 1 and 3) |
| Read `session.jsonl` naively | v4 is **multiple concatenated zstd frames**; decompressing only the first gives you the header, which looks like "unparseable" |
| Watch proxy logs (Clash etc.) | `HTTPS_PROXY` is global; both providers go through the same proxy |
| Judge by answer style | With a hard prompt, different models converge in style; without one, you cannot separate style from capability |

**What works, hardest first:**

1. **`message.source` in the session log** — runtime truth:
   ```
   subagent 76a4932a…  source: openai-codex/gpt-6.2-sol        x3
   subagent 7beaabd6…  source: deepseek-official/deepseek-flash x2   ← control
   ```
   `tools/check-subagent-model.cjs` does exactly this.
2. **Destructive probe**: temporarily invalidate the target provider's credential, then dispatch.
   If the job still succeeds, it was never using that provider. Binary, no interpretation needed.
3. **Quota delta**: consumption is objective. But percentages jump in whole points on a 5-hour window,
   so small jobs are invisible. Treat as corroboration only.

---

## 8. The implementer will grade its own homework — do not let it edit the criteria

Real incident: a worker changed the expected values inside the test file to make its own self-test green.
It then kept editing that test file **after** the reviewer started running acceptance, so the reviewer
got a "pass" from a stale copy.

**Two hard rules:**
- The party under review never edits the criteria (tests, acceptance thresholds) — not even two lines.
- Freeze hashes before acceptance, run acceptance, then **verify the hashes again**. Do not start
  acceptance while the implementer is still running.

```powershell
Get-FileHash *.py -Algorithm SHA256   # once before, once after; compare byte-for-byte
```

---

## 9. Acceptance criteria must be machine-checkable, or nothing you get back can be reviewed

Bad: "output looks correct", "the feature works", "performance is acceptable".
Good: "`duration_us` from the API equals the CLI's", "the source directory's full SHA256 set is unchanged after the write".

Give every criterion a command a third party can re-run. The parts you cannot phrase as a command
are the parts you have not thought through yet.

---

## 10. Skill ceremony plus whole-file reads will blow the context window

`read` on a 1,700-line file ≈ 25k tokens. Five of those ≈ 125k. Stack that on top of broken
compaction (trap 6) and the run is dead.

**Hard clauses to put in the workspace `AGENTS.md`:**
- Load no skills.
- Never read a large file end to end. `grep` for the line number, then `read` with `offset`/`limit` for 40–80 lines.
- Reading the same >500-line file in full more than twice is a violation.
