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
delete, rewrite, or weaken B1–B25. B26 and B27 are additionally strengthened
for terminal skipped/archived `applications_plan` next actions and canonical
`store.json` secret redaction without deleting, rewriting, or weakening
B1–B25 or B28–B29. B28 is additionally strengthened for substring-only
interview-story grounding and exact `fieldEvidence` quotes without deleting,
rewriting, or weakening B1–B27 or B29. B30–B41 extend that bar for the
confirmed JobSSS productization round and must not delete, rewrite, or
weaken B1–B29. B30 is additionally strengthened for complete-release
determinism of both `release-manifest.json` copies, portable/relative
evidence, no build-user/home/workspace/source/scratch/output paths, and
no released-runtime dependency on the build checkout or `tests/fixtures`
without deleting, rewriting, or weakening B1–B29 or B31–B41. B42–B47
extend that bar for the confirmed cross-platform remediation round and
must not delete, rewrite, or weaken B1–B41. B46 and B47 are additionally
strengthened so both reports are finalized with the actual frozen-command
count and PASS, and must not leave a reviewer verdict pending, without
deleting, rewriting, or weakening B1–B45. B48–B53 extend that bar for the
confirmed native-remediation round and must not delete, rewrite, or
weaken B1–B47. B54 extends that bar for empty-cache pinned postject
acquisition and must not delete, rewrite, or weaken B1–B53. B55–B60
extend that bar for the independent-auditor native-safety findings and
must not delete, rewrite, or weaken B1–B54. B61–B64 extend that bar for
the remaining independent-native evidence gaps and must not delete,
rewrite, or weaken B1–B60.

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
| `tests/jobsss-release.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-adapters.test.mjs` | reviewer | reviewer only |
| `tests/jobsss-authority.test.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-live-mcp.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-productization.mjs` | reviewer | reviewer only |
| `tests/jobsss-cross-platform.test.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-cross-platform.mjs` | reviewer | reviewer only |
| `tests/jobsss-native-remediation.test.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-native-format.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-native-inputs.mjs` | reviewer | reviewer only |
| `tests/helpers/jobsss-native-validators.mjs` | reviewer | reviewer only |
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
- Node.js Single Executable Applications (v22.22.3)
  `https://nodejs.org/docs/v22.22.3/api/single-executable-applications.html`
- Node-supported SEA injection tool postject 1.0.0-alpha.6
  `https://github.com/nodejs/postject`
  `https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`
- Official Node v22.22.3 distribution checksums
  `https://nodejs.org/dist/v22.22.3/SHASUMS256.txt`

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
B48–B64 may download checksum-pinned official Node v22.22.3 archives,
the pinned postject tarball, and pinned independent validator wheels
(pefile/macholib/altgraph) into a temporary cache outside the plugin tree
(`$JOBSSS_NATIVE_CACHE` or `os.tmpdir()/jobsss-native-gate-cache`). Those
blobs must not be committed. There is no allowed skip for missing official
Node inputs. B54 additionally requires a genuine empty cache: a pre-populated
`JOBSSS_NATIVE_CACHE` is not a substitute for acquisition.

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
  tests/jobsss-integrity.test.mjs \
  tests/jobsss-release.test.mjs \
  tests/jobsss-adapters.test.mjs \
  tests/jobsss-authority.test.mjs \
  tests/jobsss-cross-platform.test.mjs \
  tests/jobsss-native-remediation.test.mjs
```

### Expected exit code

`0` after a complete, truthful standalone implementation.

### What pass means

Exit `0` is necessary and not sufficient. Every check B1–B64 below must hold
on the real files, on a real bundled MCP subprocess, and on the current-host
release artifact where those checks require it. Invented output, mocks of the
runtime, skipped required checks, or touching real user JobOS or client
profiles are a fail.

No allowed skip. B10–B12 and B14–B64 are required even when `jobos` is absent.
There is no allowed skip for missing Node on PATH for B31–B32: the released
`bin/jobsss` must start without resolving `node` or `jobos` from PATH.

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

### Iteration-2 strengthening baseline recorded 2026-08-28 against committed HEAD `bc5c86c`

B1–B25 and B28–B29 pass on the committed plugin. Strengthened B26/B27
assertions fail against that same runtime using real `PLUGIN_DATA` stores and
real `./bin/jobsss` MCP subprocesses. Missing product behavior, not benchmark
defects. Combined frozen command: `# tests 31` `# pass 29` `# fail 2`, exit
`1`. Observed failures: B26 `applications_plan` for a skipped job returns
nextActions `human review` and `verify proof-grounded materials` after tasks
were cancelled; B27 `import_job` of `sk-ingestedcanonicalsecretvalue99` plus
the environment secret persists both tokens in canonical `store.json` while
ordinary resume/job content remains.

### Iteration-3 strengthening baseline recorded 2026-08-28 against committed HEAD `30047e4`

B1–B27 and B29 pass on the committed plugin. Strengthened B28 assertions fail
against that same runtime using real `PLUGIN_DATA` stores and real
`./bin/jobsss` MCP subprocesses. Missing product behavior, not benchmark
defects. Combined frozen command: `# tests 31` `# pass 30` `# fail 1`, exit
`1`. Observed failures: B28 `draft_interview_story` marks `grounded=true` /
`exact_proof_text_needs_human_verification` when every content field is only
the substring `30%` (or title `Led discovery`) of owned proof `Led discovery
with educators and operations teams to prioritize an AI-assisted learning
workflow that reduced manual review time by 30%.`; `fieldEvidence` records
`matchedProofPointIds` but no verbatim proof summary/quote.

### Productization baseline recorded 2026-08-31 against committed HEAD `c47c557`

B1–B29 pass on the committed plugin (`# tests 31` `# pass 31` `# fail 0`,
exit `0` for the previous seven-file command). B30–B41 are frozen failing
against that same runtime using real subprocesses, temporary `PLUGIN_DATA`,
and actual `./bin/jobsss` invocations. Missing product behavior, not
benchmark defects. Combined frozen command: `# tests 43` `# pass 31`
`# fail 12`, exit `1`. Observed failures:

| Check | Result today | Observed failure |
| --- | --- | --- |
| B1–B29 | pass | preserved on HEAD `c47c557` |
| B30 | fail | `./bin/jobsss release --out` exits `1` with `unknown command: release`; in-repo `bin/jobsss` is still a Node shebang launcher |
| B31 | fail | no current-host release artifact; same `unknown command: release` |
| B32 | fail | no current-host release artifact; same `unknown command: release` |
| B33 | fail | missing required product file `compat/matrix.json` |
| B34 | fail | missing required product file `compat/matrix.json` |
| B35 | fail | missing required product file `compat/matrix.json` |
| B36 | fail | `tools/list` missing handoff tool `list_decision_handoffs` |
| B37 | fail | `./bin/jobsss decide --list` exits `1` with `unknown command: decide` |
| B38 | fail | `./bin/jobsss decide --list` exits `1` with `unknown command: decide` |
| B39 | fail | MCP must expose handoff tool `list_decision_handoffs` without granting authority |
| B40 | fail | `./bin/jobsss decide --list` exits `1` with `unknown command: decide` |
| B41 | fail | docs must name the trusted local surface `./bin/jobsss decide` |

### Iteration-6 B30 strengthening baseline recorded 2026-09-01 against today's worktree (HEAD `c47c557` plus uncommitted productization)

The original four-file B30 identity still passes on today's current-host
release (`plugin.json`, `mcp.json`, `SKILL.md`, and `bin/jobsss`
byte-identical across `.tmp/jobsss-productization/out-a` and `out-b`).
Strengthened complete-release checks fail against that same artifact.
Missing portable deterministic-complete-release behavior, not a product
workaround and not a four-file hash defect. Focused command:

`node --test --test-concurrency=1 --test-name-pattern='B30 deterministic portable current-host release layout' tests/jobsss-release.test.mjs`

exit `1`, `# tests 1` `# pass 0` `# fail 1`, `duration_ms 2976.112161`.
First assertion: `bin/jobsss` and both `release-manifest.json` copies
contain `/home/logani/projects/jobsss`, `/home/logani/.hermes/node/bin/node`,
`.tmp/jobsss-productization`, output `--out` paths, and `tests/fixtures`.
Independent helper probe against `out-a`/`out-b` also failed complete-tree
determinism (manifest SHA-256
`56b49a1832d8e46aa132abb55033322dba6c3570f0ae2829baf216360ec44497` vs
`25a71a248b2b6eaf58cb59cbf3e6e78467da3f218a5cafd558babffa801d108d` because
`generatedAt` and absolute paths differ), portable evidence (`nodeBinary` /
`entryPath` / `command` are absolute), and truthful `linux-x64` `verified`
with `artifactSha256: null`.

