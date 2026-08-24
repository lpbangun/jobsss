# JobSSS Agent Plugin — Gate 0 pass bar

This file is the only pass bar for the JobSSS Agent Plugin foundation.
It is frozen. Implementers, workers, and the parent orchestrator must not
edit it. The reviewer owns this file and the focused acceptance tests under
`tests/jobsss-*.test.mjs`.

Verdict is **pass** or **fail** only. There is no score and no partial credit.
Every check must pass. Do not delete, rewrite, or weaken a check to look green.

JobSSS is a portable Agent Plugin over an already-installed JobOS runtime.
JobOS remains the only engine, store, domain-tool registry, and policy
authority. This benchmark locks the plugin package, not a second JobOS.

---

## Ownership and lock

| Artifact | Owner | Who may edit |
| --- | --- | --- |
| `BENCHMARK.md` | reviewer | reviewer only |
| `tests/jobsss-gate0.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-mcp-compat.test.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-gate0.mjs` | reviewer | reviewer only |

Product files (`plugin.json`, `mcp.json`, `skills/`, `AGENTS.md`, `README.md`,
`.gitignore`, and similar) are implementer-owned after Gate 0. They must
satisfy this bar. They must not absorb reviewer files.

---

## Correction policy

1. Missing product behavior is a **fail**, not a benchmark defect.
2. Only the reviewer may change this file or the focused Gate 0 tests.
3. The reviewer may correct a check only when it contradicts a cited
   specification or the inspected JobOS contract named below.
