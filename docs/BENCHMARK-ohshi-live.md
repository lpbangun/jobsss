# JobSSS — ohshi.work live-envelope acceptance benchmark

Status: FROZEN

Owner: reviewer (Codevisor `gpt-5.6-sol` / `openai-codex` / reasoning `medium`, session `20260916_012551_57ca8a`)

Baseline: JobSSS `main` at `7eb5813`, measured 2026-09-15

Implementation worktree: `/home/logani/projects/jobsss-worktrees/ohshi-live-envelope/jobsss`

Branch: `feat/ohshi-live-envelope`

This file is an additional acceptance bar. It does not replace, weaken, or amend:

- `BENCHMARK.md` checks B1–B70.
- `docs/BENCHMARK-sourcing-v3.md`.
- `tests/jobsss-*.test.mjs`.
- Existing `tests/sourcing-*.test.mjs`.
- `tests/fixtures/sourcing/`.
- `tests/helpers/sourcing-harness.mjs`.
- `evaluation/**`.

The implementer may add the new test files and fixtures named here and may change product code. The implementer must not edit this benchmark after freeze.

## 1. Job to be done

Make JobSSS consume the published ohshi.work intelligence envelope truthfully through its existing saved-search and MCP surfaces:

```text
{
  "data": [Job, ...],
  "page": {
    "next_cursor": "...",
    "total": 123
  },
  "schema_version": "1.1"
}
```

The implementation must also continue accepting the frozen sourcing-v3 fixture shape:

```text
{
  "jobs": [Job, ...],
  "nextCursor": "...",
  "attribution": { ... }
}
```

This is a boundary correction, not a new ingestion system. JobSSS remains an executor-neutral, Hermes-first Agent Plugin and a narrow consumer of filtered ohshi slices.

## 2. Verdict and scoring

- Final verdict is exactly `PASS` or `FAIL`.
- Each check is decided by its listed command’s exit code: exit `0` is PASS; any other exit code is FAIL.
- No prose assessment, percentage, lane report, fixture metadata, or live-network count can make a check pass.
- Eight additive checks are scored.
- At least 7 of 8 additive checks must PASS.
- Mandatory checks are #1, #2, #3, #4, and #5. Failure of any mandatory check makes the final verdict FAIL regardless of total.
- The frozen regression gate in #8 is independently blocking even though it is not marked additive-mandatory: a failure means the existing bars were weakened, so the final verdict is FAIL.
- No required test may skip because the network, JobOS, credentials, browser, or Hermes internals are unavailable.
- All scored tests run offline using injected transport or recorded envelopes.
- Live ohshi.work behavior is advisory only and never contributes to the score.

## 3. New acceptance artifacts

New test files:

```text
tests/sourcing-ohshi-live-envelope.test.mjs
tests/sourcing-ohshi-live-mapping.test.mjs
tests/sourcing-ohshi-saved-search-contract.test.mjs
tests/sourcing-ohshi-live-mcp.test.mjs
tests/sourcing-ohshi-live-pagination.test.mjs
tests/sourcing-ohshi-dual-shape.test.mjs
tests/sourcing-ohshi-live-provenance.test.mjs
```

Recorded-envelope fixtures may be added outside the frozen sourcing-v3 fixture directory, for example:

```text
tests/fixtures/ohshi-live-envelope/v1.1-page-1.json
tests/fixtures/ohshi-live-envelope/v1.1-page-2.json
tests/fixtures/ohshi-live-envelope/v1.1-empty.json
tests/fixtures/ohshi-live-envelope/v1.1-malformed.json
```

These fixtures must be data, not self-grading assertions. Expected values belong in the tests.

## 4. Check table

Run every command from the repository root.