### Cross-platform remediation baseline recorded 2026-09-02 against committed HEAD `ba2123e`

B1–B41 pass on the committed plugin (`# tests 43` `# pass 43` `# fail 0` for
the previous ten-file command). B42–B47 are frozen failing against that same
runtime. Missing inspectable ELF/Mach-O/PE definitions and required reports,
not benchmark defects. Combined frozen command: `# tests 49` `# pass 43`
`# fail 6`, exit `1`, `duration_ms 29104.753968`, Node v22.22.3. Observed
failures:

| Check | Result today | Observed failure |
| --- | --- | --- |
| B1–B41 | pass | preserved on HEAD `ba2123e` |
| B42 | fail | missing required product file `src/packaging.js` |
| B43 | fail | missing required product file `src/packaging.js` |
| B44 | fail | missing required product file `src/packaging.js` |
| B45 | fail | missing required product file `src/packaging.js` |
| B46 | fail | missing required file `PRODUCTIZATION_REVIEW.md` and every revised-goal section |
| B47 | fail | missing required file `RELEASE_REPORT.md` and every revised-goal section/identity rule |

Independent CLI probes against the same HEAD, not invented: `./bin/jobsss
release --out /tmp/jobsss-xplat-base-darwin --target darwin-arm64` exit `1`,
`release: target darwin-arm64 is defined in the manifest as intended but only
current-host is buildable on this host`; the same for `win-x64`; `./bin/jobsss
release --out /tmp/jobsss-xplat-base-nb --target darwin-arm64 --node-binary
/tmp/no-such-node` exit `2`, `release: unknown option: --node-binary`.
`src/sea-build.js` remains current-host 64-bit ELF `injectSeaNote` only;
Mach-O/PE injection is prose in `src/release.js` (`Windows additionally needs
the PE resource (RT_RCDATA) injection variant`). Synthetic fixtures were not
used to claim macOS or Windows runtime verification.

### Native-remediation baseline recorded 2026-09-02 against committed HEAD `8b2db25`

B1–B47 pass on the committed plugin (`# tests 49` `# pass 49` `# fail 0` for
the previous eleven-file command). B48–B53 are frozen failing against that
same runtime using genuine checksum-pinned official Node v22.22.3
executables in temporary cache only and an independent native-format
validator that does not import `src/packaging.js` or the synthetic-fixture
generator. Missing pinned tooling/lock and unsafe ad hoc Mach-O/PE mutation,
not benchmark defects. Combined frozen command: `# tests 55` `# pass 50`
`# fail 5`, exit `1`, `duration_ms 40048.300212`, Node v22.22.3. Observed
failures:

| Check | Result today | Observed failure |
| --- | --- | --- |
| B1–B47 | pass | preserved on HEAD `8b2db25` |
| B48 | fail | missing required product file `src/packaging.lock.json` |
| B49 | fail | ad hoc `injectMacho` mutator still present in `src/packaging.js` |
| B50 | fail | official darwin-arm64 Node: stale LC_SYMTAB/LC_DYSYMTAB/LC_DYLD_INFO_ONLY/LC_FUNCTION_STARTS/LC_CODE_SIGNATURE offsets after a 152-byte load-command insertion; NODE_SEA vmsize 0 with filesize 56 |
| B51 | fail | official win-x64 `node.exe`: SizeOfImage stayed 89866240 after growing sections to 89870336; overlay 15688 bytes destroyed (file shrunk 15176); original RT_ICON/RT_GROUP_ICON/RT_VERSION/RT_MANIFEST resources replaced |
| B52 | pass | runtime still has no `package.json`; official Node/tool caches are uncommitted; reports do not label darwin/win verified |
| B53 | fail | `PRODUCTIZATION_REVIEW.md` still says `RELEASE_REPORT.md` reviewer verdict remains pending; recorded `# tests 49` is stale versus live frozen-command count 55 |

Independent official-input probes against the same HEAD, not invented:
checksum-verified `node-v22.22.3-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,win-x64}`
archives in `/tmp/jobsss-native-gate-cache` only. Injecting the official
darwin-arm64 Node through today's `injectSeaPayload` leaves linkedit command
offsets unshifted by 152 bytes and emits `NODE_SEA` with `vmsize=0`.
Injecting official `node.exe` leaves `SizeOfImage` at `0x55b4000`, drops the
15688-byte overlay, and replaces the resource directory. Synthetic fixtures
were not used to claim macOS or Windows runtime verification.

### Empty-cache acquisition baseline recorded 2026-09-03 against today's worktree

B1–B52 remain intact. Additive B54 fails against today's `acquirePostject`
before any product correction. Missing empty-cache acquisition, not a
benchmark defect. Independent CLI and focused B54 output, not invented:

```bash
JOBSSS_NATIVE_CACHE=<empty> ./bin/jobsss release --out <absdir> --target current-host
# exit 1
# TypeError [ERR_INVALID_ARG_TYPE]: ... Received an instance of Promise
# verifyPinnedChecksum (src/packaging.js:146) <- acquirePostject (src/packaging.js:310)
```

Focused command:

```bash
node --test --test-concurrency=1 --test-name-pattern='B54 empty-cache' \
  tests/jobsss-native-remediation.test.mjs
```

`# tests 1` `# pass 0` `# fail 1`, exit `1`, `duration_ms 601.945467`,
Node v22.22.3. Observed failure: empty `JOBSSS_NATIVE_CACHE` current-host
release exits `1` because `httpsDownload()` returns a Promise that
`acquirePostject` passes into `verifyPinnedChecksum` / `Buffer.from`.
Pre-populated `/tmp/jobsss-native-gate-cache` is not a substitute.
B53 now sees live frozen-command count 56 versus reports still recording
`# tests 55`; reports stay reviewer-owned for the eventual PASS review and
were not edited here.

### Independent-auditor native-safety baseline recorded 2026-09-03 against committed HEAD `0b962be`

B1–B54 remain intact except the B51 Authenticode/overlay contradiction
corrected below. Additive B55–B59 fail against today's committed packaging
before any further product correction; B60 already passes on separate-process
official-target releases. Custom PE post-processing, invalid certificate
restore, missing official `--node-binary` checksums, and in-repo
parser-as-validator are product gaps, not benchmark defects. Focused command:

```bash
node --test --test-concurrency=1 --test-name-pattern='B51 |B55 |B56 |B57 |B58 |B59 |B60 '
  tests/jobsss-native-remediation.test.mjs
```

Focused result, not invented: `# tests 6` `# pass 0` `# fail 6`, exit `1`,
`duration_ms 52277.796758`, Node v22.22.3. Observed failures:

| Check | Result today | Observed failure |
| --- | --- | --- |
| B51 | fail | injected official PE Security directory file offset 87095808, not 0 |
| B55 | fail | `function restorePeOverlay(` still present in `src/packaging.js` |
| B56 | fail | Security directory file offset 87095808 after injection; certificate overlay restored |
| B57 | fail | extra non-certificate overlay still acquires postject tarball before throwing |
| B58 | fail | mutated linux-x64 `--node-binary` exit 0 and writes `bin/jobsss` |
| B59 | fail | `src/packaging.lock.json` does not pin pefile 2024.8.26 |
| B60 | pass | two fresh-process official-target releases already byte-identical |

Separate B60 command: `# tests 1` `# pass 1` `# fail 0`, exit `0`,
`duration_ms 101891.397946`. Frozen twelve-file live count becomes 62.
Reports were not edited here.

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
may claim submitted/sent/applied/approved. `applications_plan` for a terminal
skipped or archived record must expose no active preparation next actions
(human-review, material tailoring or verification, or other open pipeline
prep). Cancelled tasks must not reappear as next actions. Pursued jobs may
still list local next actions.

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
Every durable write, including canonical `store.json`, must redact environment
secret values and `sk-` tokens. A synthetic `sk-` or environment secret ingested
into canonical job or profile content must not appear in `store.json`. Ordinary
resume and job content must remain usable for scoring. Canonical `store.json`
may still retain resume text (B17). Projection secret-safety, atomicity, lock,
and symlink-escape rules above remain required.

### B28 — Interview-story grounding includes title and reflection

