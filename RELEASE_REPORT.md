# JobSSS Release Report

Historical release report retained from audited base `dd9497be2b973b6dd0316c826f22d4eafca65f39`, on published base `a380827d3cfd58c7c4dca014a109ead0326db18c`. The command results and reviewer verdict below are prior evidence, not acceptance of the current integrity candidate. Historical evidence identities: `803135995782e36cbf9427ac903a2e26d2952383`, `ba2123ef5f6f24bcf6ae994a125b67501b970785`, and `8b2db255e7868397d336f8b015c489552b84bf0e`. Published history is unchanged.

Current candidate identity: the final corrective SHA is supplied in the final response; that identity does not turn the historical results below into current-candidate acceptance.

Native artifact refresh (2026-09-07, correction round 5): the supported pinned evidence command regenerated the canonical artifact from `781f1346bf5f7f040615bce320030c1a288658e0` plus the historical-proof preparation eligibility correction in `src/relationships.js`, retained in the final corrective commit. The embedded SEA payload and corresponding native output hashes and layout offsets changed; official inputs, injector and validator pins are unchanged. The artifact citation below describes this refresh only. Current-candidate full-suite results and independent behavioral acceptance are tracked separately; no new reviewer PASS or agent-host journey is claimed here.

## Release summary

JobSSS remains one portable Agent Plugin, one canonical skill, and one bundled MCP runtime. Authoritative product version **0.1.0** comes from `plugin.json` and agrees across real CLI help/version, doctor, MCP initialize/doctor, and generated `release-manifest.json`, including SEA execution.

The release pipeline still uses the sole native implementation in `src/packaging.js` and checksum-pinned postject 1.0.0-alpha.6. No release was published and no custom injector was added.

## Canonical independent native evidence

Complete evidence is recorded once:

- Repository path: `evidence/native-validation.json`
- SHA-256: `ff3d02846d84acc5a00906074b598ae956f9803a03bade7b44b681aec7cbb040`
- Exact reproduction command:

```bash
JOBSSS_NATIVE_CACHE="$(mktemp -d)" ./bin/jobsss evidence --out "$(pwd)/evidence/native-validation.json"
```

The command uses a caller-selected external empty cache, downloads only locked inputs, verifies checksums before validation, avoids user configuration/data and prior generated files, and emits deterministic path- and timestamp-free JSON. Frozen B67 requires two fresh processes with empty caches to produce byte-identical output matching the repository artifact.

### Exact official Node inputs

| Target | URL | Archive SHA-256 | Executable SHA-256 |
|---|---|---|---|
| darwin-x64 | `https://nodejs.org/dist/v22.22.3/node-v22.22.3-darwin-x64.tar.gz` | `45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec` | `edc0e47adde954e891939bb509a62accdad5f6b15f32ec56ed78f9d6b7dd7308` |
| darwin-arm64 | `https://nodejs.org/dist/v22.22.3/node-v22.22.3-darwin-arm64.tar.gz` | `0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207` | `5d9d3872911e2340a43b707962e68143de8a4e8d54628845c0c4f2de1fb7cd5c` |
| win-x64 | `https://nodejs.org/dist/v22.22.3/node-v22.22.3-win-x64.zip` | `6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33` | `780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b` |

These exact records also appear in `src/packaging.lock.json` and the canonical artifact.

### Pinned tools and validators

- postject 1.0.0-alpha.6: `https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz`, SHA-256 `d1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92`
- pefile 2024.8.26: `https://files.pythonhosted.org/packages/54/16/12b82f791c7f50ddec566873d5bdd245baa1491bac11d15ffb98aecc8f8b/pefile-2024.8.26-py3-none-any.whl`, SHA-256 `76f8b485dcd3b1bb8166f1128d395fa3d87af26360c2358fb75b80019b957c6f`
- macholib 1.16.3: `https://files.pythonhosted.org/packages/d1/5d/c059c180c84f7962db0aeae7c3b9303ed1d73d76f2bfbc32bc231c8be314/macholib-1.16.3-py2.py3-none-any.whl`, SHA-256 `0e315d7583d38b8c77e815b1ecbdbf504a8258d8b3e17b61165c6feb60d18f2c`
- altgraph 0.17.4: `https://files.pythonhosted.org/packages/4d/3f/3bc3f1d83f6e4a7fcb834d3720544ca597590425be5ba9db032b2bf322a2/altgraph-0.17.4-py2.py3-none-any.whl`, SHA-256 `642743b4750de17e655e6711601b077bc6598dbfa3ba5fa2b2a35ce12b508dff`

Independent native evidence covers Darwin x64/arm64 NODE_SEA payload/fuse, all file-offset range checks, LC_SYMTAB/dysymtab/linkedit relocation, and code-signature removal. Windows evidence covers before/after resources, payload/fuse, alignment, sections, Security directory, overlay/certificate removal, and independently computed `SizeOfImage`. Unsupported non-certificate overlay input fails before mutation.

Exact PE resource preservation result: 9 original type/name/language/size/SHA-256 tuples preserved exactly; zero missing, changed, or duplicated; exactly one `RT_RCDATA` `NODE_SEA_BLOB` tuple added. Final Security directory is `0/0`, certificate bytes are not restored, section ranges are valid, and computed/header `SizeOfImage` agree.

## Generic restricted-PATH MCP evidence

The current-host standalone release is built and exercised with Node and JobOS absent from PATH. Generic stdio MCP initialize, tools/list, doctor/start, journey behavior, and restart persistence pass. The generated manifest reports version 0.1.0.

## Client compatibility matrix

| Client | Status |
|---|---|
| Pi | unverified |
| OMP | unverified |
| Codex | unverified |
| Hermes | verified |
| Claude | verified |

Adapters remain thin and canonical assets remain authoritative. These retained Hermes/Claude labels describe historical MCP connectivity probes only, not canonical skill loading, a state-changing agent-host journey, or native Agent Plugins package loading. Current version availability observations are recorded separately in `compat/matrix.json` and do not upgrade verification.

## Human-authority behavior

Only trusted local CLI handoffs can complete human decisions. MCP remains non-authoritative and cannot attest sending, submission, approval, applied status, scheduling, or interview debrief outcomes.

## Historical commands/results (before integrity corrections)

Focused command:

```bash
node --test --test-concurrency=1 --test-name-pattern='B65 |B66 |B67 |B68 |B69 |B70 ' tests/jobsss-native-evidence.test.mjs
```

Result: 6 tests passed, 0 failed, exit `0`.

Full command:

```bash
node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs tests/jobsss-integrity.test.mjs tests/jobsss-release.test.mjs tests/jobsss-adapters.test.mjs tests/jobsss-authority.test.mjs tests/jobsss-cross-platform.test.mjs tests/jobsss-native-remediation.test.mjs tests/jobsss-native-evidence.test.mjs
```

Result: `# tests 72`, `# pass 72`, `# fail 0`, exit `0`.

## Reviewer verdict

**Historical reviewer verdict: PASS** for B1–B70 on the prior unchanged candidate only. This is not a reviewer verdict on the current integrity candidate.

## Deferred/unverified capabilities

Darwin x64, Darwin arm64, Windows x64, and Linux arm64 remain unverified as matching-host runtime targets. Structural validation does not upgrade those labels. Windows requires matching-host re-signing after unsigned staging; macOS requires matching-host signing/execution. Pi, OMP, and Codex remain unverified client integrations. Downloaded inputs, validator environments, caches, and release binaries are not committed.
