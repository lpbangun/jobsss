# JobSSS Agent Plugin — Gate 0 pass bar

This file is the only pass bar for the standalone JobSSS Agent Plugin.
It is frozen. Implementers, workers, and the parent orchestrator must not
edit it. The reviewer owns this file and the focused acceptance tests under
`tests/jobsss-*.test.mjs` plus synthetic fixtures under `tests/fixtures/`.

Verdict is **pass** or **fail** only. There is no score and no partial credit.
Every check must pass. Do not delete, rewrite, or weaken a check to look green.

JobSSS is a self-contained Agent Plugin with a bundled runtime. Runtime
execution must not resolve or require a JobOS executable, installation,
source tree, or files. JobOS at `/home/logani/projects/Job App` is a
read-only reference for attributed ports and remains unmodified.

This lock supersedes the 2026-08-24 JobOS-on-PATH foundation bar. B1–B4
are preserved. B5 is corrected to the confirmed standalone launch contract.
B6–B12 are the standalone live proofs.

---

## Ownership and lock

| Artifact | Owner | Who may edit |
| --- | --- | --- |
| `BENCHMARK.md` | reviewer | reviewer only |
| `tests/jobsss-gate0.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-mcp-compat.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-journey.test.mjs` | reviewer | reviewer only |
| `tests/fixtures/profile-resume.md` | reviewer | reviewer only |
| `tests/fixtures/job-posting.md` | reviewer | reviewer only |
| `tests/helpers/jobsss-gate0.mjs` | leftover foundation helper | do not treat as the standalone contract |

Product files (`plugin.json`, `mcp.json`, `skills/`, `bin/`, `src/`,
`LICENSE`, `AGENTS.md`, `README.md`, `.gitignore`, and similar) are
implementer-owned after Gate 0. They must satisfy this bar. They must not
absorb reviewer files.

Gate 0 lock: **2026-08-25T03:10:00Z**. Standalone goal
`mt82020f-c94ug7`. No product runtime may be implemented until this file
and the focused tests are treated as frozen.

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
   fake success, or a second parallel JobOS product (TUI, browser apply,
   scheduler, or live JobOS executable) to satisfy a check.

---

## Frozen sources of truth

Inspected read-only for this lock (do not copy the JobOS tree into JobSSS
wholesale; attributed ports are allowed):

- Agent Plugins Specification 1.0.0 and schemas
  `https://agent-plugins.org/specification`
  `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
  `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`
- Agent Skills specification
  `https://agentskills.io/specification`
- JobOS `/home/logani/projects/Job App/src/mcp.js`
- JobOS `/home/logani/projects/Job App/src/domain-tools.js`
- JobOS `/home/logani/projects/Job App/src/capabilities.js`
- JobOS `/home/logani/projects/Job App/src/db.js`
- JobOS `/home/logani/projects/Job App/src/profiles.js`
- JobOS `/home/logani/projects/Job App/src/jobs.js`
- JobOS `/home/logani/projects/Job App/src/scoring.js`
- JobOS `/home/logani/projects/Job App/src/workflows.js`
- JobOS `/home/logani/projects/Job App/.agents/skills/jobos/SKILL.md`
- JobOS `/home/logani/projects/Job App/LICENSE` (MIT)

Frozen plugin root: the JobSSS repository root
`/home/logani/projects/jobsss`.

Required portable layout:

```text
plugin.json
mcp.json
skills/jobsss/SKILL.md
skills/jobsss/references/
bin/jobsss
src/
tests/
```

---

## Environment

```bash
node -v   # precondition: v22 or newer; not a scored check
```

Run every scored command from the repository root. Do not read or write real
JobOS user data (`~/.jobos`, `/home/logani/projects/Job App/.jobos`, or any
existing `jobos-workspace/`). Isolated subprocesses must use a fresh
temporary directory via `PLUGIN_DATA` / `--data`.