`draft_interview_story` must account truthfully for every content field:
`title`, `situation`, `task`, `action`, `result`, and `reflection`. A draft
whose STAR fields copy owned proof text but whose `title` or `reflection`
fabricate metrics (`$10M`, `400%`) must not be marked `grounded=true` and must
not claim exact/full grounding. Partial fabricated STAR text must not be marked
grounded. Exact owned-proof wording on every content field may be grounded
pending human verification and must survive `list_interview_stories` after MCP
restart. Fabricated fields that persist must remain ungrounded after restart.
A short substring or fragment of an owned proof (`30%`, `Led discovery`) must
not be marked `grounded=true` and must not claim exact/full grounding. Only
normalized equality to the complete owned proof wording may ground a field.
Every grounded field must record exact supporting evidence including the
matching `proofPointId` and the verbatim proof summary/quote. Unsupported
fields must cite none: no `proofPointId` and no supporting quote.
Substring-only drafts that persist must remain ungrounded after restart and
must cite none on the fragment fields.

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

### B30 — Deterministic portable current-host release layout

`./bin/jobsss release --out <absdir> --target current-host` must exit `0` and
write a portable plugin tree for the current host containing `plugin.json`,
`mcp.json`, `skills/jobsss/SKILL.md`, `skills/jobsss/references/`, and
`bin/jobsss`. The tree may live at `<out>/current-host/` or `<out>/` if those
files are present together. `mcp.json` in the release must keep the frozen
stdio `jobsss` contract. Release `bin/jobsss` must be a regular executable
file, not a symlink, and not a `#!/usr/bin/env node` launcher. A
`release-manifest.json` in the output must list every intended target
`current-host`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
and `win-x64` with status `verified`, `built`, `intended`, or `unverified`.
Only a target actually exercised on this host may be `verified`. Two
consecutive clean current-host releases must be byte-identical for
`plugin.json`, `mcp.json`, `skills/jobsss/SKILL.md`, and `bin/jobsss`.
The complete `--out` tree, including both `release-manifest.json` copies
(output root and current-host plugin tree), must also be byte-identical
across those clean builds. Wall-clock `generatedAt` and build-absolute
paths are not justified unavoidable metadata; prefer none. No release
file and no printable string inside released `bin/jobsss` may contain
build-user home, workspace, source-checkout, scratch, or output paths,
including `tests/fixtures` and `.tmp/jobsss-productization`. The released
runtime must not depend on the build checkout or `tests/fixtures`.
Manifest evidence fields must be portable or relative. A `verified` or
`built` target must record a real SHA-256 of the artifact it claims;
`null` hashes and absolute Node, scratch, or `--out` paths are untruthful.
Justified metadata (LICENSE, README, NOTICE, release-manifest, thin compat
files) may exist. Secrets, `.env`, `node_modules`, and `.git` must not.

### B31 — Released `bin/jobsss` starts generic stdio MCP with Node and JobOS absent

Spawn the current-host released `bin/jobsss mcp --data <temp PLUGIN_DATA>`
with a restricted PATH that contains `node` and `jobos` traps plus `/usr/bin`
and `/bin` only. A real initialize, `tools/list`, `doctor`, and `start`
exchange must succeed. Journey tools `doctor`, `start`, `create_profile`,
`import_job`, and `list_jobs` must be listed. The node trap and jobos trap
must not run. The release plugin tree must not be written.

### B32 — Released MCP persists only under temp PLUGIN_DATA and survives restart

Using the same Node-free released binary, `start` → `create_profile` from
`tests/fixtures/profile-resume.md` → `import_job` from
`tests/fixtures/job-posting.md` must persist `PLUGIN_DATA/store.json`. A
restarted released MCP process against the same directory must still list
the imported job. No user state may be written into the release tree. The
runtime must not claim submitted/sent/applied/approved.

### B33 — Canonical skill/tool equivalence across generated and native adapters

`compat/matrix.json` must exist at the plugin root and list clients `pi`,
`omp`, `codex`, `hermes`, and `claude`. A real in-repo MCP `tools/list` must
include every frozen journey tool, every frozen extended tool, and the
handoff tools `list_decision_handoffs` and `create_decision_handoff`.
Canonical `SKILL.md` plus references must name those tools and
`./bin/jobsss decide`. Generated adapter files, if present, must be identical
canonical skill copies or pointers to `skills/jobsss/SKILL.md` /
`./bin/jobsss`. An adapter that enumerates tools must enumerate the same
canonical set.

### B34 — Isolated available-client launch paths and truthful unverified reporting

`./bin/jobsss compat-probe --client <pi|omp|codex|hermes|claude> --config-dir
<temp> --plugin-root <plugin>` must exit `0` and print JSON with
`status` `verified` or `unverified`. `compat/matrix.json` status for that
client must match the probe. `verified` probes must name the JobSSS runtime
and must not launch `jobos mcp`. Probes must use isolated temporary
configuration only and must not mutate real client profiles under the host
home (`.claude`, `.codex`, `.hermes`, `.omp`, `.pi`, `.cursor`, and matching
XDG config trees). Unavailable or unproven clients must be labeled
`unverified`, never `verified`.

### B35 — Adapters contain no business logic

Generated adapter code under `compat/` must not implement store writes,
scoring, proof extraction, tailoring, interview-story drafting, JobOS
spawns, SQL schemas, or a `HUMAN_ONLY_DOMAIN_TOOLS` policy replica.
Native-loading clients may have no adapter files. A matrix entry that
claims a generated adapter must ship those files.

### B36 — Trusted-local-only enumerated human decisions

MCP `tools/list` must include `list_decision_handoffs` and
`create_decision_handoff` and must not include the trusted actions.
`./bin/jobsss decide --data <PLUGIN_DATA> --list` must print JSON pending
items after a real local journey that created proofs, artifacts, contacts,
stories, outreach, debrief, and an application. Each pending item must
expose entity id, integer revision, and lowercase SHA-256 `contentHash`.
The trusted local CLI must complete all of:

- `proof.verify`
- `artifact.approve` / `artifact.reject`
- `contact.approve` / `contact.suppress`
- `story.verify` / `story.retire`
- `debrief.record` / `debrief.correct`
- `outreach.sent` / `outreach.outcome`
- `application.observe_status`

Exact invocation:

`./bin/jobsss decide --data <dir> --action <action> --id <id> --revision <n> --content-hash <sha256>`

Human observation of an external application status is allowed only on this
trusted local surface and must record a human/trusted-local actor. Product
language must not claim JobSSS sent, submitted, or applied. MCP
`update_application_status` remains forbidden from attesting
`applied`/`submitted` (B23).

### B37 — Exact entity ID, revision, and content-hash binding

A trusted decision without `--content-hash`, without `--revision`, or with
an unknown `--id` must fail and must not persist. The same pending item
accepted with the exact listed id, revision, and content hash must succeed.

### B38 — Typed stale conflict

A trusted decision whose `--revision` does not match the current entity
revision, or whose `--content-hash` does not match the current content
hash, must fail with a typed `stale_conflict` / `stale_revision` /
`content_hash_mismatch` error and must not persist the rejected write.
The pending item must remain.

### B39 — MCP authority forgery rejection

MCP callers may create and list decision handoffs. They must not complete
or forge human authority via tool names, arguments (`approved`,
`humanApproved`, `authority=human`, `verifyProofs`), labels, or environment
variables (`JOBSSS_AUTHORITY`, `JOBSSS_HUMAN_APPROVE`, `JOBSSS_APPROVE`).
Calling frozen human-only names, `decide`, `trusted_decide`, or
`proof.verify` over MCP must error as not available / human-only / blocked.
Proof candidates and artifacts must remain unverified/unapproved. MCP must
still reject `applied` even when approval flags are supplied.

### B40 — Audit history and projections agree after trusted-local action

After a successful `./bin/jobsss decide` action, canonical `store.json`
audit (or equivalent) plus `PLUGIN_DATA` projections must mention the
entity id, the action, and a trusted-local/human actor. They must not claim
JobSSS sent/submitted/applied. A restarted MCP process listing
`list_decision_handoffs` and `review_queue` must still agree on that entity
id.

### B41 — Documentation verified/unverified distinction

Canonical skill, references, README, and `compat/matrix.json` must name
`./bin/jobsss decide`, keep `/jobsss review`, and route review to pending
decisions plus trusted-local instructions. Clients `pi`, `omp`, `codex`,
`hermes`, and `claude` and intended platforms/targets must be labeled
`verified`, `built`, `intended`, or `unverified`. Unproven paths must use
`unverified`. Docs must distinguish local preparation, human observation,
and unsupported/blocked behavior. They must not tell the agent to install
JobOS, route to a JobOS TUI this plugin does not ship, claim JobSSS
sent/submitted/interviewed/applied, or add `/jobsss network`,
`/jobsss interview`, or `/jobsss schedule` sub-intents. B6/B7/B25
human-only naming remains required.