| # | Check | Exact command | Mandatory |
|---|---|---|---|
| 1 | Live v1.1 envelope recognition, cursor extraction, and malformed-envelope honesty | `node --test --test-concurrency=1 tests/sourcing-ohshi-live-envelope.test.mjs` | yes |
| 2 | Live row mapping preserves usable company, posting body, camelCase fields, and source identity | `node --test --test-concurrency=1 tests/sourcing-ohshi-live-mapping.test.mjs` | yes |
| 3 | Saved-search identity and outbound query preserve every supported ohshi filter, including `new_since` | `node --test --test-concurrency=1 tests/sourcing-ohshi-saved-search-contract.test.mjs` | yes |
| 4 | Real JobSSS MCP saved-search/`search_jobs` path imports a recorded live-shaped envelope | `node --test --test-concurrency=1 tests/sourcing-ohshi-live-mcp.test.mjs` | yes |
| 5 | Pagination is bounded, advances by `page.next_cursor`, and reports truncation honestly | `node --test --test-concurrency=1 tests/sourcing-ohshi-live-pagination.test.mjs` | yes |
| 6 | Frozen `{ jobs, nextCursor, attribution }` shape still works through direct and saved-search paths | `node --test --test-concurrency=1 tests/sourcing-ohshi-dual-shape.test.mjs` | no |
| 7 | Schema/page/provenance and CC BY attribution survive to the observable result | `node --test --test-concurrency=1 tests/sourcing-ohshi-live-provenance.test.mjs` | no |
| 8 | All frozen B1–B70 and sourcing-v3 gates remain green unchanged | `sh -c 'node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs tests/jobsss-integrity.test.mjs tests/jobsss-release.test.mjs tests/jobsss-adapters.test.mjs tests/jobsss-authority.test.mjs tests/jobsss-cross-platform.test.mjs tests/jobsss-native-remediation.test.mjs tests/jobsss-native-evidence.test.mjs && node --test --test-concurrency=1 tests/sourcing-robots-policy.test.mjs tests/sourcing-egress-denial.test.mjs tests/sourcing-robots-matcher.test.mjs tests/sourcing-robots-redirects.test.mjs tests/sourcing-egress-invariant.test.mjs tests/sourcing-ohshi-mapping.test.mjs tests/sourcing-ohshi-bounds.test.mjs && node evaluation/check9-hermes-host.mjs --bundle evidence/hermes-host --json && node evaluation/check10-evidence.mjs --bundle evidence/eval-lane --json && node evaluation/freeze-files.mjs --manifest evaluation/MANIFEST-sourcing-v3.json --verify'` | blocking frozen gate |

## 5. Required assertions

### #1 — Live envelope and malformed-envelope honesty

Using only recorded responses through the production parsing seam:

- A valid non-empty `data` array produces exactly one mapped job per source row.
- `page.next_cursor` is recognized as the next-page cursor.
- `schema_version: "1.1"` is accepted.
- A valid empty envelope with `data: []` may return zero jobs.
- Missing `data`, non-array `data`, an unsupported top-level shape, or invalid JSON must fail with a non-empty typed error code.
- A malformed or unrecognized response must never become successful `{ jobs: [], partial: false }`.
- HTTP 4xx/5xx remains a typed upstream failure.
- No live network is used.

### #2 — Live row mapping

For recorded live rows:

- Nested `company.name` becomes the normalized company string.
- The result must not contain `"[object Object]"`.
- A legacy string-valued `company` remains supported.
- `summary` supplies a non-empty normalized `description`.
- `remoteStatus` and `roleFamily` survive with their source values through the observable adapter result.
- `company.sector` survives as sector.
- `publishedAt` supplies the normalized posting date.
- `sourceId` is preferred when present.
- The envelope row’s `id` remains available as separate source-record provenance when it differs from `sourceId`.
- `canonicalUrl`, `provider`, `status`, `firstSeenAt`, and `lastSeenAt` remain byte-for-byte faithful.
- Mapping must not invent compensation from sentinel text such as `"See posting"`.

### #3 — Saved-search identity and query contract

Through public saved-search creation and an injected transport:

- Different values of `q`, `role_family`, `location`, `remote_status`, `sector`, or `provider` produce distinct saved-search identities.
- Identical effective filter sets still deduplicate.
- Key insertion order does not change identity.
- Each non-empty configured filter is sent under its exact published query name.
- `new_since` is accepted, persisted, included in identity, and sent byte-for-byte.
- Two searches differing only in `new_since` are distinct.
- The request uses `/api/v1/intelligence`, `view=jobs`, and `status=verified_open`.
- The normal page limit is `100`, not `25`, while remaining at or below the published maximum of `100`.
- No credentials are required.

### #4 — Real MCP consumer path

Spawn the real bundled server:

```text
./bin/jobsss mcp --data <temporary PLUGIN_DATA>
```

The test must then:

1. Initialize the MCP server.
2. Create a profile.
3. Stage a recorded live-shaped v1.1 envelope under temporary `PLUGIN_DATA`.
4. Create an ohshi saved search referencing that staged recording.
5. Invoke `search_jobs` or the equivalent saved-search ohshi execution path.
6. Assert success with at least one imported/mapped job.
7. Assert the returned or subsequently listed job has:
   - the recorded title;
   - `company.name`, not `"[object Object]"`;
   - a non-empty posting body derived from `summary`;
   - the recorded canonical URL;
   - source `ohshi`.
