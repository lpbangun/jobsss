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
B6–B13 are the standalone live proofs. B14–B25 extend that bar for the
confirmed JobSSS port round and must not delete, rewrite, or weaken B1–B13.
B26–B29 extend that bar for the independent-auditor omissions and must not
delete, rewrite, or weaken B1–B25.

---

## Ownership and lock

| Artifact | Owner | Who may edit |
| --- | --- | --- |
| `BENCHMARK.md` | reviewer | reviewer only |
| `tests/jobsss-gate0.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-mcp-compat.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-journey.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-persistence.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-discovery.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-workflows.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-integrity.test.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-live-mcp.mjs` | reviewer | reviewer only |
| `tests/fixtures/profile-resume.md` | reviewer | reviewer only |
| `tests/fixtures/job-posting.md` | reviewer | reviewer only |
| `tests/fixtures/legacy-store-v1.json` | reviewer | reviewer only |
| `tests/fixtures/ats-board.json` | reviewer | reviewer only |
| `tests/fixtures/contact-card.md` | reviewer | reviewer only |
| `tests/helpers/jobsss-gate0.mjs` | leftover foundation helper | do not treat as the standalone contract |

Product files (`plugin.json`, `mcp.json`, `skills/`, `bin/`, `src/`,
`LICENSE`, `AGENTS.md`, `README.md`, `.gitignore`, and similar) are
implementer-owned after Gate 0. They must satisfy this bar. They must not
absorb reviewer files.

Gate 0 lock: **2026-08-25T02:49:56.365Z**. Standalone goal
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
  tests/jobsss-journey.test.mjs \
  tests/jobsss-persistence.test.mjs \
  tests/jobsss-discovery.test.mjs \
  tests/jobsss-workflows.test.mjs \
  tests/jobsss-integrity.test.mjs
```

### Expected exit code

`0` after a complete, truthful standalone implementation.

### What pass means

Exit `0` is necessary and not sufficient. Every check B1–B29 below must hold
on the real files and on a real bundled MCP subprocess. Invented output,
mocks of the runtime, skipped required checks, or touching real user JobOS
state are a fail.

No allowed skip. B10–B12 and B14–B29 are required even when `jobos` is absent.

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

### Round-2 baseline recorded 2026-08-26 against today's committed standalone runtime

B1–B13 now pass on the committed plugin when the original three test files
are run (`# tests 15` `# pass 15` `# fail 0`). B14–B25 are frozen failing
against that same runtime using real `PLUGIN_DATA` stores and real
`./bin/jobsss` MCP subprocesses. Missing product behavior, not benchmark
defects. Exact new-file fail counts are recorded in the correction log.

### Auditor-omission baseline recorded 2026-08-28 against committed HEAD `a7dea90`

B1–B25 pass on the committed plugin (`# tests 27` `# pass 27` `# fail 0`).
B26–B29 are frozen failing against that same runtime using real
`PLUGIN_DATA` stores and real `./bin/jobsss` MCP subprocesses. Missing
product behavior, not benchmark defects. Combined frozen command:
`# tests 31` `# pass 27` `# fail 4`, exit `1`. Observed failures:
B26 `save_job` leaves discovered `job.saved=false` / `job.status=new`;
B27 `save_job` follows `jobs/<id>` symlink and writes `job.json` outside
`PLUGIN_DATA`; B28 marks `$10M`/`400%` title/reflection `grounded=true`
when STAR text matches a proof; B29 `tailor_resume` copies every proof and
returns no extracted requirements.

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
| `applications_plan` | `jobId`, `profileId` | local pipeline/readiness; must not claim submitted/sent/applied; must reject a job owned by another profile |
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

### Frozen extended MCP tools (B14–B25)

These are additive. B10 still requires only the frozen journey tools above.
B19–B24 require the names below on `tools/list` of a real bundled MCP
subprocess with `jobos` absent from `PATH`. They must not appear in the
blocked list. Browser apply, calendar send, and attestation remain blocked.

