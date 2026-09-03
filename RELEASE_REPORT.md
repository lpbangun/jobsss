# JobSSS Release Report

Reviewed baseline / intermediate commit: **ba2123ef5f6f24bcf6ae994a125b67501b970785**
(`Productize standalone JobSSS plugin`). Native-remediation intermediate
identity **8b2db255e7868397d336f8b015c489552b84bf0e**. Superseded pre-audit
SHA **0b962bee448133eff9db6c953894e4ba360db79e**. The final corrective SHA is supplied in the final response.

## Release summary

JobSSS ships as a portable Agent Plugin whose source of truth is the
repository root (`plugin.json`, `mcp.json`, `skills/jobsss/`, `bin/jobsss`,
`src/`). `./bin/jobsss release --out <absdir> --target <id>` produces a
downloadable, deterministic, portable release tree per target:

- `current-host` — standalone `bin/jobsss` built from the host's own Node
  executable with a Node SEA payload, plus the canonical plugin core and
  justified metadata (`LICENSE`, `README.md`, `release-manifest.json`).
- `linux-x64`, `linux-arm64` — ELF64 little-endian definitions (PT_NOTE
  `NODE_SEA_BLOB` injection via pinned postject).
- `darwin-x64`, `darwin-arm64` — Mach-O 64 definitions (`NODE_SEA`
  `LC_SEGMENT_64` section injection via pinned postject
  `--macho-segment-name NODE_SEA`).
- `win-x64` — PE32+ definition (RCDATA `NODE_SEA_BLOB` resource injection
  via pinned postject). Signed official `node.exe` is staged unsigned
  (Security certificate-table directory zeroed in a private copy; pinned
  postject drops the certificate bytes) and must be re-signed on a
  matching Windows host.

All native-format definitions live in `src/packaging.js`, separated from MCP
tools, domain behavior, scoring, authority, and client adapters, and are
selected explicitly by target. Injection tooling is pinned in
`src/packaging.lock.json`: postject 1.0.0-alpha.6 at
`https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`
(SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`)
and official Node v22.22.3 inputs (build-only, temporary cache only).
`--node-binary` accepts only the checksum-pinned official executable for
that target. Empty `JOBSSS_NATIVE_CACHE` downloads the exact postject
tarball over HTTPS via a synchronous build-only child, verifies the pinned
SHA-256 before extraction, and writes the cache outside the plugin tree.

Two clean current-host builds were byte-identical for the complete `--out`
tree (11 files). Released `bin/jobsss` sha256
`7ee8a77c3648aed8afa3912b4517f1e669790c7c3e694020ff05d665ac8eefe9`.
No release file or printable binary string contains build-user, workspace,
source-checkout, scratch, or output paths. (The only `/home/` string inside
the artifact is the Node distribution's own embedded OpenSSL build path
`/home/iojs/build/ws/...`.)

Independent native-format validation against checksum-pinned official Node
v22.22.3 darwin-arm64 / darwin-x64 / win-x64 / linux-x64 / linux-arm64
executables, using pinned pefile 2024.8.26 / macholib 1.16.3 / altgraph
0.17.4: Mach-O LC_SYMTAB / linkedit offsets point at relocated content
after page-aligned NODE_SEA insertion; LC_CODE_SIGNATURE is removed
(documented postject / Node SEA re-signing semantics); PE SizeOfImage is
90009600 covering the last section; original resources and FileAlignment
0x200 / SectionAlignment 0x1000 hold; Security directory fileOffset/size
are 0; overlaySize 0; fuse and payload hash hold. darwin-x64 /
darwin-arm64 / win-x64 remain unverified as runtime platforms.

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
  tests/jobsss-cross-platform.test.mjs \
  tests/jobsss-native-remediation.test.mjs
```

Final reviewed result after both reports record the live frozen-command
count:

- `# tests 62` · `# pass 62` · `# fail 0` · exit `0`
- B1–B60 all pass, including independent native-format validation,
  checksum-pinned official Node inputs, Mach-O LC_SYMTAB / linkedit /
  code-signature-removal evidence, PE SizeOfImage evidence with Security
  directory 0/0, pinned postject / `packaging.lock.json` identity, empty-
  cache acquisition, official checksum enforcement, and two fresh-process
  complete official-target release trees.

Current-host release evidence (this host, linux/x64, Node 22.22.3):

```bash
./bin/jobsss release --out <a> --target current-host
./bin/jobsss release --out <b> --target current-host
# both exit 0; complete --out trees byte-identical (11 files)
# bin/jobsss sha256 7ee8a77c3648aed8afa3912b4517f1e669790c7c3e694020ff05d665ac8eefe9
```

## Reviewer verdict

**Fresh reviewer verdict: PASS (native-remediation check 3 of 3).**

The reviewer independently confirmed the five auditor findings against
HEAD `0b962bee448133eff9db6c953894e4ba360db79e`, recorded B51/B55–B59
failures before product correction, inspected the product correction
(no `restorePeOverlay`; official PE left unsigned; checksum-gated
`--node-binary`; pinned pefile/macholib/altgraph; two fresh-process
official-target trees), and finalized both reports with `# tests 62`
`# pass 62` `# fail 0`. Product code was not edited by this reviewer.
The final corrective SHA is supplied in the final response.

## Deferred/unverified capabilities

- macOS (`darwin-x64`, `darwin-arm64`) and Windows (`win-x64`) release
  definitions are implemented and executable in `src/packaging.js`, but
  they are **unverified** (labeled `unverified` in every release manifest):
  official-Node container validation and fixture injection are not matching-
  host execution. Runtime support is claimable only after real execution on
  a matching macOS/Windows host, including post-inject `codesign --sign` and
  Windows Authenticode re-signing of the unsigned image.
- `linux-arm64` is likewise **unverified** until a real arm64 Linux host
  exercises it.
- Pi, OMP, and Codex client integrations are **unverified** per
  `compat/matrix.json`; Hermes and Claude are verified via isolated real
  launches.
- External sending, application submission, packet freezing, interview
  scheduling/attestation, browser automation, and provider delivery remain
  deferred/blocked and are never claimed.
