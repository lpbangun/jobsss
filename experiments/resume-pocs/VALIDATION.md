# POC validation — 2026-10-06

## POC and independent checks

On Windows with local Chrome, the command below passed **17/17**, no skips:

```sh
node --test --test-concurrency=1 tests/resume-pocs.test.mjs tests/reviewer-resume-pocs.acceptance.test.mjs
```

Coverage: no-master intake; deterministic sparse/typical/dense inputs; actual MCP
tailor/revise/render/batch; measured browser PDF; independent fixture review;
fresh-state semantic/layout replay; missing evidence; stale source/posting/IR/PDF/
preview/rubric bindings; blocking findings; source-summary/selection consistency;
no-progress stop; human approval/submission remain false. Fixture review is
explicitly distinguished from the live model acceptance below.

`node --test tests/agent-plugin-parity.test.mjs`: **10/10 passed** on Linux.
Generated Agent Plugins and Codex reference assets were rebuilt mechanically;
peer products used their already pinned commits without advancing install pins.

## Actual IXL role

Public job snapshot: `fixtures/ixl-recruiting-specialist.job.txt`.
Exact replay text (including original line endings):
`fixtures/ixl-recruiting-specialist.job.snapshot.json`, accepted by `--job`.
Sanitized run metadata: `ixl-acceptance.json`.

Actual candidate evidence was retained privately outside Git. The live
`gpt-6-luna` / `max` adapter reviewed the page, requested a safe source-summary
repair, and passed the new render on the second review. A separate independent
Luna Max code reviewer also inspected the final PDF raster and passed it.

Final PDF: one Letter page, 381 extractable words, 92.59% content-height fill,
9.5pt minimum body type, no clipping/literal Markdown. Stronger PDF text
extraction and actual raster inspection supplemented the lightweight renderer
checks. Required qualifications absent from the source are recorded as fit
gaps, not invented or treated as automatic resume-QA defects.

## Prescribed existing suite

The full AGENTS test command ran unchanged. An initial run found a checkout-name
assumption and an unpinned Node on PATH. Repeating in a checkout named `jobsss`,
with the lock's official Node 22.22.3 archive and executable SHA-256 verified,
produced **48/49 passed**. Release and cross-platform checks passed.

Remaining failure: B34 Hermes adapter status. `compat/matrix.json` records
`verified`, but the isolated current-host probe reports `unverified`. The first
run timed out probing Hermes. This is not reported as a green release suite;
no frozen test, compatibility matrix, or runtime code was changed to conceal it.
The identical Hermes status mismatch was independently reproduced on the
pre-POC baseline with the same pinned toolchain (adapter suite: 3 pass, 1 fail).

The independent reviewer also established pre-POC failures in B80/B81/B82/B84
composition tests against the captured integration baseline. Those assertions
are unchanged and outside this POC's new acceptance tests.

## Reproduction and limits

See README for exact commands and prerequisites. Compare deterministic source,
posting, IR and measured layout; bind each live review to its actual PDF/image.
Model prose and PDF metadata are not promised byte-identical. Model review
requires host capability; missing capability yields pending, never a fake pass.

This is a POC branch, not a production release. Canonical `src/`/`bin/` bytes and
native evidence remain unchanged. Direct production tools do not yet enforce
the experimental agent review gate. Human approval and external submission are
separate and were not performed.