| Tool | Required inputs | Minimum result |
| --- | --- | --- |
| `import_job` (inline) | `profileId` plus `text` or `content` | returns `jobId`; no arbitrary filesystem read |
| `import_job_url` | `profileId`, `url` | rejects `file:` and other non-http(s) URLs; never reads arbitrary local paths |
| `create_saved_search` | `profileId`, `name`, `adapter`, `config` | persists a profile-owned search; `config.fixture` if present must resolve inside `PLUGIN_DATA` |
| `list_saved_searches` | `profileId` | lists that profile's searches only |
| `search_jobs` | `profileId` plus saved-search name or id | runs the search locally without API keys |
| `daily_discovery` | `profileId` | returns discovered jobs from saved searches / staged public-ATS fixtures; no API key |
| `save_job` | `jobId`, `profileId` | marks a discovered job saved for the owning profile |
| `skip_job` | `jobId`, `profileId` | records skip/archive for the owning profile |
| `tailor_resume` | `jobId`, `profileId` | proof-grounded draft; never submitted |
| `draft_cover_letter` | `jobId`, `profileId` | proof-grounded draft; never sent |
| `list_tasks` | `profileId` | profile-owned tasks only |
| `update_application_status` | profile-owned application | local lifecycle only; must reject `applied` / `submitted` / `approved` |
| `import_contact` | `profileId` plus inline `name`/`email`/`company`/`text` | no arbitrary filesystem path |
| `map_reachable_network` | `jobId`, `profileId` | local path map; never sends |
| `plan_outreach` | `jobId`, `profileId` | local plan; never sends |
| `draft_outreach` | `jobId`, `profileId` | draft only; never sent |
| `list_interview_stories` | `profileId` | profile-owned stories |
| `draft_interview_story` | `profileId` plus story fields | proof-linked draft; verification remains human-only |
| `interview_prep` | `profileId` plus job/application | local prep/coverage; never schedules |
| `preview_sync` | `profileId` | secret-safe preview/export; no write outside `PLUGIN_DATA` |

Mutating tools must honor exclusive lock file `PLUGIN_DATA/jobsss.lock`
(`{ "pid", "createdAt" }`) and optional `expectedRevision`. A live lock or
mismatched revision must fail with a concurrency/stale/lock error and must
not persist the rejected write.

MCP filesystem reads are limited to (1) regular files whose realpath is
under `PLUGIN_DATA` and (2) the frozen Gate 0 fixtures
`tests/fixtures/profile-resume.md` and `tests/fixtures/job-posting.md`.
`/etc/passwd`, `$HOME`, temp files outside `PLUGIN_DATA`, `file:` URLs, and
JobOS user-state trees are forbidden.

Fit scores must use contract `jobos.fit-score.v1` in `deterministic-degraded`
mode without API keys, with dimensions and weights:
`roleFit` 28, `domainFit` 18, `seniority` 14, `locationWorkModel` 12,
`compensation` 8, `missionInterest` 14, `networkAccess` 6.

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

### B13 — Cross-profile `applications_plan` isolation

A real bundled MCP subprocess with two profiles must reject
`applications_plan` when `jobId` is owned by the other profile. The call
must not succeed and must not return a pipeline/readiness plan for the
foreign job. The owning profile can still plan that job. Isolation must
hold with JobOS absent from `PATH` and blank provider keys.

### B14 — Lossless current `store.json` migration

A real `PLUGIN_DATA` directory preloaded with
`tests/fixtures/legacy-store-v1.json` (today's v1 shape: profiles, proof
points, jobs, scores, applications, artifacts) must survive `doctor` and
`start` on a real bundled MCP subprocess. Every legacy id and core field
remains: profile `legacy-probe-profile`, job `job_5fa7236535eb384d`, four
proof ids, pursued application, and artifact `artifact_6e23181c13b9be6c`.
After start the canonical store is versioned (`version` or `schemaVersion`
>= 2) with a positive integer `revision`, and an audit/migration trail
exists under `PLUGIN_DATA`. No legacy record may be dropped or rewritten
to a new id.

### B15 — Serialized writes and stale-update rejection

Writes under `PLUGIN_DATA` are exclusive. File `PLUGIN_DATA/jobsss.lock`
with a live `pid` must cause mutating MCP tools to fail with a
lock/busy/timeout/concurrency error and must not persist the rejected
write. Mutating tools persist integer `revision`. Passing
`expectedRevision` that does not match the current revision must fail with
a stale/revision/concurrency error and must not silently overwrite state.

### B16 — Rejection of arbitrary MCP filesystem paths

