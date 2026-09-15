# JobSSS sourcing — frozen evaluator (sourcing-v3)

**Status:** RE-FROZEN by reviewer erratum E2 after integrated revision `ae53d32`; E1 remains incorporated. Scoring, fixtures, behavioral assertions, and thresholds are unchanged from sourcing-v1.
**Owner:** reviewer (L0, Codevisor). E2 approved by sessions `20260915_102141_8059d5` and `20260915_102622_d19611`. Implementers and lanes must not edit this file, `tests/sourcing-*.test.mjs`, `tests/fixtures/sourcing/`, `tests/helpers/sourcing-harness.mjs`, or `evaluation/**`.
**Supersedes:** sourcing-v2 only for this mission's final evaluation. The v1/v2 rubric and manifest files remain preserved evidence. `BENCHMARK.md` (B1–B70) and `tests/jobsss-*.test.mjs` stay frozen and
untouched; this file is an **additional** pass bar for the sourcing mission
(`plan-jobsss-sourcing-v2.md`). Nothing here may weaken any B-check.

**One line:** every outbound fetch obeys published site policy, ohshi jobs map to the canonical
store without lying about partial results, and first-class operation is proven by Hermes as host —
with the boundary of that claim stated, not blurred.

---

## 1. Verdict and scoring

- Verdict is **PASS** or **FAIL**. No partial credit inside a check.
- 10 checks, each `PASS`/`FAIL` from **one reviewer-owned command** producing a machine-readable
  result. **≥ 9 of 10 must PASS.**
- **Mandatory checks hard-block: #1, #3, #7, #9.** If any mandatory check FAILs, the verdict is
  FAIL even at 10/10 on the others. This is deliberate: the numeral 9 is never the target.
- **No points from** lane reports, prose, self-certification, controller summaries, or live-network
  counts. A check passes only when its own command passes on the integrated tree.
- Live `ohshi.work` is an **advisory smoke outside the score** (non-deterministic). It may be
  recorded; it never scores.
- Existing frozen `BENCHMARK.md` / `tests/jobsss-*.test.mjs` remain in force and are not weakened.

Every scoreable assertion in this rubric is executable **offline** through public repo surfaces
(`src/discovery.js`, `src/domain.js`, `bin/jobsss`, repo files) with an injected transport. Anything
that is not is listed in §6 harness defects — and never scored.

---

## 2. Check table (exact commands, run from repo root)

| # | Check | Command | Mandatory |
|---|---|---|---|
| 1 | Frozen B1–B70 gate passes | `FROZEN-GATE-CMD` | **yes** |
| 2 | Robots decision table: every executable row asserted offline | `node --test --test-concurrency=1 tests/sourcing-robots-policy.test.mjs` | no |
| 3 | Denial → **zero** content requests from every entry point | `node --test --test-concurrency=1 tests/sourcing-egress-denial.test.mjs` | **yes** |
| 4 | Matcher semantics: longest match, Allow-on-ties, `*`, `$`, encoding, empty `Disallow`, group selection | `node --test --test-concurrency=1 tests/sourcing-robots-matcher.test.mjs` | no |
| 5 | Cross-origin (and same-origin path-changing) redirects decided per hop before content | `node --test --test-concurrency=1 tests/sourcing-robots-redirects.test.mjs` | no |
| 6 | No production egress bypasses the choke point (static invariant over all call sites) | `node --test --test-concurrency=1 tests/sourcing-egress-invariant.test.mjs` | no |
| 7 | ohshi mapping + provenance + CC BY 4.0 attribution + honest partial results | `node --test --test-concurrency=1 tests/sourcing-ohshi-mapping.test.mjs` | **yes** |
| 8 | ohshi bounds: page/byte caps, cursor-cycle termination, idempotent re-discovery, typed upstream errors | `node --test --test-concurrency=1 tests/sourcing-ohshi-bounds.test.mjs` | no |
| 9 | Hermes-first host integration per L3, boundary labelled | `node evaluation/check9-hermes-host.mjs --bundle evidence/hermes-host --json` | **yes** |
| 10 | Eval-lane evidence bundle: independent recomputation of hashes and claims | `node evaluation/check10-evidence.mjs --bundle evidence/eval-lane --json` | no |