Unset or blank provider keys for core checks. Do not add npm dependencies
for these tests. Do not edit `package.json` to make the bar pass.
Do not require `jobos` on `PATH`. There is no allowed skip for missing JobOS.

---

## Frozen validation command

```bash
node --test --test-concurrency=1 \
  tests/jobsss-gate0.test.mjs \
  tests/jobsss-mcp-compat.test.mjs \
  tests/jobsss-journey.test.mjs
```

### Expected exit code

`0` after a complete, truthful standalone implementation.

### What pass means

Exit `0` is necessary and not sufficient. Every check B1–B12 below must hold
on the real files and on a real bundled MCP subprocess. Invented output,
mocks of the runtime, skipped required checks, or touching real user JobOS
state are a fail.

No allowed skip. B10–B12 are required even when `jobos` is absent.

### Gate 0 baseline recorded against today's committed foundation

Command above, 2026-08-25, Node v22.22.3, exit `1`.

| Check | Result today | Observed failure |
| --- | --- | --- |
| B1 | pass | preserved |
| B2 | pass | preserved |
| B3 | pass | preserved (command may be bare or `./` relative) |
| B4 | pass | preserved |
| B5 | fail | `mcp.json` still declares server `jobos`, not `jobsss` |
| B6 | fail | skill does not document profile create/import or standalone tools |
| B7 | pass | preserved human-only catalog |
| B8 | fail | missing `bin/jobsss` |
| B9 | fail | doctor guidance does not name `PLUGIN_DATA` |
| B10 | fail | `mcp.json` must declare stdio server `jobsss` |
| B11 | fail | `mcp.json` must declare stdio server `jobsss` |
| B12 | fail | `mcp.json` must declare stdio server `jobsss` |

`# tests 14` `# pass 7` `# fail 7`. These failures are missing standalone
product behavior, not benchmark defects.

---

## Frozen command contract