`create_profile` and `import_job` may still read the frozen Gate 0 fixtures
used by B12. They must reject `/etc/passwd`, temp files outside
`PLUGIN_DATA`, and other arbitrary absolute paths, and must not persist the
file contents. `import_job` must accept inline `text`/`content` without a
filesystem path. `import_job_url` and `import_contact` must exist and must
reject `file:` URLs and arbitrary paths. Allowed reads are `PLUGIN_DATA`
and the two frozen Gate 0 fixtures only.

### B17 — Post-commit secret-safe projections

After `start` and `create_profile`, derived files under `PLUGIN_DATA`
other than canonical `store.json` must exist, be human-readable, and be
secret-safe: no `resumeText` dumps, no env secret values, no `sk-` tokens,
no private key material. Canonical `store.json` may retain resume text for
scoring. Provider keys in the process environment must not appear in
projections or MCP payloads.

### B18 — Profile ownership everywhere

A real two-profile MCP session must reject `score_job`, `pursue_job`,
`applications_plan`, `tailor_resume`, `draft_cover_letter`, `save_job`,
`map_reachable_network`, and `interview_prep` when `jobId` belongs to the
other profile. Rejections must name profile mismatch/ownership.
`list_jobs`, `review_queue`, and `list_tasks` must not leak the foreign
job. Isolation holds with JobOS absent from `PATH`.

### B19 — Real discovery, dedup, and offline multidimensional scoring

With blank provider keys and JobOS absent, a real subprocess must expose
every frozen extended MCP tool. Inline `import_job` text deduplicates to
one job id. `create_saved_search` with adapter `greenhouse` and a fixture
copied under `PLUGIN_DATA` plus `daily_discovery` / `search_jobs` must
return discovered jobs without API keys. `score_job` returns
`jobos.fit-score.v1` in `deterministic-degraded` mode with all seven
weighted dimensions (`roleFit` 28, `domainFit` 18, `seniority` 14,
`locationWorkModel` 12, `compensation` 8, `missionInterest` 14,
`networkAccess` 6) and a JobOS `scoreStatus`.

### B20 — No application folder for unsaved discovery

Jobs produced by `daily_discovery` may exist in the canonical store but
must not create `PLUGIN_DATA/jobs/<id>/` or `PLUGIN_DATA/applications/<id>/`
until `save_job` or `pursue_job`. B12 local fixture import may still
project imported jobs.

### B21 — Proof-grounded materials

`tailor_resume` and `draft_cover_letter` must exist, cite structured proof
from the profile, persist through `review_queue` after MCP restart, and
must not claim submit/send/apply/approval or invent metrics absent from
the resume/proofs.

`save_answer` is part of the same materials contract. It must require at
least one profile-owned `proofPointId`, generate the stored answer text
directly from the selected owned proof summaries when `answer` is omitted,
and accept a supplied `answer` only when it is the exact selected proof
wording. Arbitrary, paraphrased, or invented claims — including metrics
absent from the selected proofs, even when an unrelated proof id is
attached — must fail with `answer_not_grounded` and must not persist.
Omitted or exact proof wording that is accepted must survive MCP restart
via `list_answers`. Materials drafts and reusable answers must describe
stored proofs as unverified proof candidates that require human
verification; they must not label those candidates as already verified.

### B22 — Restart-persistent pipeline, tasks, networking, and interview prep

After pursue, a real subprocess must persist at least one `list_tasks`
item, accept inline `import_contact`, return local `map_reachable_network`
/ `plan_outreach` / `draft_outreach` (never sent), persist
`draft_interview_story` and `interview_prep`, and return a secret-safe
`preview_sync`. A restarted MCP process still lists tasks, interview
stories, network state, and a non-submitted `applications_plan`.

### B23 — Truthful blocks for send, submit, apply, approval, and unsupported actions

Blocked and unsupported names (`mark_outreach_sent`,
`attest_application_submitted`, `approve_artifact`, `submit_application_form`,
`apply_job`, `send_email`, `send_outreach`, plus the frozen human-only
catalog) must not appear on `tools/list`. Calling them must error as not
available / human-only / blocked and must not claim submitted/sent/applied/
approved or a deferred/future capability. `update_application_status` must
exist and must reject `applied` and `submitted`. `pursue_job` remains local.
`doctor` must not tell the agent to install JobOS.