`FROZEN-GATE-CMD` is the focused command frozen in `AGENTS.md`, verbatim:

```
node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs tests/jobsss-integrity.test.mjs tests/jobsss-release.test.mjs tests/jobsss-adapters.test.mjs tests/jobsss-authority.test.mjs tests/jobsss-cross-platform.test.mjs
```

`evaluation/MANIFEST-sourcing-v3.json` carries the same commands machine-readably, plus every
authored file. A manifest/command divergence is a FAIL of check #10.

---

## 3. What each check asserts

### #1 Frozen B1–B70 gate passes (mandatory)
`FROZEN-GATE-CMD` exits 0. No fixture, prose, or lane report substitutes for it. The natural
regression risk here is real: the L1 gate sits inside `fetchPublicResource`, which the live
Greenhouse path also uses — a fail-closed policy may legitimately change discovery behavior, and the
frozen bar still has to pass.

### #2 Robots decision table (`tests/fixtures/sourcing/robots-decisions.json`)
Each row = one robots response + one target URL + the expected decision. Rows are driven through
`fetchPublicJob(target, { fetchImpl, lookupImpl })` (exported, choke-point user) with a fake
transport; no network. Executable rows:

1. `200` valid, path not disallowed → allow, exactly one content request.
2. `200` valid, `Disallow` matches → deny, **zero** content requests.
3. `200` empty body → allow (empty policy = allow all).
4. `200` garbage body (NUL bytes, no parsable directive) → `policy_invalid`, deny.
5. `401` → `policy_unreadable`, deny.
6. `403` → `policy_unreadable`, deny.
7. `404` → `policy_absent`, allow.
8. `500` → `policy_unreachable`, deny.
9. `503` → `policy_unreachable`, deny.
10. transport timeout on the policy fetch → `policy_unreachable`, deny.
11. DNS failure on the policy fetch → `policy_unreachable`, deny.
12. TLS failure on the policy fetch → `policy_unreachable`, deny.
13. `429` + `Retry-After: 30` → deny, and an immediate second call adds **zero** new requests to
    that origin (Retry-After honoured, no persisted scheduler).

Plus three non-table properties, same file, same transport:

- **Policy fetch precedes content**: the policy request index is lower than the content request index.
- **Cache**: two calls in one process → exactly one policy request, two content requests; at least
  one regular file appears under the `PLUGIN_DATA` directory; after those cache files are removed,
  a third call revalidates (policy request count increases). Placement is asserted by
  *file-creation under `PLUGIN_DATA`*, never by a hardcoded cache path or format.
- **`PLUGIN_DATA` unset** → the call still works (in-process only), no crash.
- **UA identity**: the policy request's `user-agent` header equals the content request's
  `user-agent` and is non-empty.

Denial code contract: a denial must reject with a `code` matching `/^policy_/` that is **not** one of
the allow codes (`policy_absent`). The four names above come from the plan's decision table; the
denial name itself is not fixed beyond the `policy_` family, so an implementation may choose
`policy_denied` without a rubric amendment.

### #3 Denial → zero content requests, from every entry point (mandatory)
For each entry point, the target origin's policy denies and the assertion is the strong form:

- `fetchPublicJob(target)`
- `fetchGreenhousePublic({ boardToken })`
- `fetchApplicationDetail({ url }, { fetchImpl, lookupImpl })` — degrades, never throws
- `fetchSavedSearchSource({ adapter: 'greenhouse', config: { boardToken } })`
- `fetchSavedSearchSource({ adapter: 'ohshi', config: { company } })`

Required for each: the call does not succeed; the transport's **entire** request log contains
policy-fetch requests only (`requests.length === policyRequests.length`); the content URL never
appears; the failure is a policy denial. For the ohshi entry point the failure must also not be
`unsupported_adapter` — otherwise a missing adapter would pass this check trivially, which is exactly
the kind of green this rubric exists to prevent.