### B42 — Inspectable executable ELF/Mach-O/PE build definitions, separated from product behavior

`src/packaging.js` exists at the plugin root, is not a symlink, and is the
inspectable executable definition entry for Linux ELF, macOS Mach-O, and
Windows PE. It must export `identifyExecutable(bytes)` returning
`{ format: 'elf'|'macho'|'pe', arch: 'x64'|'arm64', bits: 64 }` and
`injectSeaPayload({ target, executable, blob })` returning injected
executable bytes. It must declare targets `linux-x64`, `linux-arm64`,
`darwin-x64`, `darwin-arm64`, and `win-x64` with those formats and
architectures. Platform-specific injection/build logic is selected
explicitly by target/format and must not live in MCP, domain, authority,
store, scoring, workflow, discovery, relationship, or compat-probe modules.
`src/packaging.js` must not import those product-behavior modules and must
not embed fit-score weights, a `HUMAN_ONLY_DOMAIN_TOOLS` replica, or MCP
tools. B30–B32 current-host ELF release behavior remains required.

### B43 — Format/architecture validation and native SEA container injection contract

For every required target, `identifyExecutable` must accept a synthetic
64-bit fixture of the matching format/architecture, and `injectSeaPayload`
must inject the SEA payload using the correct native container:

- Linux ELF: `PT_NOTE` named `NODE_SEA_BLOB` against checksum-pinned official
  Node linux-x64 / linux-arm64 (pinned postject/LIEF cannot relocate the PHDR
  table of the tiny synthetic ELF layout)
- macOS Mach-O: segment `NODE_SEA` and section `NODE_SEA_BLOB` (Node/postject
  `--macho-segment-name NODE_SEA`) against a synthetic Mach-O fixture
- Windows PE: `RT_RCDATA` (10) resource named `NODE_SEA_BLOB` against a
  postject-compatible independently sourced PE that already contains a
  resource directory (pinned postject `inject_into_pe` returns an error when
  `!binary->has_resources()`)

The injected image must remain the same format and architecture, carry the
blob bytes, and flip `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0` to
`:1`. Mismatched format or architecture, truncated garbage, and unsupported
targets must fail clearly with mismatch/unsupported/invalid/unrecognized.
Synthetic native-format fixtures may test unavailable-format parsers and
injectors. They must never attest platform runtime support.

### B44 — Deterministic repeatability and canonical target release layout

Identical `injectSeaPayload` inputs must produce byte-identical output for
every required target. `./bin/jobsss release --out <absdir> --target <id>
[--node-binary <abs>]` must accept `--node-binary` for a matching-format
base executable. Two consecutive `darwin-arm64` releases against the same
synthetic Mach-O base must exit `0`, write the canonical portable layout
(`plugin.json`, `mcp.json`, `skills/jobsss/SKILL.md`,
`skills/jobsss/references/`, and `bin/jobsss` or `bin/jobsss.exe`), and be
byte-identical for the released launcher, which must remain Mach-O arm64.

### B45 — Truthful unverified labels; fixtures never attest platform runtime support

On a non-matching host, `./bin/jobsss release --out <absdir> --target
darwin-arm64` without `--node-binary` must fail clearly (`unverified` /
`unsupported` / `unavailable` / `mismatch` / `missing`) and must not label
darwin verified. A Mach-O `--node-binary` must be rejected for `linux-x64`.
Fixture-level `darwin-arm64` and `win-x64` releases that succeed must label
those targets `unverified`, never `verified`. Existence or fixture-level
validation of a build definition is not platform verification. Only a real
matching-host exercise may be `verified`. B30 still allows `intended` for
unexercised targets; this check additionally requires `unverified` for
unavailable macOS and Windows hosts and for synthetic-fixture exercises.
Linux/current-host verification remains the B30–B32 real-host artifact
exercise.

### B46 — `PRODUCTIZATION_REVIEW.md` completeness

`PRODUCTIZATION_REVIEW.md` exists at the plugin root and contains every
revised-goal section: B1–B41, cross-platform build definitions, current-host
restricted-PATH release evidence, adapter behavior, human authority, exact
commands/results, residual risks, and the fresh verdict. During the eventual
PASS review this file must also record the actual frozen-command `# tests` /
`# pass` / `# fail 0` counts and a PASS verdict. It must not leave the
reviewer verdict pending. B53 freezes those finalization rules.

### B47 — `RELEASE_REPORT.md` completeness and identity

`RELEASE_REPORT.md` exists at the plugin root and contains the release
summary, generic restricted-PATH MCP evidence, client compatibility matrix,
human-authority behavior, commands/results, reviewer verdict, reviewed
baseline/intermediate commit identity
`ba2123ef5f6f24bcf6ae994a125b67501b970785`, deferred/unverified
capabilities, and the statement that the final corrective SHA is supplied
in the final response. Because a commit cannot contain its own SHA, the
report must not invent a final SHA. Intermediate identity
`8b2db255e7868397d336f8b015c489552b84bf0e` must also remain named. During
the eventual PASS review this file must record the actual frozen-command
`# tests` / `# pass` / `# fail 0` counts and a PASS verdict, and must not
leave the reviewer verdict pending. B53 freezes those finalization rules.

### B48 — Checked-in small lock manifest with pinned URLs, versions, SHA-256, tool identity, and checksum rejection

`src/packaging.lock.json` exists at the plugin root, is not a symlink, is
small JSON (not a binary cache), and pins:

- the Node-supported SEA injection tool `postject` 1.0.0-alpha.6 at
  `https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz` with
  SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`
- official Node v22.22.3 inputs for `linux-x64`, `linux-arm64`,
  `darwin-x64`, `darwin-arm64`, and `win-x64` with official dist URLs,
  archive SHA-256, format, architecture, and `buildOnly: true`

Inspectable build definitions must consult that lock and verify SHA-256
before injection. `src/packaging.js` must export `verifyPinnedChecksum`
(or `assertPinnedChecksum` / `verifyChecksum`) that throws a
checksum/sha256/mismatch error for corrupt bytes. Silent latest-version
installs are a fail. No official Node archive/executable or tool tarball
may be committed.

### B49 — Ad hoc Mach-O/PE mutators removed; pinned Node-supported injection tooling required

`src/packaging.js` must not implement ad hoc `injectMacho` / `injectPe`
binary mutation and must not patch around their known malformed-output
defects (zero-vmsize `NODE_SEA`, hardcoded PE `.rsrc` section-header
append). Native mutation for ELF, Mach-O, and PE must go through the
pinned Node-supported injector recorded in `src/packaging.lock.json`
(documented `postject` flow, including `--macho-segment-name NODE_SEA`).
Custom code may identify targets, orchestrate the pinned tool, verify
checksums, and validate outputs. Missing tools, wrong format/arch,
checksum mismatch, or unsupported signing state must fail clearly and
non-destructively. Packaging stays separated from MCP/domain/authority/
store/scoring/workflow/discovery/compat-probe behavior (B42).

### B50 — Genuine official Node Mach-O injection preserves load-command/linkedit offsets, SEA VM sizing, and documented signature-removal semantics

Acceptance must obtain checksum-pinned official Node v22.22.3 darwin-arm64
and darwin-x64 executables into temporary cache only. `injectSeaPayload`
against those binaries, plus a rich Mach-O that already contains
LC_SYMTAB, LC_DYSYMTAB, LC_DYLD_INFO_ONLY, LC_FUNCTION_STARTS,
LC_CODE_SIGNATURE, and `__LINKEDIT`, must be inspected by the independent
reviewer parser in `tests/helpers/jobsss-native-format.mjs` (not
`src/packaging.js` and not the B43 synthetic-fixture generator). After
injection:

- LC_SYMTAB / LC_DYSYMTAB / dyld-info / function-starts / `__LINKEDIT` file
  offsets that pointed into moved file content must point at the actual
  relocated bytes (page-aligned LIEF/postject insertion, typically 0x4000 on
  arm64 and 0x1000 on x64). A sizeofcmds-delta arithmetic check is not the
  documented relocation. Offsets must not be left stale at the pre-insertion
  file positions.
- `LC_CODE_SIGNATURE` must be removed. Pinned postject 1.0.0-alpha.6
  (`src/postject.cpp`) calls `Binary::remove_signature()` because "It will
  need to be signed again anyway." Node.js SEA docs require
  `codesign --remove-signature` before inject and `codesign --sign -` after.
  Re-signing is a subsequent matching-host step, not container preservation.
- `NODE_SEA` filesize > 0, vmsize >= filesize > 0, and the VM range must
  not overlap other segments
- the independent parser must locate `NODE_SEA_BLOB` and hash-match the
  payload; the SEA fuse must be `:1`

Successful container validation is not macOS runtime verification (B45).

### B51 — Genuine official Node PE injection preserves SizeOfImage, section-header space/alignment, and resources

Acceptance must obtain the checksum-pinned official Node v22.22.3 win-x64
`node.exe` into temporary cache only. `injectSeaPayload` against that
binary, plus a postject-compatible independently sourced PE that already
contains a resource directory and insufficient section-header space, must
be inspected for image sizing, alignment, header capacity, resources, fuse,
and payload. Pinned postject `inject_into_pe` returns an error when
`!binary->has_resources()`; resource-less synthetics are not a postject
contract. LIEF's PE builder rebuilds `.rsrc` at FileAlignment 0x200, so
non-default FileAlignment synthetics are not used to claim PointerToRawData
semantics the pinned tool does not implement. Official `node.exe` carries an
Authenticode certificate overlay; restoring that certificate after mutation
is not overlay preservation (B55/B56). After injection:

- `SizeOfImage` must cover the last section end and be a multiple of
  SectionAlignment; it must grow when a new section extends the image
- a new section header must fit in `SizeOfHeaders` without colliding with
  section raw data; header space must be checked, not assumed
- PointerToRawData / VirtualAddress must be aligned to the image's
  FileAlignment and SectionAlignment; official Node FileAlignment 0x200 and
  SectionAlignment 0x1000 must be preserved rather than rewritten
- the Security certificate table must be empty (file offset 0, size 0); the
  pre-injection Authenticode overlay must not be re-appended
- original resource directory entries must survive; RT_RCDATA
  `NODE_SEA_BLOB` must be independently located and hash-matched; the SEA
  fuse must be `:1`

Successful container validation is not Windows runtime verification (B45).
Matching-host Windows distribution requires re-signing after injection.

### B52 — Runtime stays dependency-free; official Node/tool caches stay uncommitted; fixtures never attest platform verification

The downloadable runtime still has no `package.json` / npm dependency and
keeps the frozen stdio `jobsss` MCP contract. Official Node archives,
extracted executables, generated release binaries, and tool caches must
not be committed. linux-x64 / linux-arm64 genuine official Node injection
must keep ELF identity, flip the fuse, and carry `NODE_SEA_BLOB` as a
PT_NOTE. macOS and Windows remain `unverified` until matching-host
execution; fixture or cross-build success is not platform verification.
B30–B32 current-host Linux verification remains required.

### B53 — Both reports are finalized with the actual frozen-command count and PASS before verdict

`PRODUCTIZATION_REVIEW.md` and `RELEASE_REPORT.md` must each record the
live frozen-command `# tests N` `# pass N` `# fail 0` counts, contain a
PASS verdict, and must not leave the reviewer verdict pending. N is the
number of `test(` calls in the frozen twelve-file command (B1–B64). Both
files must record independent native-format validation, genuine official
Node inputs, Mach-O load-command/linkedit/code-signature evidence, PE
`SizeOfImage` evidence, pinned postject / `packaging.lock.json` identity,
intermediate SHAs `ba2123ef5f6f24bcf6ae994a125b67501b970785` and
`8b2db255e7868397d336f8b015c489552b84bf0e`, and that the final corrective
SHA is supplied in the final response. Reports are finalized during the
eventual PASS review; emitting PASS while either report is pending or
carries a stale count is a fail.

### B54 — Empty-cache pinned postject acquisition and current-host release

A genuine empty `JOBSSS_NATIVE_CACHE` (no postject tarball, extracted API,
or inject driver) must still allow:

```bash
./bin/jobsss release --out <absdir> --target current-host
```

to exit `0`. The build must download the lock-pinned postject 1.0.0-alpha.6
tarball from `https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`
into that temporary cache only, verify SHA-256
`d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92` before
extraction or injection, write no tool-cache or release artifacts into the
plugin tree, and produce `bin/jobsss`. Pre-populated caches are not a
substitute. Treating a download `Promise` as bytes, skipping checksum
verification, or mutating before the pinned tool is acquired is a fail.
Missing tools, checksum mismatch, or unavailable network must fail clearly
and non-destructively. Successful current-host execution remains Linux
verification only (B30–B32 / B45).

### B55 — No custom PE mutation after the pinned injector

`src/packaging.js` must not implement `restorePeOverlay`, must not
`Buffer.concat` the pre-injection overlay onto postject output, and must
not `writeU32` the PE Security directory after injection. Native mutation
for PE must be exactly the pinned postject output. Custom code may
identify/classify PE overlay and signing state, verify checksums, and
validate outputs read-only. Patching postject's `build_overlay(false)`
behavior with an ad hoc rewriter is a fail.

### B56 — Official signed PE becomes unsigned; Authenticode is not restored

Checksum-pinned official win-x64 `node.exe` is Authenticode-signed: the
trailing overlay length equals the Security certificate-table size.
After pinned injection the Security directory file offset and size must
both be 0, and the original certificate bytes must not be re-appended.
Pinned pefile 2024.8.26 must independently confirm those Security/
overlay facts plus `SizeOfImage`, FileAlignment 0x200, SectionAlignment
0x1000, and `NODE_SEA_BLOB`. Restoring a pre-injection certificate is an
invalid signature, not overlay preservation. Re-signing is a subsequent
matching-host Windows step, not container preservation, and does not
make win-x64 runtime-verified.

### B57 — Unsupported non-certificate overlay/signing state fails before mutation

A PE whose trailing overlay is not exactly the Security certificate table
(including official `node.exe` plus extra non-certificate bytes) must fail
clearly with a signing/overlay/unsupported error before pinned postject is
acquired or run. The input executable bytes must remain untouched. Missing
tools are not a substitute diagnosis: an empty `JOBSSS_NATIVE_CACHE` must
still fail for overlay/signing, not download postject first.

### B58 — `release --node-binary` enforces the locked official executable checksum

`./bin/jobsss release --target <id> --node-binary <path>` must verify the
provided executable's SHA-256 against the lock entry for that target
before generating the SEA blob or invoking the injector. Same-format/
same-architecture bytes that do not match the locked `executableSha256`
must fail with a checksum/sha256/mismatch error and must not write a
launcher. Each locked official Node input must be accepted for its target.
Format/architecture checks remain required (B43/B45) and are not a
substitute for the checksum. Synthetic fixtures may still exercise
`injectSeaPayload` directly; the release CLI does not accept them as
`--node-binary`.

### B59 — Independent Mach-O/PE validation uses pinned external parsers and records exact output

`src/packaging.lock.json` must pin independently maintained parsers
pefile 2024.8.26, macholib 1.16.3, and altgraph 0.17.4 with exact wheel
URLs, SHA-256 digests, sources, and build/test-only status. Tests download
those wheels into temporary cache only, reject checksum drift, and invoke
them via isolated `PYTHONPATH` without installing globally or adding a
runtime dependency. They must not import `src/packaging.js` or the
synthetic-fixture generator. Exact JSON output is recorded for official
injected darwin-arm64 (no `LC_CODE_SIGNATURE`, `NODE_SEA` VM sizing,
`__LINKEDIT`) and win-x64 (Security directory 0/0, resources, alignments,
`SizeOfImage`). In-repository custom parsers are not the authoritative
official-output validator.

### B60 — Two fresh-process complete official-target release trees are byte-identical

For every locked official Node target (`linux-x64`, `linux-arm64`,
`darwin-x64`, `darwin-arm64`, `win-x64`), `./bin/jobsss release --out
<a|b> --target <id> --node-binary <official executable>` must be invoked
twice in separate child processes and the complete output trees compared
recursively, including both `release-manifest.json` copies and launcher
bytes. In-process `injectSeaPayload` memoization is not a substitute.
macOS and Windows remain `unverified` (B45). Current-host restricted-PATH
runtime proof remains B30–B32.

### B61 — Pinned macholib independently validates both official Darwin architectures with complete canonical JSON

Pinned macholib 1.16.3 / altgraph 0.17.4, orchestrated only by test-only
code that must not import `src/packaging.js`, `jobsss-native-format.mjs`,
or synthetic fixture generators, must independently inspect genuine
checksum-pinned official Node `darwin-x64` and `darwin-arm64` outputs
after injection. Each architecture is a first-class case; validating only
`darwin-arm64` is a fail. Canonical JSON for each target must record:

- format `macho` and architecture
- `NODE_SEA` segment and `NODE_SEA_BLOB` section
- exact injected payload length and SHA-256
- fuse present and enabled (`:1`)
- `hasCodeSignature` false (no stale `LC_CODE_SIGNATURE`)
- every file-offset-bearing load command in bounds
- relocated `__LINKEDIT` offsets/sizes relative to the official input
- `LC_SYMTAB` `symoff` / `nsyms` / `stroff` / `strsize`
- `LC_DYSYMTAB` offsets where present
- exports, chained-fixups, function-starts, data-in-code, and related
  linkedit offsets where present
- segment ordering, file ranges, alignment, and non-overlap

In-repository custom parsers are not a substitute for these fields.

### B62 — Pinned pefile independently validates official win-x64 before and after injection

Pinned pefile 2024.8.26 must independently inspect genuine checksum-pinned
official Windows x64 `node.exe` **before** and **after** injection. Canonical
JSON must record:

- format `pe` and architecture `x64`
- FileAlignment 0x200 and SectionAlignment 0x1000
- complete pre/post resource inventories with type, name, and language
- preservation of every original resource
- addition of exactly one `NODE_SEA_BLOB` resource
- exact injected payload length and SHA-256
- fuse present and enabled (`:1`)
- Security directory file offset 0 and size 0 after injection
- certificate bytes not restored (`certificateRestored` false)
- all section raw and virtual ranges in bounds
- independently computed `SizeOfImage` covering the aligned end of every
  section and equal to the final header `SizeOfImage`

Unsupported non-certificate overlays remain rejected before mutation (B57).
Custom in-repo PE parsers and fixture generators are not a substitute.

### B63 — Both reports record complete canonical validator JSON for all four cases

`PRODUCTIZATION_REVIEW.md` and `RELEASE_REPORT.md` must each contain the
complete canonical validator JSON objects for `darwin-x64`, `darwin-arm64`,
`win-x64-before`, and `win-x64-after`, including payload hashes, fuse state,
linkedit/resource inventories, and `computedSizeOfImage`. Selected prose
fragments are a fail. Both reports must also record exact commands,
validator identities/versions/URLs/SHA-256, official Node input hashes,
output executable hashes, and the unsupported non-certificate overlay
rejection. Large binaries and caches remain uncommitted.

### B64 — Release metadata, published-base identity, and one authoritative version

`compat/matrix.json` must not claim that the original Windows Authenticode
overlay is preserved as a trailing overlay. It must describe certificate
removal / cleared Security directory / unsigned output. `plugin.json`
version, `src/cli.js` runtime version, and `src/release.js` manifest
version must be the same authoritative version, and both reports must
record it. Both reports must identify published base
`803135995782e36cbf9427ac903a2e26d2952383` and must not claim that SHA is
unpushed or that `origin/main` is behind. The new final corrective SHA is
supplied in the final response.

---

## Verdict

**Pass** only if the frozen validation command exits `0` and B1–B64 hold on
inspected files, subprocess output, the current-host release artifact, and
the independently validated official-Node Mach-O/PE containers.

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
cbad53a2de4fbb9a47b16a463cd578be84e4d1c11ff381658a7ccf6dfe08c57b  tests/jobsss-integrity.test.mjs
```

SHA-256 of reviewer-owned productization files. Implementers must not
change these files. B1–B29 hashes above are unchanged.

```
cf1a56d7d652448d5d78c624b73f362e5a242aadbbe92cf5af2b72fdb76243b9  tests/jobsss-release.test.mjs
501130f7722f697d4d90ec0ff5ea46e40fd9eb293d35d04c9603cf552af0255c  tests/jobsss-adapters.test.mjs
4f30ba40ccd86ad6fc7548fabffb63cb1267b4ac6dc01595ef34944588953179  tests/jobsss-authority.test.mjs
fa7453057e9c9573d3de22a2855951b97957c73016083fcce89f1bb6d773c3e6  tests/helpers/jobsss-productization.mjs
```

SHA-256 of reviewer-owned cross-platform remediation files. Implementers must
not change these files. B1–B41 hashes above are unchanged. B43 injection-input
correction below updates only these two files. Additive B55–B60 additionally
update `tests/jobsss-cross-platform.test.mjs` so release `--node-binary` uses
locked official inputs; helper `jobsss-cross-platform.mjs` is unchanged.

```
e144be696f71d60666267e93490c7a497d75dd7a0482846bee0927fa9356dcf3  tests/jobsss-cross-platform.test.mjs
73f34d084ba6f60d6552a7f29221557d9fe1abd005ae4991d7561f6feaef308f  tests/helpers/jobsss-cross-platform.mjs
```

SHA-256 of reviewer-owned native-remediation files. Implementers must not
change these files. B1–B47 hashes above are unchanged except the two
cross-platform files listed immediately above. Additive B54 updated
`tests/jobsss-native-remediation.test.mjs`; additive B55–B60 update that file
plus `tests/helpers/jobsss-native-format.mjs` and add
`tests/helpers/jobsss-native-validators.mjs`. `jobsss-native-inputs.mjs` is
unchanged.

```
71112bedbc1ba2f11e974fbefdbc2e727159f6ad3ec0466293f978e658240f2c  tests/jobsss-native-remediation.test.mjs
7a57942827f257858e63d059432d25cbfe2814e711c23f60275b28f31386cc6e  tests/helpers/jobsss-native-format.mjs
045f88f6b07a11b99c9b3fd63a471bde13d5c32e59e77166f8170d9317e9cffe  tests/helpers/jobsss-native-inputs.mjs
836bc661b7d80be8ae4772e44cb2f016924d5de3250cdd6af1050b4448f67f9b  tests/helpers/jobsss-native-validators.mjs
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
- 2026-08-28T04:14:19Z — **B26/B27 iteration-2 strengthening**. Reason:
  genuine documented contract omissions against committed HEAD `bc5c86c`.
  An independent completion audit, and a reviewer live MCP probe, showed:
  (1) `skip_job`/`archive_job` cancel open tasks, but `applications_plan`
  still concatenates active `human review` / `verify proof-grounded materials`
  next actions for those terminal records; (2) `commitStore` redacts
  projections but writes canonical `store.json` via raw `JSON.stringify`, so
  a synthetic `sk-` / environment secret ingested into job content persists
  in `store.json` while ordinary resume/job content remains. B1–B25 and
  B28–B29 stayed green. Change: preserved B1–B25, B28–B29, and every existing
  B26/B27 requirement; appended terminal skipped/archived next-action
  coherence to B26 and every-durable-write secret redaction of `store.json`
  to B27; strengthened `tests/jobsss-integrity.test.mjs`; updated only that
  file's frozen hash from
  `278b1773eb55e4be89d82da2727c934959efca2c0b7c19818ef4e0ec57006d04` to
  `b47dd8c003decfb58f7874819e696ea6e8e1c72d5c4243910defc98bb6605b88`.
  Recorded today's failing baseline (`# tests 31` `# pass 29` `# fail 2`,
  exit `1`) against committed HEAD before any product correction. Not done
  to make tests green.
- 2026-08-28T04:27:49Z — **B28 iteration-3 strengthening**. Reason: genuine
  documented contract omission against committed HEAD `30047e4`. An independent
  completion audit, and a reviewer live MCP probe, showed `draft_interview_story`
  grounds fields by normalized substring inclusion (`entry.text.includes(normalizedField)`)
  and `fieldEvidence` stores only `matchedProofPointIds` with no verbatim proof
  summary/quote. Sending every STAR field as `30%`, or title `Led discovery` with
  the rest exact, returned `grounded=true` and
  `groundingStatus=exact_proof_text_needs_human_verification` for proof
  `Led discovery with educators and operations teams to prioritize an AI-assisted
  learning workflow that reduced manual review time by 30%.`. Existing B28
  covered fabricated `$10M`/`400%` title/reflection and partial invented STAR
  text, so that hole stayed green (integrity file `# tests 4` `# pass 4`,
  B28 passed, before this strengthening). Change: preserved B1–B27, B29, and every existing B28
  requirement; appended substring-only rejection, normalized equality to complete
  owned proof wording, exact `fieldEvidence` quotes, and cite-none for unsupported
  fields; strengthened `tests/jobsss-integrity.test.mjs`; updated only that file's
  frozen hash from
  `b47dd8c003decfb58f7874819e696ea6e8e1c72d5c4243910defc98bb6605b88` to
  `5e465de4f6eb134780c17da09c259cb270605f5f3b4c421276253892a26bd750`.
  Recorded today's failing baseline (`# tests 31` `# pass 30` `# fail 1`,
  exit `1`) against committed HEAD before any product correction. Not done
  to make tests green.