### B24 — JobOS absent from runtime resolution and PATH

Extended-tool sessions spawn `./bin/jobsss mcp --data <temp>` with a trap
`jobos` first on `PATH`, blank provider keys, and a fake home. The trap
must not run. `JOBOS_HOME`, `~/.jobos`, the plugin root, and real JobOS
user state must remain untouched. `doctor` names `PLUGIN_DATA` and must
not recommend installing JobOS. All frozen extended tools are listed.

### B25 — Skill routes extended workflows without claiming send, submit, or JobOS

`SKILL.md` plus `skills/jobsss/references/` name every frozen extended MCP
tool, `PLUGIN_DATA`, and `./bin/jobsss`. They say JobOS is not required.
Send, submit, and approval stay handoff/blocked/human-only. No extra stable
slash sub-intents `/jobsss network`, `/jobsss interview`, or `/jobsss schedule`
may claim those domains. B6 blocked-language for network/interview/
scheduling/browser remains required.

### B26 — Coherent save/skip/archive/pursue job, application, and task state

A real bundled MCP subprocess with JobOS absent from `PATH` must keep
`save_job`, `skip_job`, `archive_job`, and `pursue_job` coherent. Discovered
jobs start unsaved (`job.saved=false`). `save_job` must set `job.saved=true`
and `job.status=saved`, persist a profile-owned application in a saved local
status, and persist at least one task. `skip_job` must not leave the job
saved and must set `job.status` to `archived` or `skipped` with a matching
application record. `archive_job` must set `job.status=archived` and the
application to archived without marking the job saved. `pursue_job` must keep
`job.saved=true`, record a pursued application, and persist tasks. A restarted
MCP process against the same `PLUGIN_DATA` still lists those job, application,
and task facts via `list_jobs` / `list_tasks` / `applications_plan`. No call
may claim submitted/sent/applied/approved.

### B27 — Serialized, atomic, redacted projection writes reject symlink escapes

Every aggregate (`PLUGIN_DATA/projections/`), job (`PLUGIN_DATA/jobs/<id>/`),
and application (`PLUGIN_DATA/applications/<id>/`) projection write must occur
under the same exclusive `jobsss.lock` serialization as the canonical store,
persist atomically (no `.tmp` leftovers), and stay secret-safe: no `resumeText`
dumps, no env secret values, no `sk-` tokens. Nested symlink escapes from
`projections/`, `jobs/`, or `applications/` that resolve outside `PLUGIN_DATA`
must be rejected with an explicit symlink/escape/unsafe/forbidden/path error.
The rejected write must not bump `store.json` revision, must not persist
`job.saved`, and must not create files in the symlink target. A live
`PLUGIN_DATA/jobsss.lock` must likewise fail mutating tools without emitting
`jobs/<id>/job.json` or `applications/<id>/application.json`. After a
successful `save_job`, those two projection files exist as regular files inside
`PLUGIN_DATA`. B20 still forbids job/application folders for unsaved discovery.

### B28 — Interview-story grounding includes title and reflection

`draft_interview_story` must account truthfully for every content field:
`title`, `situation`, `task`, `action`, `result`, and `reflection`. A draft
whose STAR fields copy owned proof text but whose `title` or `reflection`
fabricate metrics (`$10M`, `400%`) must not be marked `grounded=true` and must
not claim exact/full grounding. Partial fabricated STAR text must not be marked
grounded. Exact owned-proof wording on every content field may be grounded
pending human verification and must survive `list_interview_stories` after MCP
restart. Fabricated fields that persist must remain ungrounded after restart.

### B29 — Tailoring extracts requirements, selects relevant proof, reports gaps

`tailor_resume` and `draft_cover_letter` must extract job requirements from the
posting, rank and select relevant profile-owned proof rather than copy every
proof, organize that evidence in the draft, and report coverage gaps. An
unrelated owned proof (commercial fishing / salmon tonnage) must not be selected
or copied into the draft body. Extracted requirements must reflect the posting
(discovery, roadmap, stakeholder, product management, or equivalent). Coverage
gaps must be non-empty when the resume does not cover every requirement. Drafts
must not invent metrics absent from owned proofs (`400%`, `$10M`) and must not
claim submit/send/apply/approval. B21 resume/cover proof-citation and
reusable-answer grounding remain required.

---

