# JobSSS Productization Review

Reviewed tree identity: committed HEAD
`ba2123ef5f6f24bcf6ae994a125b67501b970785` plus the uncommitted
cross-platform remediation (`src/packaging.js`, delegated
`src/sea-build.js` / `src/release.js`, truthful `compat/matrix.json`,
`RELEASE_REPORT.md`, reviewer-owned B42–B47). Node v22.22.3, host
linux/x64. No staged files. No new commits. The final corrective SHA is
supplied in the final response and is not invented here.

**Fresh verdict: PASS**

Scope: this reviewer check is the first of three independent fresh
remediation reviews. It inspects the real worktree, runs the frozen
B1–B47 command, and repeats current-host release, path-scan,
copied-release restricted-PATH MCP, authority, adapter, and
cross-platform fixture probes. Product files were not edited. Frozen
B1–B41 and B42–B47 tests were not rewritten. `PRODUCTIZATION_REVIEW.md`
is the reviewer-authored B46 artifact.

## B1–B41

Frozen command before this file existed: 49 tests, 48 pass, 1 fail
(exit 1). The sole failure was B46 (`PRODUCTIZATION_REVIEW.md` missing).
B1–B41 all passed on inspected files and live subprocesses:

- B1–B9: Agent Plugin / skill / secret-free `mcp.json` / bundled
  `./bin/jobsss` contract, standalone journey docs, human-only handoffs.
- B10–B13: real bundled MCP initialize/tools with JobOS absent, PLUGIN_DATA
  persistence, doctor-to-review journey, cross-profile isolation.
- B14–B25: lossless v1 store migration, lock/stale writes, staged intake,
  secret-safe projections, ownership, discovery/scoring, proof-grounded
  materials, restart-persistent pipeline, truthful send/submit blocks.
- B26–B29: save/skip/archive coherence, atomic redacted projections,
  interview-story equality grounding, requirement-extracting tailoring.
- B30–B32: deterministic portable current-host release; released
  `bin/jobsss` starts generic stdio MCP with Node and JobOS absent;
  PLUGIN_DATA restart persistence.
- B33–B35 / B41: canonical skill/tool equivalence, isolated client
  probes, adapters without business logic, verified/unverified docs.
- B36–B40: trusted-local `./bin/jobsss decide` is the only human
  authority surface; exact id/revision/content-hash binding; typed
  stale conflict; MCP forgery rejection; audit/projection agreement.

## Cross-platform build definitions

`src/packaging.js` is the inspectable executable definition entry. It
exports `identifyExecutable` and `injectSeaPayload`, declares
`linux-x64` / `linux-arm64` (ELF PT_NOTE `NODE_SEA_BLOB`),
`darwin-x64` / `darwin-arm64` (Mach-O `NODE_SEA` / `NODE_SEA_BLOB`),
and `win-x64` (PE `RT_RCDATA` `NODE_SEA_BLOB`), and does not import
MCP/domain/authority/store/scoring/workflow/discovery/relationship/
compat-probe modules. B42–B45 passed in-suite. Independent CLI probes:

- `./bin/jobsss release --out <tmp> --target darwin-arm64` exit 1:
  `unavailable on this host (linux/x64); ... remains unverified and is
  not platform verification`.
- `./bin/jobsss release --out <tmp> --target linux-x64 --node-binary
  <Mach-O arm64 fixture>` exit 1: `mismatched --node-binary: a
  macho/arm64 executable was provided but target linux-x64 requires a
  elf/x64 executable`.
- `./bin/jobsss release --out <tmp> --target darwin-arm64 --node-binary
  <Mach-O arm64 fixture>` exit 0 twice; `file` reports
  `Mach-O 64-bit arm64 executable`; launcher sha256
  `c8bb28323a12ad8dad8782b6e0ec8aed8409def9beeaa6f6ab58c91204259838`
  twice; manifest labels darwin-arm64 **unverified**.
- `./bin/jobsss release --out <tmp> --target win-x64 --node-binary
  <PE32+ x64 fixture>` exit 0; writes `bin/jobsss.exe`; `file` reports
  `PE32+ executable (console) x86-64, for MS Windows`; manifest labels
  win-x64 **unverified**.

Fixture success is definition integrity, never platform runtime
verification.

## Current-host restricted-PATH release evidence

Two clean `./bin/jobsss release --out <a|b> --target current-host`
builds both exited 0. Complete `--out` trees were byte-identical
(11 files). Released `bin/jobsss` sha256
`a9fba48efac887759af1b3a87e49beef3a7a7ce8ec738d57e41713c480ff44c8`.
Release-manifest statuses: current-host **verified** (same artifact
SHA), linux-x64 **verified** (byte-identical host artifact),
linux-arm64 / darwin-x64 / darwin-arm64 / win-x64 **unverified**.
Helper path-leakage and extra scans for `/home/logani`, `/Users/`,
`projects/jobsss`, `jobsss-productization`, `tests/fixtures`, and
`/tmp/tmp.` returned 0 hits in the release trees. The only `/home/`
strings inside the binary are the Node distribution's inherent
`/home/iojs/build/ws/...` OpenSSL/V8 build paths.

