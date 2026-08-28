# CRITIQUE_3 — JobSSS additional convergence iteration 3

Environment: `node -v` → `v22.22.3`. Provider keys unset. JobOS absent from
PATH via the frozen live-MCP trap. Isolated `PLUGIN_DATA` only. No TUI, no
Ink, no box-drawing renderer.

Reviewer session: additional iteration 3 of maximum 5. Original freeze was
the inspectable FAIL baseline against committed HEAD `30047e4` (product not
edited at freeze). This artifact now records the later PASS after product
normalized-equality/exact-quote correction plus a reviewer-owned B28
test-defect correction. Reviewer did not edit product.

Committed HEAD under review at freeze: `30047e422ad3ecab12241192bba2fb7071742c2d`
(`30047e4` Close terminal workflows and redact canonical state).

**VERDICT: PASS**

B1–B29 hold. Frozen command exit `0`, `# tests 31` `# pass 31`. B28
substring/exact-evidence assertions pass. Restart `$10M`/`400%` assertions
now target the actually fabricated field(s).

---

## Defect (genuine, blocker)

`src/relationships.js` `draftInterviewStory` grounds every STAR content field
by normalized **substring inclusion**, not by normalized equality to the
complete owned proof wording:

```js
const matching = normalizedField ? proofEntries.filter(entry => entry.text.includes(normalizedField)) : [];
```

`fieldEvidence` records only `{ status, matchedProofPointIds, supportedByProofText }`.
It does not record a verbatim proof summary/quote.

Existing B28 (title/reflection `$10M`/`400%` fabrication and partial invented
STAR text) stayed green on HEAD. The auditor hole is therefore real, not a
benchmark defect invented to make CI green.

---

## Live MCP probe on HEAD `30047e4` (before freeze)

Command: `node /tmp/jobsss-b28-probe.mjs`  
Uses reviewer helper `tests/helpers/jobsss-live-mcp.mjs` against real
`./bin/jobsss mcp --data <temp PLUGIN_DATA>`. Exit 0 (probe script; product
behavior is the evidence).

Owned 30% proof extracted from `tests/fixtures/profile-resume.md`:

- id: `proof_3256e43789f02cef`
- summary: `Led discovery with educators and operations teams to prioritize an AI-assisted learning workflow that reduced manual review time by 30%.`

| Draft | Result on HEAD |
| --- | --- |
| Every field `30%` | `grounded=true`, `groundingStatus=exact_proof_text_needs_human_verification`; each field `status=grounded` with `matchedProofPointIds=[proof_3256e43789f02cef]`; **no quote** |
| Title `Led discovery`, remaining fields exact proof | same: `grounded=true` / exact-proof status; title cites the proof id; **no quote** |
| Every field `reduced manual review time` | same substring false-positive |
| Every field exact complete proof wording | `grounded=true` (allowed) but `fieldEvidence` still has **no verbatim quote** |
| Title `$10M` / reflection `400%` | `grounded=false`, unsupported title/reflection already cite none (preserved B28) |

Persisted store stories matched the MCP payloads.

---

## Frozen commands (recorded, not invented)

### Pre-strengthening B28 hole is green

Command:

```bash
node --test --test-concurrency=1 tests/jobsss-integrity.test.mjs
```

EXIT: `0`  
`# tests 4` `# pass 4` `# fail 0`  
B28 passed. B26/B27/B29 passed.

### Strengthened B28 fails on the same HEAD (no product edit)

Command:

```bash
node --test --test-concurrency=1 tests/jobsss-integrity.test.mjs
```

EXIT: `1`  
`# tests 4` `# pass 3` `# fail 1`

Fail output (truncated as printed):

```
not ok 3 - B28 interview-story grounding covers title and reflection and never marks partial text grounded
error: 'short substring/fragment of a proof must not be marked grounded: {"storyId":"story_91a66cacf2dddccc",...,"title":"30%","situation":"30%","task":"30%","action":"30%","result":"30%","reflection":"30%",...}'
operator: 'notStrictEqual'
```

B26, B27, and B29 still pass. No tests were deleted or weakened.

### Frozen validation command

Command:

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

EXIT: `1`  
`# tests 31` `# pass 30` `# fail 1`  
Only B28 failed. Same substring assertion:
`short substring/fragment of a proof must not be marked grounded` with every
content field `30%`.

---

## Reviewer freeze (iteration 3)

B1–B5 and B6–B27/B29 are unchanged. B28 existing fabrication/partial/exact/
restart requirements remain. Appended:

- A short substring/fragment of an owned proof must not be grounded.
- Only normalized equality to the complete owned proof wording may ground a field.
- Every grounded field must record exact supporting evidence: `proofPointId` plus verbatim proof summary/quote.
- Unsupported fields must cite none.
- Substring-only drafts that persist must remain ungrounded after restart and cite none on fragment fields.

`tests/jobsss-integrity.test.mjs` frozen hash:
`b47dd8c003decfb58f7874819e696ea6e8e1c72d5c4243910defc98bb6605b88`
→ `5e465de4f6eb134780c17da09c259cb270605f5f3b4c421276253892a26bd750`.

Correction log entry: `2026-08-28T04:27:49Z` **B28 iteration-3 strengthening**.

This freeze subsection is FAIL evidence against HEAD `30047e4`. It is not the
current PASS ledger row. The later test-defect correction and re-run below
record exit `0` plus B28 substring/exact-evidence success.

---

## Residual risks (freeze-time, against HEAD `30047e4`)

- Product still uses `String.includes` on normalized proof text in
  `src/relationships.js`. Implementer must switch to normalized equality
  against the **complete** owned proof wording. Do not keep a “long enough
  fragment” heuristic.
- Grounded `fieldEvidence` must add a verbatim quote equal to the complete
  proof summary, not only `matchedProofPointIds`.
- Mixed drafts (exact STAR + fragment title) currently ground the whole story;
  strengthened B28 forbids that.
- Current normalize strips to `[a-z0-9$%]`, which is why `30%` matches. Equality
  must still be to the complete owned wording, not to a metric token.
- Fabricated `$10M`/`400%` fields already cite none; do not regress B28’s
  original fabrication case while fixing substring matching.
- Domain, MCP, ACP, and onboarding stay. Do not rebuild them. Do not resurrect
  the box-drawing renderer or copy the Ink-spike theme.
- No product edit in this iteration; missing behavior remains a fail until
  implementer correction.

---

## Test-defect correction (same additional iteration 3)

Product now uses normalized equality (`entry.text === normalizedField`) and
exact `fieldEvidence` quotes. Reviewer did not edit product. Running integrity
against that runtime exposed a genuine **new-test defect** at restart, not
missing product behavior.

Command (before test correction):

```bash
node --test --test-concurrency=1 tests/jobsss-integrity.test.mjs
```

EXIT: `1`  
`# tests 4` `# pass 3` `# fail 1`

Fail output (truncated as printed):

```
not ok 3 - B28 interview-story grounding covers title and reflection and never marks partial text grounded
error: 'restart fabricated title must cite no proofPointId: {"status":"grounded","matchedProofPointIds":["proof_2b140e4079f51bc6"],"evidence":[{"proofPointId":"proof_2b140e4079f51bc6","quote":"Led discovery with educators and operations teams to prioritize an AI-assisted learning workflow that reduced manual review time by 30%."}],"supportedByProofText":true}'
operator: 'deepStrictEqual'
stack: assertFieldCitesNone ... tests/jobsss-integrity.test.mjs:704:5
```

Cause: the restart loop selected any story whose blob contains `$10M`/`400%`,
including the partial-action story (`action` invents `400%`; `title` /
`reflection` are exact owned-proof wording), then unconditionally demanded
title/reflection cite none. That contradicts B28: fabricated fields cite none;
exact fields retain exact evidence.

Correction (tests only): fabricated title/reflection story checks
title/reflection; partial-action story checks action; exact fields on mixed
stories assert exact evidence. Substring and all other checks preserved. B28
spec text was not rewritten or weakened.

`tests/jobsss-integrity.test.mjs` frozen hash:
`5e465de4f6eb134780c17da09c259cb270605f5f3b4c421276253892a26bd750`
→ `cbad53a2de4fbb9a47b16a463cd578be84e4d1c11ff381658a7ccf6dfe08c57b`.

Correction log entry: `2026-08-28T04:34:10Z` **B28 restart field-targeting correction**.

### After test correction (recorded, not invented)

Command:

```bash
node --test --test-concurrency=1 tests/jobsss-integrity.test.mjs
```

EXIT: `0`  
`# tests 4` `# pass 4` `# fail 0`

Frozen validation command:

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

EXIT: `0`  
`# tests 31` `# pass 31` `# fail 0`

B28 substring, exact-evidence, fabricated title/reflection, and partial-action
checks all passed. No tests were deleted or weakened.

---

## Residual risks

- Pre-restart persist loop still uses a `$10M`/`400%` blob filter and demands
  title/reflection cite none. It currently runs before the partial-action
  draft exists, so it is safe today. Reordering those drafts would revive the
  same field-targeting defect.
- Domain, MCP, ACP, and onboarding stay. Do not rebuild them. Do not resurrect
  the box-drawing renderer or copy the Ink-spike theme.