## Verdict

**Pass** only if the frozen validation command exits `0` and B1–B29 hold on
inspected files and subprocess output.

**Fail** if any required file is missing, any check mismatches, any command
hangs, any mock replaces the bundled runtime, any `jobos` executable is
required or invoked, or any real user workspace is touched.

---

## Artifact hashes at lock

SHA-256 of reviewer-owned standalone test files and fixtures after the
Gate 0 lock and the B13 isolation strengthening. Implementers must not
change these files. `tests/helpers/jobsss-gate0.mjs` is unchanged leftover
from the previous foundation and is not the standalone contract.

```
fe69a0b428e6bd727fb1c558bd19bc3a050e529126cbc179a011f548eab75d25  tests/jobsss-gate0.test.mjs
790def53e34402489ac9f9ee962e1bc9fe5a287c523b8dcec891c6a0d9d3a602  tests/jobsss-mcp-compat.test.mjs
1d1fbaaf52acd733ad6c77909cb200caa57d6a8992d8745e5bf14893eeb86a26  tests/jobsss-journey.test.mjs
5e78590ab93031b334e2c67c4f081a52af0e5713306dcac3ad08eb4d88ac65e9  tests/fixtures/profile-resume.md
736a9d6957d2a5ab8e3ed4c4f1f95639afcca949facf3b71767af7b358e00db6  tests/fixtures/job-posting.md
ed0b0fc2f6318eed8255b5cdc459188dfb29b5e28314b7d786e2708162f1d7f9  tests/helpers/jobsss-gate0.mjs
```

SHA-256 of reviewer-owned round-2 files. Implementers must not change these
files. B1–B13 hashes above are unchanged.

```
7cacf15e8e6f1e6060ed20e07482e77538aaa8f012e45e7dbf11a51e0d391e82  tests/jobsss-persistence.test.mjs
ed13b3147f2e8bd8a5614fb71f1c244feb27675ebbe7daf42198746939b268ff  tests/jobsss-discovery.test.mjs
a8fb3bd6075acf815769c9541bab67c5e9e986d723d27c3b2052375a482bee78  tests/jobsss-workflows.test.mjs
a5871dfac9fc0a99607e5c1798f21f4497dabf54758a66d942de27f8cc237161  tests/helpers/jobsss-live-mcp.mjs
491bd2087db788c0c03128fc6a5d614c00166447ca2527291fefac59e9b94012  tests/fixtures/legacy-store-v1.json
0e414582d38f96811682bad733353b3817198d3810d1e635ff2d086c23767dc8  tests/fixtures/ats-board.json
5c33f1cdd8cc28d07eec4365593782ce5212f576d359a8caf51e8f3e8f82b070  tests/fixtures/contact-card.md
```

SHA-256 of reviewer-owned auditor-omission files. Implementers must not
change these files. B1–B25 hashes above are unchanged.

```
278b1773eb55e4be89d82da2727c934959efca2c0b7c19818ef4e0ec57006d04  tests/jobsss-integrity.test.mjs
```

## Correction log

- 2026-08-24T20:34:13Z — **B6**. Reason: genuine benchmark defect; the first
  lock froze JobOS skill modes instead of the user's explicit JobSSS set.
  Historical foundation correction. Not done to make tests green.
- 2026-08-25T02:49:56.365Z — **Gate 0 relock for standalone goal**. Reason: the
  confirmed standalone specification (`./bin/jobsss mcp --data ${PLUGIN_DATA}`,
  JobOS absent from PATH, `PLUGIN_DATA` persistence, full local journey)
  contradicts the 2026-08-24 JobOS-on-PATH launch contract. Change: preserved
  B1–B4 and B7; allowed plugin-relative `./` commands in B3 so B5 can name
  `./bin/jobsss`; replaced B5 with the bundled launcher contract; replaced
  B6/B8/B9/B10 and added B11–B12 as required live proofs. No allowed B10
  skip. Recorded today's failing baseline before freeze. Not done to make
  tests green.