8. Assert no network request occurred.

A direct call to `normalizeOhshiJob`, `fetchOhshiPublic`, or another module function is not a substitute. A fake MCP result or prose transcript is not a substitute.

### #5 — Bounded pagination and honest partial results

With injected transport and at least two recorded pages:

- The first request has no cursor.
- The second request carries the first response’s exact `page.next_cursor`.
- All configured filters, including `new_since`, remain unchanged on later pages.
- Each distinct returned row is mapped once.
- Exhausting the cursor with all reported rows read yields `partial: false`.
- Stopping at the page cap while another cursor exists yields `partial: true`.
- A repeated cursor terminates and yields `partial: true`.
- If `page.total` says more rows match than were read, the result yields `partial: true`.
- The implementation remains bounded to no more than 10 pages per run.
- No cursor cycle, malformed page, or cap may hang.

### #6 — Dual-shape compatibility

The additive parser must preserve the frozen offline contract:

```text
{ "jobs": [...], "nextCursor": "...", "attribution": {...} }
```

Assertions:

- Existing canonical fields preserve their current values.
- The frozen fixture remains network-free.
- `jobs` is not reinterpreted as the live envelope’s `data`.
- `nextCursor` continues to paginate.
- A complete single page remains non-partial.
- Existing attribution remains visible.
- This check must exercise product seams rather than duplicate parser logic in the test.

### #7 — Observable metadata and provenance

For the recorded live envelope:

- The observable adapter result carries `schema_version` or an equivalent `schemaVersion` value of `"1.1"`.
- Available page facts such as `total`, returned/read count, and the final cursor state remain inspectable enough to explain `partial`.
- CC BY 4.0 attribution and `https://ohshi.work/` remain present.
- If the envelope supplies more precise attribution text, that text wins over the fallback.
- `canonicalUrl`, provider, upstream status, source ID, source-record ID, and timestamps remain serialized; they may not exist only in temporary parser locals.
- JobSSS does not claim it independently verified the upstream listing.

### #8 — Frozen regression gate

The command must exit `0` without edits to any pre-existing reviewer-owned benchmark, test, fixture, helper, manifest, checker, or evidence contract.

No newly added test may shadow, skip, monkey-patch, rewrite, or conditionally disable a frozen check.

## 6. Keep-out

Do not build or add:

- JobOS or any JobOS runtime dependency.
- A new persona, agent, or advisor.
- A bulk ohshi JSONL or daily-export mirror.
- `/exports/jobs.jsonl` or `/exports/daily-changes.json` ingestion.
- A local replica of the ohshi corpus.
- New ATS readers or a generic ATS framework.
- Apply, submit, send, approval, attestation, browser, or form automation.
- A scheduler, daemon, polling service, or background sync system.
- A second MCP server or new MCP tool solely for this slice.
- A new npm dependency.
- A private Hermes testing API.
- Re-verification of ohshi rows by crawling their Ashby, Greenhouse, Lever, or other canonical URLs.
- Changes to human-only handoffs or authority boundaries.
- Edits to existing frozen sourcing fixtures to make them resemble the live envelope.
- Live-network assertions in any scored test.

## 7. Advisory live smoke — unscored

Run only after all offline checks pass:

```sh
node -e "import('./src/discovery.js').then(async ({fetchSavedSearchSource}) => { const out = await fetchSavedSearchSource({adapter:'ohshi',config:{new_since:'2026-09-15T00:00:00Z'}},{}); console.log(JSON.stringify({jobs:out.jobs?.length,partial:out.partial,page:out.page,schemaVersion:out.schemaVersion ?? out.schema_version},null,2)); })"
```

Record the command, timestamp, HTTP outcome, returned job count, partial marker, schema version, and page facts.

This smoke is advisory because live inventory, policy, availability, and counts can change. Failure does not alter the score. Success cannot rescue a failed offline check.

## 8. Trap

The trap is fixing only `data` versus `jobs`. That produces a superficially green direct fetch while the product remains wrong: pagination can still stop after one page, nested companies can still stringify to `"[object Object]"`, the posting body can still disappear before scoring, and two saved searches can still collapse onto one identity. The acceptance boundary is the real MCP saved-search journey plus offline transport assertions—not a parser unit test and not a successful live curl.

## 9. Final verdict

PASS only when:

- At least 7 of 8 additive checks pass.
- Mandatory checks #1–#5 all pass.
- Blocking frozen check #8 passes in full.
- No frozen artifact was weakened or edited.
- No keep-out item was introduced.

Otherwise: FAIL.