| Field | Frozen value |
| --- | --- |
| Plugin name | `jobsss` |
| Skill directory / skill `name` | `jobsss` |
| MCP server key | `jobsss` |
| MCP transport | `stdio` |
| MCP `command` | `./bin/jobsss` (plugin-relative; stays inside the root) |
| MCP `args` | exactly `["mcp", "--data", "${PLUGIN_DATA}"]` |
| Agent Plugins `$schema` | `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| MCP `$schema` | `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` |

`mcp.json` must contain exactly one server. It must not set `env`, `cwd`,
headers, credentials, user/workspace paths, or a second transport.

The host expands `${PLUGIN_DATA}` to an absolute writable data directory.
The launcher must honor `--data <dir>` and must persist only under that
directory. Tests set `PLUGIN_DATA` and expand the token before spawn.

---

## Frozen MCP journey tools

These agent-eligible tools must exist and work locally with no API keys and
with `jobos` absent from `PATH`:

| Tool | Required inputs | Minimum result |
| --- | --- | --- |
| `doctor` | none | success; diagnoses bundled runtime and `PLUGIN_DATA` |
| `start` | none | success; initializes durable state under `PLUGIN_DATA` |
| `create_profile` | `name`, optional `resumePath`/`path` | returns `profileId` or `id` |
| `import_job` | `profileId` plus local `path`/`filePath` | returns `jobId` or `id`; offline fixture import |
| `list_jobs` | `profileId` | lists imported jobs |
| `score_job` | `jobId`, `profileId` | `overall` number and/or `scoreStatus` string |
| `pursue_job` | `jobId`, `profileId` | success; must not claim submitted/sent/applied/approved |
| `applications_plan` | `jobId`, `profileId` | local pipeline/readiness; must not claim submitted/sent/applied |
| `review_queue` | `profileId` | local review state |

Re-importing the same local fixture for one profile must deduplicate to a
single job id.

### Frozen blocked MCP names

These must not appear on `tools/list`. They remain human-only or out of
scope. Copied from JobOS `HUMAN_ONLY_DOMAIN_TOOLS` at lock time, plus
browser/submit tools that the standalone journey must not expose:

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
- `submit_application_form`
- `inspect_application_form`
- `assist_application_form`

JobSSS must never claim submission, sending, approval, applied attestation,
or a deferred/future capability.

---

## Frozen intents

Base invocation plus the standalone core journey. Network, interview,
scheduling, and browser apply are out of scope and must be blocked or
explicitly handed off.

| Invocation | Kind | Required routing |
| --- | --- | --- |
| `/jobsss` | base | Help / next-action menu. Never fabricate execution or authority. |
| `/jobsss doctor` | sub-intent | MCP `doctor`. Diagnose bundled `./bin/jobsss` and `PLUGIN_DATA`. |
| `/jobsss start` | sub-intent | MCP `start`. Initialize local store under `PLUGIN_DATA`. |
| `/jobsss profile` or `create_profile` | sub-intent | MCP `create_profile` for create/import of a local profile/resume. |
| `/jobsss find` or `import_job` | sub-intent | MCP `import_job` and `list_jobs` for local import/discover. |
| `/jobsss score` or `score_job` | sub-intent | MCP `score_job`. Local, no API key required. |
| `/jobsss pursue` | sub-intent | MCP `pursue_job`. |
| `/jobsss pipeline` | sub-intent | MCP `applications_plan` and `list_jobs`. |
| `/jobsss review` | sub-intent | MCP `review_queue`. |

The skill may accept natural-language equivalents. It must not invent extra
stable slash sub-intents that claim networking, interviews, scheduling,
browser automation, cloud sync, or JobOS-on-PATH behavior.

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
bare executable name or a plugin-relative path beginning with `./` that
stays inside the root. No client-specific trees
(`.cursor/`, `.claude/`, `.omp/`, `.hermes/`, `com.*`) are required or used
as the portable source of truth.

### B4 — Valid secret-free `mcp.json`

`mcp.json` exists at the plugin root, is JSON, and satisfies Agent Plugins
1.0.0 MCP schema: only `$schema` and `mcpServers` at the top level. Exactly
one stdio server. No credentials, tokens, API keys, passwords, Authorization
headers, private key material, or secret-bearing `env` values. Server object
may contain only `type`, `command`, and `args`.

### B5 — Exact stdio bundled `./bin/jobsss` contract

The only `mcpServers` entry is named `jobsss`. It is
`{ "type": "stdio", "command": "./bin/jobsss", "args": ["mcp", "--data", "${PLUGIN_DATA}"] }`
with no extra keys.

### B6 — Standalone core journey intents

`SKILL.md` plus `skills/jobsss/references/` document `/jobsss` and the
frozen standalone table. They name every frozen journey tool, `PLUGIN_DATA`,
and `./bin/jobsss`. They say JobOS is not required. Network, interview,
scheduling, and browser work are blocked, handed off, or out of scope.
Routing is to bundled MCP behavior, a human-only handoff, or an explicit
“not available” — never a fabricated capability.

### B7 — Accurate human-only handoffs

Every frozen human-only tool name appears in the skill or its references
with a CLI/TUI handoff. The skill must say these are not MCP-attestable and
must not be reported as done. Approval, send, submit, and packet-freeze
language is handoff-only.

### B8 — Self-contained bundled runtime, no JobOS dependency

`bin/jobsss` and `src/` exist inside the plugin root and are not symlinks.
The shipped runtime must not import `/home/logani/projects/Job App`, spawn
`jobos`, or require JobOS files. Shipping `src/` requires a root `LICENSE`
with an MIT notice; if the code mentions JobOS, the notice must attribute
JobOS. This is one bundled runtime, not a second JobOS TUI/browser/scheduler
product and not an auto-apply/submit/send engine.

### B9 — Doctor diagnoses bundled runtime and `PLUGIN_DATA`

`/jobsss doctor` and the skill/references tell the agent how to diagnose
the bundled `./bin/jobsss` launcher and `PLUGIN_DATA`. They must not send
the agent to install JobOS onto `PATH`. They must forbid invented jobs,
scores, proofs, sends, or submissions.

### B10 — Real bundled MCP initialize and tools with JobOS absent

Spawn `./bin/jobsss mcp --data <temp PLUGIN_DATA>` with `jobos` absent from
`PATH` (a trap executable must not run), blank provider keys, and a fresh
temporary home. A real initialize and `tools/list` exchange must succeed.
Listed tools must include every frozen journey tool and must not include any
frozen blocked name. Do not read or write real user JobOS data.

### B11 — `PLUGIN_DATA` persistence and plugin-root isolation

After `doctor` and `start`, durable files exist under the temporary
`PLUGIN_DATA` directory. A new MCP process against the same directory still
works. No user state is written into the plugin root, `~/.jobos`,
`JOBOS_HOME`, `/home/logani/projects/Job App/.jobos`, or
`jobos-workspace/`.

### B12 — Full standalone doctor-to-review journey

With JobOS absent from `PATH` and blank provider keys, a real subprocess
completes doctor → start → create/import profile from
`tests/fixtures/profile-resume.md` → import/discover job from
`tests/fixtures/job-posting.md` → score → pursue → pipeline → review.
The same local job fixture deduplicates. Score and pursue succeed without
credentials and without claiming submit/send/apply/approval. A restarted
MCP process still lists the imported job from `PLUGIN_DATA`.

---

## Verdict

**Pass** only if the frozen validation command exits `0` and B1–B12 hold on
inspected files and subprocess output.

**Fail** if any required file is missing, any check mismatches, any command
hangs, any mock replaces the bundled runtime, any `jobos` executable is
required or invoked, or any real user workspace is touched.

---

## Artifact hashes at lock

SHA-256 of reviewer-owned standalone test files and fixtures after the
Gate 0 relock. Implementers must not change these files.
`tests/helpers/jobsss-gate0.mjs` is unchanged leftover from the previous
foundation and is not the standalone contract.

```
fe69a0b428e6bd727fb1c558bd19bc3a050e529126cbc179a011f548eab75d25  tests/jobsss-gate0.test.mjs
790def53e34402489ac9f9ee962e1bc9fe5a287c523b8dcec891c6a0d9d3a602  tests/jobsss-mcp-compat.test.mjs
2f3bd5f40bf57f9fd3cbb4455745c7ca3c05679694d336ee27358bca043f6ad3  tests/jobsss-journey.test.mjs
5e78590ab93031b334e2c67c4f081a52af0e5713306dcac3ad08eb4d88ac65e9  tests/fixtures/profile-resume.md
736a9d6957d2a5ab8e3ed4c4f1f95639afcca949facf3b71767af7b358e00db6  tests/fixtures/job-posting.md
ed0b0fc2f6318eed8255b5cdc459188dfb29b5e28314b7d786e2708162f1d7f9  tests/helpers/jobsss-gate0.mjs
```

## Correction log

- 2026-08-24T20:34:13Z — **B6**. Reason: genuine benchmark defect; the first
  lock froze JobOS skill modes instead of the user's explicit JobSSS set.
  Historical foundation correction. Not done to make tests green.
- 2026-08-25T03:10:00Z — **Gate 0 relock for standalone goal**. Reason: the
  confirmed standalone specification (`./bin/jobsss mcp --data ${PLUGIN_DATA}`,
  JobOS absent from PATH, `PLUGIN_DATA` persistence, full local journey)
  contradicts the 2026-08-24 JobOS-on-PATH launch contract. Change: preserved
  B1–B4 and B7; allowed plugin-relative `./` commands in B3 so B5 can name
  `./bin/jobsss`; replaced B5 with the bundled launcher contract; replaced
  B6/B8/B9/B10 and added B11–B12 as required live proofs. No allowed B10
  skip. Recorded today's failing baseline before freeze. Not done to make
  tests green.
