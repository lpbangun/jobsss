# JobSSS Release Report

Reviewed baseline / intermediate commit: **ba2123ef5f6f24bcf6ae994a125b67501b970785**
(`Productize standalone JobSSS plugin`). The final corrective SHA is supplied in the final response.

## Release summary

JobSSS ships as a portable Agent Plugin whose source of truth is the
repository root (`plugin.json`, `mcp.json`, `skills/jobsss/`, `bin/jobsss`,
`src/`). `./bin/jobsss release --out <absdir> --target <id>` produces a
downloadable, deterministic, portable release tree per target:

- `current-host` — standalone `bin/jobsss` built from the host's own Node
  executable with a Node SEA payload, plus the canonical plugin core and
  justified metadata (`LICENSE`, `README.md`, `release-manifest.json`).
- `linux-x64`, `linux-arm64` — ELF64 little-endian definitions (PT_NOTE
  `NODE_SEA_BLOB` injection).
- `darwin-x64`, `darwin-arm64` — Mach-O 64 definitions (`NODE_SEA`
  `LC_SEGMENT_64` section injection).
- `win-x64` — PE32+ definition (RCDATA `NODE_SEA_BLOB` resource injection).

All native-format definitions live in `src/packaging.js`, separated from MCP
tools, domain behavior, scoring, authority, and client adapters, and are
selected explicitly by target rather than described as future prose. Two
clean builds of the same target are byte-identical for the complete `--out`
tree, and no release file or printable binary string contains build-user,
workspace, source-checkout, scratch, or output paths. (The only `/home/`
string inside the artifact is the Node distribution's own embedded OpenSSL
build path `/home/iojs/build/ws/...`, which is inherent to the base Node
binary and is not a user/workspace path.)

## Generic restricted-PATH MCP evidence

The current-host release artifact was exercised as a real subprocess with a
restricted `PATH` containing only `node` and `jobos` traps plus `/usr/bin`
and `/bin`:

- `initialize` succeeded (`protocolVersion 2024-11-05`),
- `tools/list` exposed the full journey tool set (`doctor`, `start`,
  `create_profile`, `import_job`, `list_jobs`, ...),
- `doctor` and `start` succeeded,
- `create_profile` (from the frozen fixture) and `import_job` followed by a
  restarted process against the same temporary `${PLUGIN_DATA}` still listed
  the imported job,
- the `node` trap and the `jobos` trap never executed, `JOBOS_HOME` stayed
  empty, and no state was written into the release plugin tree.

This is the frozen B31/B32 contract: the released `bin/jobsss` runs and
persists correctly with Node and JobOS absent from PATH.

## Client compatibility matrix

Recorded in `compat/matrix.json` and probed with isolated temporary
configuration only (temporary `HOME`, XDG roots, and per-client home
overrides; real client profiles are never read or written):

| Client | Status | Loading | Evidence |
| --- | --- | --- | --- |
| Pi | unverified | native skills, no native stdio MCP host | binary present; core documents no declarative stdio MCP host, so runtime proof would require a custom extension bridge |
| OMP | unverified | unknown | binary present; this build exposes no mcp/plugin subcommand and no documented Agent Plugins loader was established |
| Codex | unverified | native | isolated temporary `CODEX_HOME` registration is accepted, but a live tool exchange needs provider authentication (probe keys blank by design) |
| Hermes | verified | native | real isolated launch: `hermes mcp test jobsss` connected to the bundled runtime in a temporary `HERMES_HOME` and discovered its tools |
| Claude | verified | native | real isolated launch: `claude mcp add`/`mcp list` registered and health-checked the JobSSS stdio server as Connected under a temporary `CLAUDE_CONFIG_DIR` |

Adapted clients load the same canonical skill and bundled runtime through
thin generated pointers; inspection confirms adapters contain no business
logic (frozen B33–B35/B41).

## Human-authority behavior

Human-only decisions are completed only through the trusted local CLI
`./bin/jobsss decide --data ${PLUGIN_DATA}` with the exact entity id,
integer revision, and lowercase SHA-256 content hash. The frozen B36–B40
checks pass through real subprocesses:

- `proof.verify`, `artifact.approve|reject`, `contact.approve|suppress`,
  `story.verify|retire`, `debrief.record|correct`, `outreach.sent|outcome`,
  and `application.observe_status` all complete on the trusted local
  surface with a `trusted_local` / human actor;
- a missing `--content-hash` or `--revision`, an unknown `--id`, a stale
  revision, or a mismatched content hash fails with a typed stale conflict
  and persists nothing;
- MCP callers can only list/create non-authoritative decision handoffs
  (`list_decision_handoffs`, `create_decision_handoff`); authority forgery
  via tool names, arguments (`approved`, `humanApproved`, `authority=human`,
  `verifyProofs`), labels, or environment variables
  (`JOBSSS_AUTHORITY`, `JOBSSS_HUMAN_APPROVE`, `JOBSSS_APPROVE`) is
  rejected, and `update_application_status` still refuses
  `applied`/`submitted`;
- audit history and `PLUGIN_DATA` projections record the entity id, the
  action, and the trusted-local human actor, and agree after an MCP restart.

JobSSS never claims that it sent, submitted, applied, approved, or
interviewed; local preparation and human observation are labeled as such.

## Commands/results

Frozen validation command (from the repository root):

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

Final reviewed result after the reviewer authored `PRODUCTIZATION_REVIEW.md`:

- `# tests 49` · `# pass 49` · `# fail 0` · exit `0`
- B1–B47 all pass, including B42–B45 native ELF/Mach-O/PE definition,
  injection, determinism, canonical-layout, and truthful unverified-label
  checks; B46 inspectable reviewer evidence; and B47 this final release report.
- Fresh remediation reviewer check 1 independently reproduced the complete
  suite and live release evidence before returning PASS.

Cross-platform fixture exercises (deterministic definitions, not platform
verification):

```bash
./bin/jobsss release --out <tmp> --target darwin-arm64 --node-binary <synthetic Mach-O arm64>
# exit 0; <tmp>/darwin-arm64/bin/jobsss is Mach-O arm64; repeated build byte-identical; manifest marks darwin-arm64 unverified
./bin/jobsss release --out <tmp> --target win-x64 --node-binary <synthetic PE32+ x64>
# exit 0; <tmp>/win-x64/bin/jobsss.exe is PE32+ x64; manifest marks win-x64 unverified
./bin/jobsss release --out <tmp> --target darwin-arm64
# non-zero; explicit unavailable/unverified failure on this (linux/x64) host
./bin/jobsss release --out <tmp> --target linux-x64 --node-binary <synthetic Mach-O arm64>
# non-zero; mismatched native format/architecture failure
```

Current-host release evidence (this host, linux/x64, Node 22):

```bash
./bin/jobsss release --out <a> --target current-host
./bin/jobsss release --out <b> --target current-host
# both exit 0; complete --out trees byte-identical (full-tree SHA comparison)
# no build-user/home/workspace/scratch/output path leaks in any release file
```

## Reviewer verdict

**Fresh reviewer verdict: PASS (remediation check 1 of 3).**

The reviewer-authored `PRODUCTIZATION_REVIEW.md` records the inspected tree,
49/49 frozen checks, current-host restricted-PATH and restart evidence,
cross-platform definition evidence, adapter matrix, human-authority behavior,
and residual unverified hosts/clients. Per the explicit user authorization,
this report-only correction is followed by one final reviewer confirmation;
no product code or reviewer-owned benchmark file changed after the PASS.

## Deferred/unverified capabilities

- macOS (`darwin-x64`, `darwin-arm64`) and Windows (`win-x64`) release
  definitions are implemented and executable in `src/packaging.js`, but
  they are **unverified** (labeled `unverified` in every release manifest):
  they have been exercised only against synthetic native-format fixtures on
  Linux. Runtime support is claimable only after real execution on a
  matching macOS/Windows host.
- `linux-arm64` is likewise **unverified** until a real arm64 Linux host
  exercises it.
- Pi, OMP, and Codex client integrations are **unverified** per
  `compat/matrix.json`; Hermes and Claude are verified via isolated real
  launches.
- External sending, application submission, packet freezing, interview
  scheduling/attestation, browser automation, and provider delivery remain
  deferred/blocked and are never claimed.