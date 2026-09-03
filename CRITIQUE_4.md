# CRITIQUE_4 — JobSSS independent-native evidence, authoritative final review

Published base: `803135995782e36cbf9427ac903a2e26d2952383` (`origin/main`, pushed).
Candidate: uncommitted B61–B64 evidence corrections on that base.
Reviewer ownership used: `BENCHMARK.md`, `tests/jobsss-native-remediation.test.mjs`,
`tests/helpers/jobsss-native-validators.mjs`, `PRODUCTIZATION_REVIEW.md`,
`RELEASE_REPORT.md`, this file. Product/runtime/`compat/matrix.json`/`plugin.json`
were not edited by this review.

**nativeEvidenceFinalVerdict: PASS**

This is the single authorized final verdict. Execution stops here.

---

## Pre-correction gate (historical, already recorded)

```bash
node --test --test-concurrency=1 --test-name-pattern='B61 |B62 |B63 |B64 ' \
  tests/jobsss-native-remediation.test.mjs
```

Exit `1`. `# tests 4` `# pass 0` `# fail 4` `duration_ms 25390.068305`.
B61/B62 lacked canonical `case`/payload/fuse/linkedit/SizeOfImage fields;
B63 reports had no complete JSON; B64 Windows overlay wording was wrong.

Expected B53 lag on published 8031359 (not weakened):

```bash
node --test --test-concurrency=1 --test-name-pattern='B53 ' \
  tests/jobsss-native-remediation.test.mjs
```

Exit `1`. `# tests 1` `# pass 0` `# fail 1` `duration_ms 104.417898`.
Stale `# tests 62` vs live frozen count 66.

---

## Frozen command (this review, genuinely empty external cache)

```bash
JOBSSS_NATIVE_CACHE=$(mktemp -d) node --test --test-concurrency=1 \
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

Cache started empty and outside the plugin tree. Exit `0`.
`# tests 66` `# pass 66` `# fail 0` `duration_ms 493331.0728`.
No report edits after this run, so no rerun was required.

B1–B60 remain intact. B61–B64 are additive (`test(` count 66).
B1–B5 text in `BENCHMARK.md` was not deleted, rewritten, or weakened.

---

## Independent validator inspection (this review)

`tests/helpers/jobsss-native-validators.mjs` does not import
`src/packaging.js`, `jobsss-native-format.mjs`, injector internals, or
synthetic fixture generators. It orchestrates checksum-pinned
pefile 2024.8.26, macholib 1.16.3, and altgraph 0.17.4.

Live inject+inspect of official Node v22.22.3 bytes, then deep-equal of
the emitted one-line JSON against both reports:

| Case | Result |
| --- | --- |
| darwin-x64 | format/arch macho/x64; NODE_SEA + `__NODE_SEA_BLOB`; payloadLength 55 / sha256 `42bdb3a3…e9b6f1`; fuse present+enabled; `hasCodeSignature` false; 40 file-offset checks all in bounds; `__LINKEDIT` relocated delta 4096; LC_SYMTAB/DYSYMTAB/exports/functionStarts/dataInCode recorded; segments ordered, 0x1000-aligned, non-overlapping; output sha256 `126fe3a7…69b8df` |
| darwin-arm64 | equivalent first-class case; payloadLength 57 / sha256 `1a5150ac…38f46b`; `__LINKEDIT` relocated delta 16384; 40 in-bound offset checks; output sha256 `53260682…6fb0d1` |
| win-x64-before | pe/x64; FileAlignment 0x200 / SectionAlignment 0x1000; 9 resources with type/name/language/sha256; Security `86953472/15688`; overlay 15688; SizeOfImage = computed 89866240; input sha256 `780f44f2…ac9b` |
| win-x64-after | Security `0/0`; `certificateRestored` false; original cert bytes absent; 9 original resources preserved by key+sha256; exactly one added `RT_RCDATA/NODE_SEA_BLOB`; payloadLength 52 / sha256 `8c0cf2ac…c083f2`; fuse enabled; sectionRangesInBounds true; SizeOfImage = computed 90009600 from aligned section ends; output sha256 `9bb6ba9c…93b401` |

`INDEPENDENT_JSON_MATCH=ok` against `PRODUCTIZATION_REVIEW.md` and
`RELEASE_REPORT.md` for all four cases.

---

## Metadata / hygiene

- `compat/matrix.json` win-x64 notes describe certificate removal and
  Security directory 0/0; no “overlay preserved” claim.
- Authoritative version `0.1.0` in `plugin.json`, `src/cli.js`, and
  `src/release.js`.
- Both reports identify published base `803135995782e36cbf9427ac903a2e26d2952383`
  as origin/main pushed and do not call it unpushed or claim origin/main is
  behind. Final corrective SHA is reserved for the parent’s final response.
- darwin/win remain unverified as runtime platforms.
- No staged files. No tracked large artifacts, escaping symlinks, or
  product-path/secret leaks. Validator/Node caches stay outside the tree.

No reviewer-owned report errors required correction after the live run.
No product/application behavior files were edited by this reviewer.

Residual risks unchanged: linux-arm64 / darwin-x64 / darwin-arm64 / win-x64
runtime unverified on matching hosts; Pi/OMP/Codex unverified; Windows
re-signing remains a later matching-host step.