- 2026-08-28T04:34:10Z — **B28 restart field-targeting correction**. Reason:
  genuine new-test defect, not missing product behavior. After product
  implemented normalized equality and exact `fieldEvidence` quotes, running
  integrity failed at restart because the loop selected any story whose blob
  contains `$10M`/`400%`, including the partial-action story whose
  title/reflection are exact owned-proof wording, then unconditionally demanded
  title/reflection cite none. That contradicts B28: unsupported/fabricated
  fields cite none; exact fields record exact evidence. Evidence before this
  correction: `node --test --test-concurrency=1 tests/jobsss-integrity.test.mjs`
  exit `1`, `# tests 4` `# pass 3` `# fail 1`, assertion `restart fabricated
  title must cite no proofPointId` on a grounded exact title quote of the 30%
  proof. Change: preserved B1–B27, B29, substring checks, and every existing
  B28 requirement; retargeted only the restart `$10M`/`400%` assertions so the
  fabricated title/reflection story checks title/reflection, the partial-action
  story checks action, and exact fields retain exact evidence; updated only
  `tests/jobsss-integrity.test.mjs` frozen hash from
  `5e465de4f6eb134780c17da09c259cb270605f5f3b4c421276253892a26bd750` to
  `cbad53a2de4fbb9a47b16a463cd578be84e4d1c11ff381658a7ccf6dfe08c57b`. After
  correction, integrity `# tests 4` `# pass 4` and frozen command `# tests 31`
  `# pass 31`, exit `0`. Not done to make tests green by weakening B28.

- 2026-08-31T19:49:15Z — **B30–B41 productization Gate 0 extension**. Reason:
  the confirmed JobSSS productization goal requires a deterministic portable
  release, current-host standalone MCP with Node and JobOS absent from PATH,
  PLUGIN_DATA restart persistence from that artifact, canonical skill/tool
  equivalence across native/generated adapters, isolated client probes with
  truthful unverified reporting, adapters without business logic, trusted
  local human decisions (proof verify; artifact approve/reject; contact
  approve/suppress; story verify/retire; debrief record/correct; outreach
  sent/outcome; externally observed application status), exact
  id/revision/content-hash binding, typed stale conflict, MCP authority
  forgery rejection, audit/projection agreement, and verified/unverified
  documentation. None of B1–B29 freeze those contracts. Change: preserved
  B1–B29 and every existing test/hash; appended B30–B41 plus
  `tests/jobsss-release.test.mjs`, `tests/jobsss-adapters.test.mjs`,
  `tests/jobsss-authority.test.mjs`, and
  `tests/helpers/jobsss-productization.mjs`; recorded today's failing
  baseline (`# tests 43` `# pass 31` `# fail 12`, exit `1`) against
  committed HEAD `c47c557` before any product correction. Not done to make
  tests green.
- 2026-08-31T21:44:35Z — **B34 snapshot retarget**. Reason: genuine
  test-vs-prose defect, not missing product behavior. B34 prose requires
  isolated compat-probes not to mutate real client profiles under the host
  home. The frozen helper snapshotted directory `mtimeMs` of whole install
  trees including `~/.hermes`. On this host the ambient Hermes gateway cron
  rewrites `~/.hermes/profiles/coder/cron/jobs.json` about every 2.5s with
  zero JobSSS activity, so the whole-directory mtime assertion cannot pass
  regardless of probe isolation. Independent evidence before this
  correction: frozen command `# tests 43` `# pass 42` `# fail 1`, exit `1`,
  assertion `real client state changed: /home/logani/.hermes` with size
  unchanged at 4096; passive control 3/3 intervals changed `~/.hermes`
  mtime with no JobSSS; `strace -f` of `./bin/jobsss compat-probe --client
  hermes` recorded 0 write-mode opens on real `~/.hermes`, 0 `shallow.lock`
  ops, 0 `git fetch` execs, and a read-only `git ls-remote` path. Change:
  preserved B1–B33, B35–B41, B34 prose, adapter tests, and every existing
  honesty/isolation requirement; retargeted only
  `snapshotClientState` / `assertClientStateUnchanged` to content-hash
  probe-touchable profile/config files (`config.yaml` / `config.toml` /
  `mcp.json` / `settings.json` and the same under `agent/` plus
  `profiles/<id>/`) instead of ambient install-tree directory mtime;
  updated only `tests/helpers/jobsss-productization.mjs` frozen hash from
  `3b71c3c7704ff7f0901a7a5473ad123a6e3a3ae876bd2287b6dca616531213f9` to
  `590226460efdb2fabeb0cd4e05f5ce510e9156535320ccdf1b44bcad77cb122e`. Not
  done to make tests green by deleting or weakening B34.
- 2026-09-01T05:52:56Z — **B30 iteration-6 complete-release strengthening**.
  Reason: genuine documented benchmark omission, not missing product
  behavior to be papered over. Default-agent final-artifact inspection
  found `.tmp/jobsss-productization/out-a/current-host/bin/jobsss` contains
  `/home/logani/projects/jobsss` (12 printable hits) and `tests/fixtures`
  source-checkout strings (`FROZEN_FIXTURES` realpath of
  `tests/fixtures/profile-resume.md` and `tests/fixtures/job-posting.md`,
  plus `__srcDir: "/home/logani/projects/jobsss/src"` and embedded
  `sea-entry.cjs` scratch path). Both `release-manifest.json` copies
  (output root and current-host tree) contain absolute workspace, `--out`,
  Node binary (`/home/logani/.hermes/node/bin/node`), and scratch
  `entryPath` values. Repeated-manifest SHA-256 differs
  (`56b49a1832d8e46aa132abb55033322dba6c3570f0ae2829baf216360ec44497` vs
  `25a71a248b2b6eaf58cb59cbf3e6e78467da3f218a5cafd558babffa801d108d`)
  because `generatedAt` (`2026-08-31T20:44:13.429Z` vs
  `2026-08-31T20:48:12.365Z`) and those paths differ. `linux-x64` is
  labeled `verified` with `artifactSha256: null`. Old B30 compared only
  four core files, so that hole stayed green. Independent helper probe
  against today's `out-a`/`out-b` before freeze: four-file identity PASS;
  no-build-path-leakage FAIL; no-checkout-dependency FAIL;
  portable-evidence FAIL; complete-determinism FAIL. Focused command
  after strengthening, against today's product, before any product
  correction: `node --test --test-concurrency=1 --test-name-pattern='B30
  deterministic portable current-host release layout'
  tests/jobsss-release.test.mjs` exit `1`, `# tests 1` `# pass 0`
  `# fail 1`, `duration_ms 2976.112161`, assertion `no release file or
  printable binary string may contain build-user/home/workspace/source/scratch/output paths`
  on `current-host/bin/jobsss` (`/home/logani/projects/jobsss`,
  `tests/fixtures`, `.tmp/jobsss-productization`) and both manifest
  copies (absolute `--out` and `entryPath`). Change: preserved B1–B29,
  B31–B41, every existing B30 assertion (including four-file identity),
  adapter/authority tests, and every existing test/hash except the two
  files below; appended complete-tree identity of both manifest copies,
  portable/relative evidence, truthful verified artifact hashes, and
  no-checkout/`tests/fixtures` runtime dependency to B30 prose and
  `tests/jobsss-release.test.mjs` / `tests/helpers/jobsss-productization.mjs`;
  updated those frozen hashes from
  `d697f787acb0015f4605f11527ab0a79e220fe331ebf3dc7f9edd649752e2016` to
  `cf1a56d7d652448d5d78c624b73f362e5a242aadbbe92cf5af2b72fdb76243b9`
  (release) and from
  `590226460efdb2fabeb0cd4e05f5ce510e9156535320ccdf1b44bcad77cb122e` to
  `fa7453057e9c9573d3de22a2855951b97957c73016083fcce89f1bb6d773c3e6`
  (helper). Not done to make tests green.
- 2026-09-02T20:56:01Z — **B42–B47 cross-platform remediation Gate 0 extension**.
  Reason: independent-auditor rejection of HEAD `ba2123e` plus the revised
  focused goal require inspectable executable deterministic Linux ELF, macOS
  Mach-O, and Windows PE build definitions, truthful unverified labels for
  unavailable hosts, and inspectable `PRODUCTIZATION_REVIEW.md` /
  `RELEASE_REPORT.md` section/identity coverage. None of B1–B41 freeze those
  contracts. Today's product still has only current-host 64-bit ELF
  `injectSeaNote`; `release --target darwin-arm64` / `win-x64` exit `1` with
  `only current-host is buildable`; `--node-binary` is an unknown option;
  Mach-O/PE injection is prose; both required reports are absent. Change:
  preserved B1–B41 and every existing test/hash; appended B42–B47 plus
  `tests/jobsss-cross-platform.test.mjs` and
  `tests/helpers/jobsss-cross-platform.mjs`; recorded today's failing
  baseline (`# tests 49` `# pass 43` `# fail 6`, exit `1`,
  `duration_ms 29104.753968`) against committed HEAD `ba2123e` before any
  product correction. Synthetic fixtures exercise parsers/injectors only and
  must never attest macOS or Windows runtime support. Not done to make tests
  green.