4. Every correction must append a dated entry to [Correction log](#correction-log)
   with the reason, the exact check id, and what changed. Convenience,
   theming, and “make CI green” are not reasons.
5. Do not add client-specific packaging, marketplace wrappers, stubs that
   fake success, or duplicated JobOS implementation to satisfy a check.

---

## Frozen sources of truth

Inspected read-only for this lock (do not copy them into JobSSS):

- Agent Plugins Specification 1.0.0 and schemas
  `https://agent-plugins.org/specification`
  `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
  `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`
- Agent Skills specification
  `https://agentskills.io/specification`
- JobOS `/home/logani/projects/Job App/src/mcp.js`
- JobOS `/home/logani/projects/Job App/src/domain-tools.js`
- JobOS `/home/logani/projects/Job App/src/capabilities.js`
- JobOS `/home/logani/projects/Job App/.agents/skills/jobos/SKILL.md`

Frozen plugin root: the JobSSS repository root
`/home/logani/projects/jobsss`.

Required portable layout:

```text
plugin.json
mcp.json
skills/jobsss/SKILL.md
skills/jobsss/references/
```

---

## Environment

```bash
node -v   # precondition: v22 or newer; not a scored check
```

Run every scored command from the repository root. Do not read or write real
JobOS user data (`~/.jobos`, `/home/logani/projects/Job App/.jobos`, or any
existing `jobos-workspace/`). Isolated JobOS subprocesses must use a fresh
temporary directory via `JOBOS_HOME` / `--workspace`.

Unset or blank provider keys for core checks. Do not add npm dependencies
for these tests. Do not edit `package.json` to make the bar pass.

---

## Frozen validation command

```bash
node --test --test-concurrency=1 \
  tests/jobsss-gate0.test.mjs \
  tests/jobsss-mcp-compat.test.mjs
```

### Expected exit code

`0` after a complete, truthful implementation.

### What pass means

Exit `0` is necessary and not sufficient. Every check B1–B10 below must hold
on the real files and, when a `jobos` executable is resolvable, on a real
temporary MCP subprocess. Invented output, mocks of JobOS, or skipped
required checks are a fail.

Allowed skip: **B10 only**, and only when no `jobos` executable is resolvable
from `JOBOS_BIN` or `PATH`. A skip of B10 is not a waiver of B1–B9.

---

## Frozen command contract

| Field | Frozen value |
| --- | --- |
| Plugin name | `jobsss` |
| Skill directory / skill `name` | `jobsss` |
| MCP server key | `jobos` |
| MCP transport | `stdio` |
| MCP `command` | bare `jobos` (platform PATH resolution; not a path) |
| MCP `args` | exactly `["mcp"]` |
| Agent Plugins `$schema` | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| MCP `$schema` | `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` |

`mcp.json` must contain exactly one server. It must not set `env`, `cwd`,
headers, credentials, user/workspace paths, or a second transport.

---

## Frozen intents

Base invocation plus twelve stable sub-intents. Source: the user's explicit
JobSSS deliverable contract. An earlier Gate 0 draft that froze JobOS skill
modes (`score`, `research`, `tailor`, `answers`, `applications`, `tracker`,
`memory`) was a benchmark defect and is withdrawn.

| Invocation | Kind | Required JobOS routing |
| --- | --- | --- |
| `/jobsss` | base | Help / next-action menu. Never fabricate execution or authority. |
| `/jobsss start` | sub-intent | No MCP init tool exists. Handoff to trusted CLI/TUI setup. Skill/references must say `no MCP init`, `trusted CLI/TUI`, and `setup`. |
| `/jobsss daily` | sub-intent | MCP `daily_discovery` |
| `/jobsss find` | sub-intent | Existing MCP `list_saved_searches`, `search_jobs`, `list_jobs`, `import_job_url` as appropriate |
| `/jobsss pursue` | sub-intent | MCP `pursue_job` |
| `/jobsss pipeline` | sub-intent | Agent-eligible MCP `list_jobs`, `applications_plan`, `list_tasks`, `list_lifecycle_observations` |
| `/jobsss materials` | sub-intent | MCP `tailor_resume`, `draft_cover_letter`, `review_queue`, `diff_artifact` |
| `/jobsss network` | sub-intent | Agent-eligible network/people/outreach planning reads/drafts: `map_reachable_network`, `start_people_research`, `plan_outreach`, `draft_outreach` |
| `/jobsss interview` | sub-intent | MCP `interview_prep` plus agent-eligible `list_interview_stories`, `draft_interview_story` |
| `/jobsss review` | sub-intent | MCP `review_queue`, `diff_artifact`, `weekly_review`, `lifecycle_analytics` |
| `/jobsss sync` | sub-intent | No MCP sync tool. Skill/references must say `SQLite is canonical`, `derived` mirrors, and `no cloud sync`. |
| `/jobsss config` | sub-intent | No MCP config tool. Handoff to documented trusted CLI/TUI. Skill/references must say `no MCP config` and `trusted CLI/TUI`. |
| `/jobsss doctor` | sub-intent | Diagnose runtime/MCP readiness and a missing `jobos` executable. Not an MCP tool. |

The skill may accept natural-language equivalents of these intents. It must
not invent extra stable slash sub-intents that claim JobOS behavior JobOS
does not have. Handoff intents (`start`, `sync`, `config`, `doctor`) must
not fabricate an MCP `init`, `sync`, or `config` tool.

---

## Frozen human-only handoffs

Copied from JobOS `HUMAN_ONLY_DOMAIN_TOOLS` at lock time. Agents must return
a typed handoff to trusted CLI/TUI. They must not expose these as MCP tools
and must not claim they succeeded.

- `approve_artifact`
- `reject_artifact`
- `approve_contact`
- `answers_add`
- `create_application_packet`
- `attest_application_submitted`
- `confirm_application_receipt`
- `checkpoint_application_form`
- `verify_interview_story`
- `retire_interview_story`
- `add_interview_question_source`
- `record_interview_debrief`
- `correct_interview_debrief`
- `record_job_feedback`
- `correct_memory_observation`
- `undo_memory_observation`
- `accept_memory_proposal`
- `reject_memory_proposal`
- `revoke_memory_proposal`
- `undo_memory_transition`
- `network_contact_record`
- `mark_outreach_sent`

Additionally, JobSSS must never claim submission, sending, approval, applied
attestation, or a deferred/future capability. `submit_application_form`
remains a JobOS agent-eligible tool that is user-configured and default-off;
JobSSS must not present it as a successful JobSSS action.

---

## Checks

### B1 — Agent Plugin manifest validity

`plugin.json` exists at the plugin root, is JSON, and satisfies Agent
Plugins 1.0.0: `$schema` is the canonical 1.0.0 plugin schema URL, `name` is
`jobsss`, types match the closed manifest, and there are no unknown
top-level fields. `extensions` if present must be empty (no client-specific
packaging in this foundation).

### B2 — Agent Skill validity

`skills/jobsss/SKILL.md` is a regular file with YAML frontmatter and a
non-empty Markdown body. Frontmatter `name` is `jobsss` and matches the
parent directory. `description` is 1–1024 characters and says what the
skill does and when to use it. `skills/jobsss/references/` exists as a
directory. No other immediate child of `skills/` is required or permitted
in this foundation.

### B3 — Package-boundary safety

Every package path supplied by the plugin resolves inside the plugin root.
No symlinks, junctions, or equivalent escapes. No user-home, `JOBOS_HOME`,
`.jobos/`, or `jobos-workspace/` paths in plugin config. MCP `command` is a
bare executable name. Plugin-relative paths, if any, begin with `./` and
stay inside the root. No client-specific trees
(`.cursor/`, `.claude/`, `.omp/`, `.hermes/`, `com.*`) are required or used
as the portable source of truth.

### B4 — Valid secret-free `mcp.json`

`mcp.json` exists at the plugin root, is JSON, and satisfies Agent Plugins
1.0.0 MCP schema: only `$schema` and `mcpServers` at the top level. No
credentials, tokens, API keys, passwords, Authorization headers, private
key material, or secret-bearing `env` values.

### B5 — Exact stdio `jobos ["mcp"]` contract

The only `mcpServers` entry is named `jobos`. It is `{ "type": "stdio",
"command": "jobos", "args": ["mcp"] }` with no extra keys.

### B6 — Base + 12 required JobSSS intents

`SKILL.md` plus `skills/jobsss/references/` document `/jobsss` and each
`/jobsss <intent>` from the frozen user-required table. MCP-backed intents
must name the frozen JobOS tools. `start`, `sync`, `config`, and `doctor`
must use the frozen handoff phrases and must not invent MCP init/sync/config
tools. Routing is to existing JobOS behavior, a human-only or CLI/TUI
handoff, or an explicit “not available” — never a fabricated capability.

### B7 — Accurate human-only handoffs

Every frozen human-only tool name appears in the skill or its references
with a CLI/TUI handoff. The skill must say these are not MCP-attestable and
must not be reported as done. Approval, send, submit, and packet-freeze
language is handoff-only.

### B8 — No duplicated JobOS implementation

The plugin contains guidance and manifests only. It must not ship a second
runtime, SQLite/database layer, domain-tool registry, scoring/tailoring
engine, MCP server implementation, policy replica, auto-apply/submit/send
engine, broker, or copied JobOS `src/` modules.

### B9 — Useful failure when `jobos` is unavailable

`/jobsss doctor` and the skill/references tell the agent how to detect a
missing `jobos` executable, how to recover (install JobOS; put `jobos` on
`PATH`; stdio entry is `jobos mcp`), and that the agent must not invent
jobs, scores, proofs, sends, or submissions while JobOS is unavailable.

### B10 — Basic real JobOS MCP compatibility (if executable exists)

When `JOBOS_BIN` or `PATH` resolves a `jobos` executable, spawn it as
`jobos mcp` against a fresh temporary workspace. A real initialize and
`tools/list` exchange must succeed. Listed tools must include representative
agent-eligible tools (`score_job`, `daily_discovery`, `pursue_job`) and must
not include any frozen human-only name. Do not read or write real user
JobOS data. If no executable is resolvable, skip only this check.

---

## Verdict

**Pass** only if the frozen validation command exits `0` and B1–B9 (and B10
when not skipped) hold on inspected files and subprocess output.

**Fail** if any required file is missing, any check mismatches, any command
hangs, any mock replaces JobOS, or any real user workspace is touched.

---

## Artifact hashes at lock

SHA-256 of reviewer-owned test files after the B6 intent-set correction.
Implementers must not change these files. `tests/jobsss-mcp-compat.test.mjs`
is unchanged from the original lock.

```
793a052a468169f9081430f0e541dd32a171dd218425e0db0733408a26631b8d  tests/jobsss-gate0.test.mjs
606955862217616aaef7fecaa10be3a3ad1635faa37aa15b1b9a7e9972535b92  tests/jobsss-mcp-compat.test.mjs
ed0b0fc2f6318eed8255b5cdc459188dfb29b5e28314b7d786e2708162f1d7f9  tests/helpers/jobsss-gate0.mjs
```

## Correction log

- 2026-08-24T20:34:13Z — **B6**. Reason: genuine benchmark defect; the first
  lock froze JobOS skill modes (`doctor,daily,pursue,score,research,network,tailor,answers,applications,tracker,interview,memory`) instead of the
  user's explicit JobSSS set (`start,daily,find,pursue,pipeline,materials,network,interview,review,sync,config,doctor` plus base `/jobsss`). Change:
  replaced the frozen intent table and B6 wording in `BENCHMARK.md`; updated
  `SUB_INTENTS` / added `INTENT_HANDOFFS` and multi-tool `INTENT_ROUTES` in
  `tests/helpers/jobsss-gate0.mjs`; updated B6 assertions in
  `tests/jobsss-gate0.test.mjs`. B1–B5 and B7–B10 unchanged. Not done to
  make tests green.