### #4 Matcher semantics (`tests/fixtures/sourcing/robots-matcher.json`)
Decision-only rows over one robots body each (RFC 9309 semantics as the plan fixes them). Mandatory
rows: longest match wins (both directions); Allow-on-ties, order-independent; `*` mid-token; `$`
anchor (and `/jobs/1` still allowed); percent-encoded octets match without decoding; empty
`Disallow:` allows all; non-matching rule allows; `User-agent: *` group selection (another bot's
group must not apply to us); `Disallow: /` denies all. Advisory (recorded, not scored): unicode form
of a percent-encoded path.

### #5 Redirects decided per hop (`tests/fixtures/sourcing/robots-redirects.json`)
Scenarios, driven through `fetchPublicJob`:

- cross-origin hop to an **allowed** target → success, returned `url` is the final URL, body from the
  final hop, and each origin's policy request precedes that origin's content request.
- cross-origin hop to a **denied** target → denial; the final target URL never appears in the log.
- **same-origin path change** into a disallowed path → denial; the second path is never requested
  (a redirect target is re-decided even when the origin did not change).
- hop target whose policy is unreachable → fail closed.
- 5-hop chain → existing `url_redirect_error` is preserved (the gate must not mask it).

### #6 Egress invariant (static, offline)
Over `src/**` and `bin/**`:

- Egress constructs (`globalThis.fetch`, bare `fetch(`, `await fetchImpl(`, `node:dns|http|https|net`
  imports, `https.get|request(`, `XMLHttpRequest`) are enumerated; every hit must be *classified*
  by an explicit rule: the choke point's declaration/imports, its single `await fetchImpl(` call, or
  a frozen allowlist entry with a stated reason (today: one generated native-evidence probe template
  line in `src/packaging.js`, which is release/evidence tooling, not the MCP runtime path).
- Exactly one `await fetchImpl(` exists in the whole tree.
- `src/discovery.js` is the only file referencing `globalThis.fetch` and the only file importing
  `node:dns`.
- The MCP runtime import closure (`bin/jobsss` → `src/cli.js` → `src/mcp.js` → …) contains no
  egress construct outside the classified set, and excludes `packaging.js` / `release.js` /
  `evidence.js` / `sea-build.js`.

Anything new → FAIL naming file and line. This is a code-shape invariant, not a runtime one; it is
labelled as such in the manifest.

### #7 ohshi mapping + provenance + attribution + honesty (mandatory)
Offline, fixture-backed, through the existing saved-search seam
(`domain.createSavedSearch` → `domain.dailyDiscovery`) and the exported adapter seam
(`fetchSavedSearchSource`). Frozen normalized-job contract:

```
{ title, company, location, url, source: 'ohshi', sourceId,
  canonicalUrl, provider, status, firstSeenAt, lastSeenAt, description }
```