Copied the current-host plugin tree to a fresh temp path and spawned
`bin/jobsss mcp --data <temp PLUGIN_DATA>` with PATH =
`node`/`jobos` traps + `/usr/bin` + `/bin` only:

- initialize OK (`protocolVersion 2024-11-05`)
- `tools/list` 45 tools including doctor/start/create_profile/import_job/list_jobs
- doctor and start OK
- start → create_profile → import_job → restarted `list_jobs` still listed
  `job_789b05a027e75fdf` for profile `fresh-review-persist`
- `PLUGIN_DATA/store.json` persisted
- node trap and jobos trap never fired
- no writes into the copied release tree

## Adapter behavior

Isolated `./bin/jobsss compat-probe --client <pi|omp|codex|hermes|claude>
--config-dir <temp> --plugin-root <plugin>` all exited 0. Probe JSON
matched `compat/matrix.json`:

| Client | Probe status | Matrix status |
| --- | --- | --- |
| pi | unverified | unverified |
| omp | unverified | unverified |
| codex | unverified | unverified |
| hermes | verified (runtime `jobsss`, 45 tools) | verified |
| claude | verified (runtime `jobsss`, Connected) | verified |

Real client profile/config fingerprints under the host home were
unchanged. Generated adapters remain thin pointers; B33/B35/B41 passed.

## Human authority

Trusted-local `./bin/jobsss decide` remains the only surface that
completes enumerated human decisions (`proof.verify`, artifact
approve/reject, contact approve/suppress, story verify/retire, debrief
record/correct, outreach sent/outcome, `application.observe_status`).
B36–B40 passed: missing/unknown binding fails without persist; stale
revision or content-hash is a typed conflict; MCP
`list_decision_handoffs` / `create_decision_handoff` cannot forge
authority via tools, arguments, labels, or environment variables;
audit/projections agree after restart. JobSSS does not claim sent,
submitted, applied, approved, or interviewed.

## Commands/results

Exact commands/results recorded by this reviewer (cwd
`/home/logani/projects/jobsss`):

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
  tests/jobsss-cross-platform.test.mjs
```

Before this file: exit 1, `# tests 49` `# pass 48` `# fail 1`,
`duration_ms 24954.03428`. Only failure: B46 missing
`PRODUCTIZATION_REVIEW.md`. B1–B45 and B47 passed. Reviewer-owned
hashes matched the BENCHMARK.md frozen record (20/20). `git diff
--check` exit 0. No staged files.

Independent live probes (this review):

- two current-host releases: both exit 0; complete-tree SHA lists
  identical; artifact sha256 `a9fba48e…ff44c8`
- path scan: 0 user/workspace/source/scratch/output hits
- copied-release restricted-PATH MCP + restart: initialize 2024-11-05,
  45 tools, store persisted, traps never fired
- darwin-arm64 unavailable: exit 1 (unavailable/unverified)
- linux-x64 + Mach-O fixture: exit 1 (mismatched)
- darwin-arm64 fixture twice: exit 0, Mach-O arm64, sha256 `c8bb2832…`
  identical, status unverified
- win-x64 PE fixture: exit 0, `bin/jobsss.exe`, PE32+ x64, status
  unverified
- isolated client probes: pi/omp/codex unverified; hermes/claude
  verified; host client state unchanged

B47 `RELEASE_REPORT.md` contains every required section and the
reviewed baseline/intermediate commit
`ba2123ef5f6f24bcf6ae994a125b67501b970785`, plus the statement that
the final corrective SHA is supplied in the final response.

## Residual risks

- linux-arm64, darwin-x64, darwin-arm64, and win-x64 remain unverified
  on real matching hosts. Fixture validation proves definition
  determinism and format integrity only.
- Pi, OMP, and Codex stay unverified until an isolated live JobSSS
  tool exchange is proven without inventing a custom bridge or
  provider-authenticated session.
- The released Node SEA artifact contains the upstream Node
  distribution's inherent `/home/iojs/build/ws` strings. Those are not
  user/workspace paths and pass the frozen no-leak checks.
- Unavailable/mismatch CLI failures currently throw an Error stack
  rather than a quiet usage line; the frozen B45 keywords are present
  and the exit code is non-zero.
- `src/sea-build.js` file-header comments still describe the older
  ELF-only current-host path; runtime code delegates to
  `src/packaging.js`. Not a frozen-check failure.
- `RELEASE_REPORT.md` reviewer verdict remains pending by design
  (implementer-owned; this review does not edit product files).

Unverified hosts: linux-arm64, darwin-x64, darwin-arm64, win-x64.
Unverified clients: pi, omp, codex.