- 2026-08-25T03:20:46Z — **Lock timestamp correction**. Check: Ownership and
  lock / Correction log Gate 0 relock entry. Reason: the recorded lock stamp
  `2026-08-25T03:10:00Z` is contradicted by orchestration evidence that Gate
  completed before any product implementation. Evidence: Gate reviewer run
  `64b411c5-08e1-471e-b2b5-e51942721cc6` started `2026-08-25T02:36:53.851Z`
  and completed `2026-08-25T02:49:56.365Z`; implementation workflow
  `5c9d7ae8-775a-41d9-8e83-47579d8387d6` started only at
  `2026-08-25T02:50:50.975Z`. Change: corrected the Gate 0 lock and the
  relock log timestamp to `2026-08-25T02:49:56.365Z`. Not done to make tests
  green.
- 2026-08-25T03:20:46Z — **B13**. Reason: independent auditor found missing
  core state-integrity coverage; committed `applications_plan` accepted a job
  owned by another profile. Inspected JobOS `compileApplicationReadiness`
  rejects that pairing as `profile_job_mismatch`. Change: appended required
  B13 and a real-MCP two-profile isolation assertion in
  `tests/jobsss-journey.test.mjs`; updated the frozen journey hash; did not
  delete, rewrite, or weaken B1–B12. Not done to make tests green.
- 2026-08-26T07:00:47Z — **B14–B25 Gate 0 extension for the confirmed JobSSS
  port round**. Reason: the confirmed acceptance contract requires lossless
  v1 `store.json` migration, serialized/stale writes, staged-only MCP
  filesystem intake, secret-safe post-commit projections, profile ownership
  on new surfaces, offline multidimensional scoring and discovery, no
  application folder for unsaved discovery, proof-grounded materials,
  restart-persistent pipeline/tasks/networking/interview prep, truthful
  send/submit/apply blocks, and JobOS-absent runtime — none of which B1–B13
  freeze. Change: preserved B1–B13 and their hashes; appended B14–B25 plus
  real-MCP tests/helpers/fixtures; recorded today's failing baseline
  (`# tests 27` `# pass 15` `# fail 12`, exit `1`) against the committed
  standalone runtime before freeze. Not done to make tests green.
- 2026-08-26T08:06:11Z — **B21 reusable-answer grounding**. Reason: genuine
  benchmark defect / documented contract omission. B21 already forbids
  inventing metrics absent from resume/proofs, but named only
  `tailor_resume` / `draft_cover_letter`. An independent auditor, and a
  reviewer live MCP probe against committed HEAD, showed `save_answer`
  accepted and persisted `I grew revenue by $10M and increased conversion
  400%.` when linked only to the unrelated fixture 30% proof
  (`proof_e5b40e9e7e6a019e`). The existing B21 test's `$10M|400%` assertion
  covered resume/cover only, so that hole stayed green. Change: appended the
  reusable-answer grounding contract and candidate-not-verified language to
  B21; strengthened `tests/jobsss-workflows.test.mjs` with a real-MCP
  fabrication/omit/exact/restart probe; updated only that file's frozen
  hash. Recorded the new assertions failing against committed HEAD (exit `1`,
  `save_answer schema must require owned proofPointIds`) before the
  uncommitted product correction. Did not delete, rewrite, or weaken B1–B20
  or B22–B25, nor the original B21 resume/cover requirements. Not done to
  make tests green.
- 2026-08-28T03:43:00Z — **B26–B29 independent-auditor omissions**. Reason:
  genuine documented contract omissions against committed HEAD `a7dea90`.
  A reviewer live MCP probe showed: (1) `save_job`/`skip_job`/`archive_job`/
  `pursue_job` update application/tasks but leave discovered `job.saved=false`
  and `job.status=new`; (2) `jobs/<id>` and `applications/` projection writes
  run after lock release, follow nested symlinks, and write `job.json` outside
  `PLUGIN_DATA` while still persisting the store write; (3) `draft_interview_story`
  marks `grounded=true` when STAR fields match a proof even if `title` is
  `I grew revenue by $10M in one quarter.` and `reflection` claims `400%`;
  (4) `tailor_resume`/`draft_cover_letter` copy every owned proof, including an
  unrelated fishing-vessel proof, and return no extracted requirements or
  coverage gaps. B1–B25 stayed green. Change: preserved B1–B25 and every
  existing test/hash; appended B26–B29 and `tests/jobsss-integrity.test.mjs`;
  recorded today's failing baseline (`# tests 31` `# pass 27` `# fail 4`,
  exit `1`) against committed HEAD before any product correction. Not done to
  make tests green.