Asserted: one normalized job per fixture job; `url === canonicalUrl` and `canonicalUrl` also present
as its own key; `provider`, `status`, `firstSeenAt`, `lastSeenAt` preserved byte-for-byte from the
fixture (value-level substring search over the result, so nesting cannot hide a loss); title /
company / location preserved; `source === 'ohshi'`; `sourceId` present. The result exposes
`attribution` containing `CC BY 4.0` and the source URL — i.e. the licence travels to the agent.
`skills/jobsss/**` mentions ohshi sourcing and the CC BY attribution (routing, so an agent actually
uses the adapter). Partial truth: the single-page fixture reports no truncation; the page-cap
fixture reports truncation (see #8) — a constant `partial: true` fails the single-page case, a
missing marker fails the cap case.

### #8 ohshi bounds (`tests/fixtures/sourcing/ohshi-bounds.json`)
Network-path rows (fake transport, still offline):

- endpoint is the intelligence view only — `view=jobs`, a `limit` parameter is present and defaults
  to 25, and the request path is never `/api/v1/jobs`.
- cursor walk: chain of 3 pages → the adapter follows each `nextCursor` value from the fixture.
- cursor cycle (page cursors repeat) → the fetch terminates; each distinct cursor is requested at
  most twice (once more to detect the cycle, no more).
- 12-page chain → if fewer than 12 pages were fetched, the result must report truncation; if all 12
  were fetched, it must not. (Page count is a test input, never an expected literal.)
- single page body larger than 8 MiB → typed failure, no silent acceptance of a giant page.
- upstream `400` / `503` / `429` → typed error with a non-empty `code` and no silent empty success.

Offline rows: run the same saved search twice through `domain.dailyDiscovery` → run 2 imports zero
new jobs, reports the same jobs as deduped, and the durable store's job count is unchanged
(idempotent re-discovery, not duplication).

### #9 Hermes-first host integration (mandatory)
Contract: `evaluation/contracts/hermes-host-evidence.schema.json`. Checker:
`evaluation/check9-hermes-host.mjs`. It validates a recorded run bundle and **recomputes**, never
trusts:

- every listed raw capture exists and hashes to its declared sha256;
- Hermes version string + installed `hermes-agent` commit recorded, the version **also present in the
  raw `--version` capture**, and a clean-install run against that recorded version recorded;
- isolation: disposable `HERMES_HOME` **beneath** the real `~/.hermes` tree and not equal to it;
  `PLUGIN_DATA` outside the plugin tree; the plugin tree hash recomputed by the checker
  (`--emit-plugin-tree-hash`) unchanged before/after;
- the recorded MCP subprocess environment capture names `PLUGIN_DATA` = the isolated dir and contains
  no `API_KEY|TOKEN|SECRET|PASSWORD=` value (filtered env, honesty);
- skill preload: `--skills jobsss` (or `-s jobsss`) in the recorded command line, skill digest
  recomputed by the checker (`--emit-skill-digest`) over `skills/jobsss/**`;
- **expected MCP tool names are derived from the plugin itself** (`./bin/jobsss mcp` +
  JSON-RPC `tools/list`), never from the bundle, and the names observed in the raw captures /
  transcript must equal that set, every one prefixed `mcp__jobsss__` for the pinned Hermes v0.21.2 runtime;
- a **real model invocation**: a Hermes-owned transcript file inside the disposable `HERMES_HOME`
  whose bytes contain the resolved provider, the resolved model, and the tool names/call ids of at
  least one paired `tool_call`+`tool_result`; the normalized event list must agree with those bytes;
  the resolved route must equal the expected route (any mismatch = `needsReview` = FAIL of this
  check, never a silent pass); reasoning level from the documented level set;
- boundary: exactly one asserted boundary label,
  `source-skill+mcp-under-tool-only-isolation`. Asserting `native-plugin-loading` or `os-sandboxing`
  in the sourcing claim is a **FAIL** (overclaim). A separate native-manifest assertion may exist but
  must be labelled separately and must not be folded into that claim.

### #10 Eval-lane evidence bundle (independent recomputation)
Contract: `evaluation/contracts/eval-lane-evidence.schema.json`. Checker:
`evaluation/check10-evidence.mjs`. It requires `mcp-calls.jsonl`, `artifact-hashes.json`, and
`checks.py`, and:

- hashes the bytes at every path returned by a call, compares against the call's declared hash **and**
  against `artifact-hashes.json` (path↔hash bijection: no undeclared artifact, no declared hash
  without a path, no hash that does not recompute);
- recomputes call counts from the JSONL itself; any declared count/total in the bundle that
  disagrees with the recomputation is a FAIL; `seq` must be a dense increasing sequence;
- derives the expected tool prefix from the repo's own `mcp.json` server key (`mcp_<server>_`) and
  fails any call that does not match it;
- runs `python3 checks.py --list-checks --json` and requires its check ids and commands to **equal**
  the frozen manifest's — a runner that disagrees with the frozen rubric fails;
- contains **no hardcoded count/hash literal**: every expectation is derived at check time.

A missing bundle is a FAIL (`bundle_missing`), which is the expected initial state.

---

## 4. RED vs evaluator defect

Before L1/L2 land, checks #2–#5 and #7–#8 are expected to be **RED**. Check #6 starts GREEN on the untouched tree as a regression guard over the existing single-egress shape. That is the point: the evaluator is
written first and is not authored by the implementer. When a check is RED, exactly one of these is
true, and the response is different for each:

- **RED = missing/incomplete product behavior.** The failure message names the behavior
  (`zero policy requests before content`, `expected policy_unreadable`, `partial marker missing`…).
  Response: implement it. Do not touch the check.
- **RED = evaluator defect.** The check is wrong: it asserts something the frozen plan does not
  require, reaches for a private internal, depends on a cache path/format/value we never froze,
  encodes a count that should be derived, or fails against a correct implementation.
  Response: the **reviewer** fixes the check, re-freezes it (hash in the manifest), and re-runs every
  check. An implementer who believes a check is defective must escalate with the failing assertion,
  the observed value, and the plan line it contradicts — never edit it, never weaken it, never
  "adjust" a fixture.

Two REDs are never acceptable and are treated as evaluator defects by definition: a check that cannot
run at all (import error, missing fixture) and a check that passes vacuously (e.g. because the
adapter it drives does not exist yet). Both are guarded: the ohshi entry points assert
`!== 'unsupported_adapter'`, and every check fails loudly rather than skipping.

## 5. Release gate (blocking, unscored)

Not part of the 10. Failing any blocks release even at 10/10:

1. `FROZEN-GATE-CMD` passes on the release commit.
2. Evidence currency: `JOBSSS_NATIVE_CACHE=<empty external dir> ./bin/jobsss evidence --out "$(pwd)/evidence/native-validation.json"` regenerated, and the SHA-256 cited in `RELEASE_REPORT.md` and `PRODUCTIZATION_REVIEW.md` matches the regenerated artifact (frozen B70).
3. Hermetic PDF text-layer check via the existing dependency-free `/ToUnicode`-CMap parser, run at acceptance time — the poppler gap stops being a standing exception.
4. `node evaluation/freeze-files.mjs --manifest evaluation/MANIFEST-sourcing-v3.json --verify` passes: every authored v3 file still hashes to the frozen value.

## 6. Harness defects and limits (recorded, not scored)

Full machine-readable list: `harnessDefects` in `evaluation/MANIFEST-sourcing-v3.json`. Summary:

- **D1 — policy cache expiry is not executable.** The plan requires valid/404 caching ≤ 24 h,
  5-minute failure caching, and "no expired allow on refresh failure". No public surface exposes a
  clock or the cache format, so expiry cannot be forced deterministically. Scored rows are restricted
  to what is observable: in-process reuse, revalidation after the cache files are removed, fail-closed
  on an unreachable/invalid policy, and no request within a `Retry-After` window. **Remedy:** if the
  gate accepts an injectable time source in the same option bag as `fetchImpl`/`lookupImpl`, the
  expired-allow row becomes executable and the reviewer folds it in (new rubric version, re-freeze).
  **Scoring effect:** none of the three expiry behaviours is scored today; they remain advisory.
- **D2 — live ohshi body shape unverified.** No network at authoring time, so `ohshi-intelligence.json`
  *is* the frozen body contract (fields = the plan's canonical mapping fields + `nextCursor` +
  `attribution`). If the live body nests differently, the live path must adapt; the fixture contract
  does not move. The live smoke is advisory and never scored.
- **D3 — Hermes transcript authenticity cannot be attested cryptographically.** No public Hermes
  surface signs a transcript. The checker asserts location (inside the disposable `HERMES_HOME`),
  currency (mtime inside the recorded run window), and byte-level agreement with the normalized
  record. A hand-authored transcript that satisfies all three is not detectable by this rubric; the
  claim stops exactly there.
- **D4 — MCP subprocess environment is asserted from a recorded capture**, not by inspecting a live
  process after the fact. The capture is hash-verified and its contents are asserted; it is still a
  capture.
- **D5 — byte-cap threshold (8 MiB) is an evaluator-chosen input size**, not the product's cap. Any
  cap ≤ 8 MiB passes. No product constant is invented.
- **D6 — `fetchPublicResource` is module-private and stays that way.** Checks reach it through the
  exported entry points that use it. Do not "fix" this by exporting internals; if a check truly needs
  a new public seam, that is an escalation, not an implementation detail.
- **D7 / E1 — rejected outcomes require a serializable value.** The sourcing-v1 helper returned no
  `value` from `settle()` on rejection, while three frozen assertion messages eagerly called
  `JSON.stringify(outcome.value).slice(...)`. Correct policy denials therefore crashed 12 leaf tests
  (14 TAP failures including parents) before their assertions could report. Reviewer consultation
  `20260915_101007_cb0bbe` approved the minimal, non-substantive correction: rejected outcomes are
  `{ ok: false, value: null, error, code, message }`. No assertion, fixture, command, score, threshold,
  or product contract changed. The v1 files and 71/14 failure evidence remain preserved; v2 is fully
  re-frozen and every check must be rerun.
- **D8 / E2 — in-repo evidence bundles were self-referential.** Sourcing-v2's plugin-tree digest
  included `evidence/hermes-host/**`, including the `run.json` that had to contain that digest, making
  check #9 unsatisfiable. V3 excludes exactly `evidence/hermes-host` and `evidence/eval-lane` by
  repository-relative path. It does not exclude the `evidence` directory generally, so tracked
  `evidence/native-validation.json` remains covered. Raw captures and artifacts remain independently
  hashed; bundle `run.json` is self-excluded for the same reason a manifest excludes itself.
- **D9 / E2 — the frozen Hermes namespace was stale.** Pinned Hermes v0.21.2 at install commit
  `31d0a2428e9db346d6781da66f5b37ff3e12def2` registered and invoked tools as
  `mcp__jobsss__<tool>`, while sourcing-v2 assumed legacy `mcp_jobsss_<tool>` and could be satisfied
  by prompt prose. V3 requires the exact runtime namespace, a hash-verified Hermes `agent.log`
  registration capture carrying all tools, and real paired calls/results in the Hermes transcript.

## 7. Frozen names introduced by this rubric

Flagged so nothing is hidden. Everything else is quoted from the plan.

- Robots policy codes `policy_absent` / `policy_invalid` / `policy_unreadable` / `policy_unreachable` (plan's table). Denial is `policy_*` and not `policy_absent`.
- Policy URL `<origin>/robots.txt`, fetched through the same injectable transport as content.
- Policy cache root derived from `process.env.PLUGIN_DATA` (the value the host expands into `mcp.json`'s `--data`). A cache that only lives in memory fails the placement assertion.
- ohshi offline seam: `adapter: 'ohshi'` + `config.fixture` (PLUGIN_DATA-relative), mirroring the existing greenhouse convention; fixture body `{ jobs, nextCursor, attribution }`.
- Normalized ohshi job keys (§3 #7) and result-level `attribution` and truncation marker.
- The `checks.py --list-checks --json` interface and the eval-lane bundle layout.
- Plugin-tree hash and skill-digest algorithms: **the checker is the reference implementation**
  (`--emit-plugin-tree-hash`, `--emit-skill-digest`), so the recorder and the checker cannot drift.

## 8. Freeze and ownership

- This file and every file listed in the manifest are **reviewer-owned**. An implementer who edits
  one invalidates the freeze: the run is void and re-freezing is required.
- Freeze procedure for sourcing-v3: `node evaluation/freeze-files.mjs --manifest evaluation/MANIFEST-sourcing-v3.json --write` (records sha256 for every v3 manifest
  file except the manifest itself), then the same command with `--verify` must pass.
- Amendments only before L1 starts; after that, only the reviewer may amend, and an amendment
  requires a new rubric version file, a re-freeze, and a full re-run of all 10 checks.
- Keep-out (unchanged from the plan): no Workday/Ashby readers, no bulk ohshi mirror, no ATS
  framework, no "public API" exception registry, no dashboard/CSV/Gmail/Notion plumbing, no browser
  automation, no daemon/scheduler, no npm dependency, no private-Hermes test API, no generic MCP
  client relabelled as Hermes, no weakening of any existing check.
