# JobSSS Productization Review

Reviewed tree identity: committed HEAD
`0b962bee448133eff9db6c953894e4ba360db79e` (superseded pre-audit SHA; do
not treat as the final corrective commit) plus uncommitted audit
remediation on parent
`8b2db255e7868397d336f8b015c489552b84bf0e`. Intermediate baseline
`ba2123ef5f6f24bcf6ae994a125b67501b970785`. Node v22.22.3, host linux/x64.
No staged files. The final corrective SHA is supplied in the final response
and is not invented here.

**Fresh verdict: PASS**

Scope: this reviewer check is native-remediation review 3 of 3. Check 2
PASS was rejected by the independent auditor. This check independently
inspected the product correction against those five findings, ran the
frozen twelve-file command from a genuinely empty
`JOBSSS_NATIVE_CACHE=/tmp/jobsss-check3-empty-E36qoJ`, and finalized both
reports with the live frozen-command count. Product files were not edited
by this reviewer. Frozen B1–B54 coverage was not weakened; B55–B60 remain
additive.

## B1–B41

Frozen twelve-file command after this review's report finalization:
`# tests 62` `# pass 62` `# fail 0`, exit `0`. B1–B41 all passed on
inspected files and live subprocesses:

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
and `win-x64` (PE `RT_RCDATA` `NODE_SEA_BLOB`), consults
`src/packaging.lock.json`, and does not import
MCP/domain/authority/store/scoring/workflow/discovery/relationship/
compat-probe modules. Native mutation goes through pinned postject
1.0.0-alpha.6 (`https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`,
SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`).
`restorePeOverlay` is absent. `injectSeaPayload` returns pinned postject
bytes unchanged. B42–B45 and B48–B60 passed in-suite.

`--node-binary` accepts only the checksum-pinned official Node executable
for that target (`executableSha256` in `src/packaging.lock.json`). A
same-format/arch mutant fails with checksum/sha256/mismatch and writes no
launcher (B58). Synthetics may still hit `injectSeaPayload` directly, not
the release CLI.

Independent official-Node container validation (not macOS/Windows runtime
verification), using pinned build/test-only parsers pefile 2024.8.26
(SHA-256 `76f8b485dcd3b1bb8166f1128d395fa3d87af26360c2358fb75b80019b957c6f`),
macholib 1.16.3 (SHA-256 `0e315d7583d38b8c77e815b1ecbdbf504a8258d8b3e17b61165c6feb60d18f2c`),
and altgraph 0.17.4 (SHA-256 `642743b4750de17e655e6711601b077bc6598dbfa3ba5fa2b2a35ce12b508dff`)
invoked from verified wheels on isolated `PYTHONPATH`:

- darwin-arm64 official Node SHA-256
  `5d9d3872911e2340a43b707962e68143de8a4e8d54628845c0c4f2de1fb7cd5c`.
  macholib 1.16.3 exact JSON (probe blob, not the current-host launcher):
  `"hasCodeSignature":false`, NODE_SEA filesize 33 / vmsize 16384 /
  fileoff 86605824, __LINKEDIT fileoff 86622208 / filesize 25166240.
  LC_CODE_SIGNATURE removed (postject `remove_signature`; Node SEA
  `codesign --remove-signature` then re-sign). LC_SYMTAB / linkedit
  offsets point at relocated content. Fuse `:1`.
- darwin-x64 official Node SHA-256
  `edc0e47adde954e891939bb509a62accdad5f6b15f32ec56ed78f9d6b7dd7308`.
  macholib 1.16.3: `"hasCodeSignature":false`, NODE_SEA filesize 33 /
  vmsize 4096 / fileoff 88850432, __LINKEDIT fileoff 88854528.
- win-x64 official `node.exe` SHA-256
  `780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b`.
  pefile 2024.8.26 exact JSON: SizeOfImage 90009600, FileAlignment 512,
  SectionAlignment 4096, `"security":{"fileOffset":0,"size":0}`,
  overlaySize 0, overlayOffset null, resource name `NODE_SEA_BLOB`
  present. Pre-injection Authenticode overlay is not restored. Matching-
  host Windows distribution requires re-signing afterward; this host
  does not re-sign.

Fixture / official-input container success is definition integrity, never
platform runtime verification. darwin-arm64, darwin-x64, and win-x64
remain unverified on this host.

## Current-host restricted-PATH release evidence

Two clean `./bin/jobsss release --out <a|b> --target current-host`
builds both exited 0. Complete `--out` trees were byte-identical
(11 files). Released `bin/jobsss` sha256
`7ee8a77c3648aed8afa3912b4517f1e669790c7c3e694020ff05d665ac8eefe9`.
Release-manifest statuses: current-host **verified** (same artifact
SHA), linux-x64 **verified** (byte-identical host artifact),
linux-arm64 / darwin-x64 / darwin-arm64 / win-x64 **unverified**.
Empty-cache B54 and B60 two fresh-process complete official-target
release trees were byte-identical for linux-x64, linux-arm64,
darwin-x64, darwin-arm64, and win-x64.

Copied the current-host plugin tree and spawned `bin/jobsss mcp --data
<temp PLUGIN_DATA>` with PATH = `node`/`jobos` traps + `/usr/bin` +
`/bin` only (frozen B31/B32): initialize OK, tools/list includes the
journey set, doctor/start OK, create_profile → import_job → restarted
list_jobs persisted, traps never fired.

## Adapter behavior

Isolated `./bin/jobsss compat-probe --client <pi|omp|codex|hermes|claude>
--config-dir <temp> --plugin-root <plugin>` all exited 0 (frozen B34).
Probe JSON matched `compat/matrix.json`: pi/omp/codex **unverified**;
hermes/claude **verified**. Generated adapters remain thin pointers
(B33/B35/B41).

## Human authority

Trusted-local `./bin/jobsss decide` remains the only surface that
completes enumerated human decisions. B36–B40 passed: missing/unknown
binding fails without persist; stale revision or content-hash is a typed
conflict; MCP `list_decision_handoffs` / `create_decision_handoff` cannot
forge authority; audit/projections agree after restart. JobSSS does not
claim sent, submitted, applied, approved, or interviewed.

## Commands/results

Exact commands/results recorded by this reviewer (cwd
`/home/logani/projects/jobsss`, Node v22.22.3,
`JOBSSS_NATIVE_CACHE=/tmp/jobsss-check3-empty-E36qoJ`):

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

Live frozen-command result before this file and `RELEASE_REPORT.md` were
finalized: `# tests 62` `# pass 61` `# fail 1`, exit `1`, solely B53
stale `# tests 56`. After this file and `RELEASE_REPORT.md` are
finalized: `# tests 62` `# pass 62` `# fail 0`, exit `0`.

Pinned injection-tool and independent-validator identity
(`src/packaging.lock.json`):

- postject 1.0.0-alpha.6
  `https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`
  SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`
- pefile 2024.8.26 SHA-256 `76f8b485dcd3b1bb8166f1128d395fa3d87af26360c2358fb75b80019b957c6f`
- macholib 1.16.3 SHA-256 `0e315d7583d38b8c77e815b1ecbdbf504a8258d8b3e17b61165c6feb60d18f2c`
- altgraph 0.17.4 SHA-256 `642743b4750de17e655e6711601b077bc6598dbfa3ba5fa2b2a35ce12b508dff`
- official Node v22.22.3 dist `https://nodejs.org/dist/v22.22.3/`
  linux-x64 archive `2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f`
  linux-arm64 archive `1c4a9933a5e45bc88f54f70b5f91232c127ec49f1a5989d23fb85824c7adf9b7`
  darwin-x64 archive `45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec`
  darwin-arm64 archive `0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207`
  win-x64 archive `6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33`

Independent live probes (this review): two current-host releases exit 0,
complete-tree identity, artifact sha256 `7ee8a77c…ac8eefe9`; B34 client
probes; B36–B40 authority; B54 empty-cache postject acquisition; B55–B60
auditor native-safety checks; independent native-format validation
including LC_SYMTAB / linkedit / code-signature removal and PE SizeOfImage
with Security directory 0/0.

## Residual risks

- linux-arm64, darwin-x64, darwin-arm64, and win-x64 remain unverified
  on real matching hosts. Official-Node container validation and fixture
  injection prove format integrity only. macOS re-signing after
  LC_CODE_SIGNATURE removal, and Windows Authenticode re-signing after
  the Security directory is left unsigned, are subsequent matching-host
  steps.
- Pi, OMP, and Codex stay unverified until an isolated live JobSSS
  tool exchange is proven without inventing a custom bridge or
  provider-authenticated session.
- The released Node SEA artifact contains the upstream Node
  distribution's inherent `/home/iojs/build/ws` strings. Those are not
  user/workspace paths and pass the frozen no-leak checks.
- Pinned postject 1.0.0-alpha.6 drops the Authenticode overlay
  (`build_overlay(false)`) but leaves stale Security-directory DWORDs.
  Product staging zeroes those two DWORDs only on a private working copy
  before postject; caller buffers and postject output are not rewritten,
  and the pre-injection certificate is not restored. That is unsigned
  staging, not an ad hoc injector, and is not Windows runtime
  verification.
- Independent validators are acceptance-only Python wheels. They are
  never a runtime dependency.

Unverified hosts: linux-arm64, darwin-x64, darwin-arm64, win-x64.
Unverified clients: pi, omp, codex.
