# Resume quality and candidate setup POCs

Two executable experiments, not a released runtime change. One canonical JobSSS
skill/server remains; source `src/` and native runtime bytes are unchanged.

## What each experiment does

1. **Template and QA**: real JobSSS MCP intake/tailoring -> Navy HTML -> measured
   local Chrome/Edge fitting -> one-page PDF/preview -> independent review ->
   exact-revision completion gate. Missing reviewer = pending; mechanical failure
   or unresolved findings = unresolved. Bounded repairs restore/remove attributable
   facts or select the existing source summary verbatim. No arbitrary rewriting.
2. **Candidate setup**: candidate-supplied structured notes -> labeled source
   resume + missing-fact questions + input/source hashes and original input record.
   Employment, projects/coursework, education and skills need no personal master.
   The canonical skill describes the conversational intake path. Candidate
   confirmation never masquerades as trusted proof verification.

Portable stages: `intake.mjs`, `render.mjs`, `contracts.mjs`. `run.mjs` owns MCP
composition, retry/no-progress limits and state. Only `reviewer.mjs` invokes the
optional Codex host executable. `accept-review.mjs` accepts a host-agent handoff
after checking current artifact hashes. Reviewer receipts are local attributed
metadata, not cryptographic identity attestations. Machine QA never approves or
submits an application.

All build outputs must be a subdirectory of caller-supplied `PLUGIN_DATA`, outside
the checkout. Keep candidate data, real job snapshots and model logs out of Git.
Browser profiles and attempt artifacts remain there for inspection. Use a fresh
output directory for each run. Node >=22; local Chrome/Edge; no npm dependencies.
Optional `codex exec` needs the user's configured account and supported model.

## Reproduce without a model account

From the repository root:

```sh
node --test --test-concurrency=1 tests/resume-pocs.test.mjs tests/reviewer-resume-pocs.acceptance.test.mjs
```

Set `JOBSSS_RESUME_BROWSER` to a local browser executable if auto-detection fails.
The E2E tests explicitly skip when it is absent; a skipped run is not evidence of
browser validation. They launch the actual MCP runtime and test tailor, revise,
render and batch entry points. Deterministic reviewer fixtures are labeled
`fixture`, never reported as a live model review. A sparse fictional candidate
correctly returns unresolved. Fresh dense runs compare semantic IR and measured
layout, not timestamps or PDF binary identity.

Synthetic inputs: `fixtures/sparse.json`, `typical.json`, `dense.json`, `job.txt`.
The bundled agent reference is `skills/jobsss/references/resume-quality/`.
The IXL snapshot JSON preserves the exact archived posting text/hash; pass it to
`--job` for actual-case replay. Candidate evidence stays in private local state.

## Run candidate setup and a live application

Use absolute paths in place of the shell variables below. `$PLUGIN_DATA` denotes
caller-selected isolated state, not the user's existing production store.

```sh
node experiments/resume-pocs/run.mjs intake --input notes.json --out "$PLUGIN_DATA/intake"
node experiments/resume-pocs/run.mjs build --source "$PLUGIN_DATA/intake/candidate-source.txt" --job job.txt --data "$PLUGIN_DATA" --out "$PLUGIN_DATA/run-1" --reviewer codex --model gpt-6-luna --effort max
```

Add `--codex /absolute/path/to/codex` when needed. No reviewer argument emits a
review request and leaves passing mechanical output `qa_pending`. A host agent
can inspect `review-request.json` and the page, then return an envelope containing
`report` and `receipt`:

```sh
node experiments/resume-pocs/accept-review.mjs "$PLUGIN_DATA/run-1" independent-review.json
```

The live model runner uses read-only sandboxing, an ephemeral session, a page
image and strict JSON schema. Each review has a model/effort/run ID receipt. At
most three reviews and sixteen measured layout candidates per review; each
browser process times out after 45 seconds and model after 180 seconds. No
parallel runs against one output directory. Receipt classification is explicit:
live / replay / fixture. A report cannot override mechanical failure. Changed
source, posting, IR, PDF, preview or rubric invalidates the review binding.

## Reproducibility contract and production boundary

Repeat the same archived inputs, runtime revision, rubric and browser version in
fresh state. Source/posting hashes, selected canonical IR and layout decisions
must match. PDF metadata/bytes and model wording may vary: use semantic regression
checks, exact-artifact hashes for individual reviews, and separate recorded-replay
from fresh live model evidence. Model reproducibility means reproducing the
procedure and evaluating its results, not promising identical stochastic output.

The HTML preview uses the same printable-width typography; it is not a PDF raster.
The real IXL acceptance run separately extracts PDF text and rasterizes the final
PDF for independent visual review. `/ToUnicode` is only a lightweight built-in
check; extraction is the stronger E2E check.

Production MCP tools still have their existing review contracts. They do not yet
enforce independent model QA; only the experimental orchestrator gates its own
manifest. Before shipping, integrate that gate across direct tools, comparisons
and batch readiness, move long model work outside store locks, package the adapter,
regenerate native evidence if runtime bytes change, and preserve human authority.
Do not present a POC manifest as a production artifact approval.

## Integration baseline

Branch: `poc/resume-quality-and-intake`. Baseline `13063568fe5f1544728a794f4d8ab0025644943b`
captures existing project changes from `fix/profile-import-recovery`; the original
checkout was not modified. Review POC changes against that baseline. Existing
frozen benchmark edits in the baseline are not part of this POC. New tests are
additive; reviewer-owned frozen tests must not be weakened.