- 2026-09-02T23:55:24Z — **B48–B53 native-remediation Gate 0 extension**.
  Reason: independent-auditor rejection of HEAD `8b2db25` plus the revised
  focused goal require replacing unsafe custom Mach-O/PE mutation with
  checksum-pinned Node-supported SEA injection (postject), proving
  container correctness against genuine official Node executables and an
  independent validator, and finalizing both reports with the actual
  frozen-command count/PASS. None of B1–B47 freeze those contracts. Today's
  `injectMacho` leaves LC_SYMTAB/LC_DYSYMTAB/dyld-info/function-starts/
  code-signature offsets stale and emits NODE_SEA with vmsize 0; today's
  `injectPe` leaves SizeOfImage stale, assumes section-header space and
  0x200/0x1000 alignment, destroys overlays, and replaces resources.
  Cross-platform tests still parse synthetic self-generated fixtures.
  Change: preserved B1–B47 and every existing test/hash; additionally
  strengthened B46/B47 report-finalization prose; appended B48–B53 plus
  `tests/jobsss-native-remediation.test.mjs`,
  `tests/helpers/jobsss-native-format.mjs`, and
  `tests/helpers/jobsss-native-inputs.mjs`; recorded today's failing
  baseline (`# tests 55` `# pass 50` `# fail 5`, exit `1`,
  `duration_ms 40048.300212`) against committed HEAD `8b2db25` before any
  product correction. Official Node archives stay in temporary cache only.
  Synthetic fixtures and the production parser must never attest macOS or
  Windows runtime support. Not done to make tests green.
- 2026-09-03T00:45:57Z — **B43/B50/B51 genuine postject/Node-SEA contradictions**.
  Reason: independent confirmation against pinned postject 1.0.0-alpha.6
  `src/postject.cpp`, Node.js v22.22.3 SEA docs, checksum-pinned official
  Node v22.22.3 darwin/win executables (SHA-256 match lock), byte-level
  relocated content, and `tests/helpers/jobsss-native-format.mjs`.
  B50 expected LC_SYMTAB/dyld/linkedit/code-signature offsets to move by
  the sizeofcmds delta (136) and to preserve LC_CODE_SIGNATURE. Pinned
  postject/LIEF inserts NODE_SEA page-aligned (darwin-arm64 +16384,
  darwin-x64 +4096) so remaining offsets point at relocated __LINKEDIT
  content, not at orig+sizeofcmds, and calls `Binary::remove_signature()`
  because "It will need to be signed again anyway"; Node SEA docs require
  `codesign --remove-signature` before inject and `codesign --sign -` after.
  B43/B44/B45/B51 demanded postject accept resource-less synthetic PE
  fixtures; `inject_into_pe` returns kError when `!has_resources()`. Official
  win-x64 `node.exe` injection already preserves SizeOfImage (89866240 →
  90009600), 0x200/0x1000 alignment, original resources, overlay (via the
  product overlay restore of the Authenticode certificate table), fuse, and
  payload hash. Tiny synthetic ELF fixtures flip the fuse but emit no
  PT_NOTE because LIEF cannot relocate that PHDR table. Change: preserved
  B1–B42, B44–B49, B52 and every existing auditor invariant (SizeOfImage,
  header space, official alignment, resources, overlay, fuse, payload hash,
  determinism, truthful unverified). Corrected B43 injection inputs to
  official Node ELF and postject-compatible resource-bearing PE; corrected
  B50 to content-based relocated offsets, nonzero NODE_SEA VM/no overlap,
  and documented signature removal; replaced B51 resource-less / non-default
  FileAlignment synthetic PE legs with official Node plus postject-compatible
  independently sourced PEs. Not done to make tests green.
- 2026-09-03T01:41:35Z — **B54 empty-cache pinned postject acquisition**. Reason:
  independent reproduction of a genuine empty `JOBSSS_NATIVE_CACHE` current-host
  release failure after the prior native-remediation review. Today's
  `acquirePostject` calls `httpsDownload()` and passes the returned Promise into
  `verifyPinnedChecksum` (`Buffer.from`), so `./bin/jobsss release --target
  current-host` exits `1` with `ERR_INVALID_ARG_TYPE` / `Received an instance of
  Promise` whenever the cache is empty. Pre-populated caches hid the defect.
  Change: preserved B1–B53 and every existing test/hash except the additive
  B54 test in `tests/jobsss-native-remediation.test.mjs`; appended B54 empty-cache
  current-host acquisition/checksum/no-plugin-tree-write contract; recorded
  today's failing baseline (`# tests 1` `# pass 0` `# fail 1`, exit `1`,
  `duration_ms 601.945467`) from the focused B54 command plus the independent
  CLI reproduction. Frozen twelve-file live count is now 56. Reports were not
  edited. Not done to make tests green.
- 2026-09-03T02:20:00Z — **B51 Authenticode correction and B55–B60 auditor native-safety extension**.
  Reason: independent completion auditor rejected HEAD `0b962bee448133eff9db6c953894e4ba360db79e`
  for five remaining product gaps: `restorePeOverlay` custom PE mutation;
  restored invalid Authenticode; `release --node-binary` format/arch-only;
  missing fresh-process official-target double builds; in-repo parser colocated
  with fixture generation as the “independent” validator. B51’s prior overlay-
  preservation requirement contradicted pinned postject `build_overlay(false)`,
  Node SEA signing flow, and Authenticode (certificate authenticates pre-inject
  bytes). Change: preserved B1–B50 and B52–B54; corrected B51 to require empty
  Security directory and no certificate restore while keeping SizeOfImage,
  alignment, header space, resources, fuse, and payload; strengthened B44/B45
  release `--node-binary` legs to locked official inputs without claiming macOS/
  Windows runtime verification; appended B55–B60 plus
  `tests/helpers/jobsss-native-validators.mjs`. Live focused failures against HEAD `0b962be`, not invented: B51/B55–B59 command `# tests 6` `# pass 0` `# fail 6`, exit `1`, `duration_ms 52277.796758` (B51/B56 Security offset 87095808; B55 `restorePeOverlay` present; B57 postject acquired before overlay reject; B58 mutated `--node-binary` exit 0; B59 lock missing pefile 2024.8.26). B60 `# tests 1` `# pass 1` `# fail 0`, `duration_ms 101891.397946`. Frozen twelve-file live count is now 62. Reports were not edited. Not done to make tests green.
- 2026-09-03T04:30:00Z — **B61–B64 independent-native evidence gaps on published 8031359**. Reason: independent completion auditor rejected published HEAD `803135995782e36cbf9427ac903a2e26d2952383` because reports omit complete canonical validator JSON; pinned macholib/pefile output does not independently prove payload/fuse, relocated Mach-O linkedit offsets, PE original-resource preservation, or computed `SizeOfImage` coverage (those remain in `jobsss-native-format.mjs`); B59 inspects only `darwin-arm64`; `compat/matrix.json` still claims the Authenticode overlay is preserved. Change: preserved B1–B60; appended additive B61–B64 in `tests/jobsss-native-remediation.test.mjs` and this file. Product files, `compat/matrix.json`, plugin/runtime versions, and both reports were not edited. Live focused command against published 8031359, not invented:

```bash
node --test --test-concurrency=1 --test-name-pattern='B61 |B62 |B63 |B64 ' tests/jobsss-native-remediation.test.mjs
```

`# tests 4` `# pass 0` `# fail 4`, exit `1`, `duration_ms 25390.068305`. Failures: B61 `doc.case` undefined vs `darwin-x64`; B62 `doc.case` undefined vs `win-x64-before`; B63 `PRODUCTIZATION_REVIEW.md` missing complete canonical JSON for `darwin-x64`; B64 `compat/matrix.json` win-x64 notes still say “Authenticode overlay preserved as a trailing overlay”. Expected report-finalization lag, not a weakened check:

```bash
node --test --test-concurrency=1 --test-name-pattern='B53 ' tests/jobsss-native-remediation.test.mjs
```

`# tests 1` `# pass 0` `# fail 1`, exit `1`, `duration_ms 104.417898`, `PRODUCTIZATION_REVIEW.md # tests must be the live frozen-command count 66, not a stale 62`. Frozen twelve-file live count is now 66. Not done to make tests green.
