# Application Runs Implementation Plan

> **For Hermes:** Use subagent-driven-development when available to implement tasks with separate review. This is an implementation aid, not a runtime dependency; serial implementation and Codex Desktop use the same contracts.

**Goal:** Add bounded, resumable Bulk Prep runs whose per-role cases reach locally verified readiness without agents submitting, sending outreach, or recording human attestations.

**Architecture:** Extend Jobsss's canonical store and existing decision authority with a fixed case lifecycle, not a DAG engine. Hosts perform bounded production/review work and return evidence; the conductor commits validated checkpoints through Jobsss. Markdown/JSON run views are derived projections, never another state authority.

**Tech Stack:** Existing dependency-free Node ESM runtime, JSON persistence, stdio MCP, trusted-local CLI, node:test, generated Hermes and Codex packages.

---

## Inspection and constraints

Inspected root AGENTS.md, case-graph-engineering, jobsss-ops (read-only copy in the job-strategist profile), canonical skill, store.js, authority.js, composition.js, mcp.js, cli.js, workspace.js, Codex pack manifest/generator, and relevant test surfaces.

- Repository: `/home/pb_logani/projects/Jobsss plugins/jobsss`; branch `fix/profile-import-recovery`; inspected HEAD `a40a19b`. Substantial unrelated tracked/untracked work already exists. Do not reset, stage, commit, or regenerate over it indiscriminately. Before implementation, use an isolated worktree with an explicitly captured integration baseline; a worktree off HEAD alone would omit the current workspace/onboarding changes.
- `src/store.js`: schema 2; additive collections; exclusive PID lock; expectedRevision validation; canonical store written last; confined/redacted derived projections. Exception rollback is supported, cross-file hard-kill atomicity is explicitly not promised.
- `src/composition.js`: existing up-to-five-job preparation, per-item failure isolation and deduplication. It invokes public operations and stores its batch summary only after the loop. It has no durable stage/gate/QA lifecycle. It also includes networking drafts, which Application Runs must not invoke.
- `src/authority.js`: human decision CLI bound to entity revision/content hash; MCP only requests/lists handoffs. Preserve existing actions and records. Agent-supplied actor labels are not authority.
- `src/workspace.js`: current uncommitted onboarding supports a local shared data directory and Codex configuration; runtime snapshots do not auto-update.
- Codex pack: generated canonical runtime/skill copies with thin Node launch adapter; MCP inherits PLUGIN_DATA, since this adapter does not interpolate it in args. Do not hand-edit its mirrored runtime.
- case-graph-engineering's personal paths, model pin, worker count, and voice thresholds are not product defaults. jobsss-ops's personal tracker/mirror is not canonical run state.

## 1. Persistence and fixed lifecycle

**Files:** create `src/application-runs.js`; modify `src/store.js`, `src/projection.js`; add `tests/application-runs-state.test.mjs` (do not edit frozen reviewer tests).

Add an `applicationRuns` collection, losslessly initialized for existing schema-2 stores. Use a versioned run contract (`jobsss.application-run/v1`) rather than changing existing application IDs/status semantics. Validate future contract versions before mutation.

One run owns a bounded selected slate (initial maximum five, matching existing batch bounds), profile ID, captured policy/version, slate hash and decision, per-job cases, batch-QA results, and audit references. Cases link existing job/application/artifact IDs; never copy the application into a competing record.

Fixed stages:

`research_live_check → fit_disposition → packet → qa → ready_for_human_submission → awaiting_receipt_confirmation → receipt_confirmed`

Run creation starts at `awaiting_slate_approval`, before production. Each case has a distinct stage and disposition (`active`, `blocked`, `dropped`, `needs_decision`); a blocker does not erase its last valid checkpoint. Typed failures include `no_live_role`, `state_lost`, `form_changed`, `submission_uncertain`, plus explicit validation/capability failures. A missing live-check capability is not evidence that a role is closed.

For every checkpoint retain: input fingerprint (profile/source/policy), artifact IDs and store-relative paths/hashes, outcome, producer/verifier provenance, attempt/idempotency key, case revision, and timestamp. Append from/to transition events to the canonical audit. Repeated identical requests/results return the existing checkpoint; conflicting reuse of a key fails. Resumption revalidates evidence and returns only eligible incomplete work. Changed inputs invalidate downstream readiness without deleting historical artifacts or human decisions.

Generate `runs/<runId>/RUN_STATE.md` and a structured run view through existing safe projection descriptors. They are rebuildable from store.json. Summary derives ready / blocked / dropped / needs decision counts plus active work and confirmed receipts; counts must reconcile to the full slate.

**TDD checks:** fresh and legacy stores; owned IDs; bounded slate; invalid/skipped-stage transitions; per-case failure isolation; replay/conflict; stale revision; projection confinement; unchanged legacy applications and decisions.

## 2. Three durable human boundaries

**Files:** modify `src/authority.js`; test `tests/application-runs-authority.test.mjs`.

Extend existing trusted-local decision dispatch with run-bound slate approval, case-bound submission audit/observation, and receipt confirmation. Bind slate decisions to the selected jobs/policy hash and submission decisions to current packet/audit hashes. Editing either makes prior bindings stale. MCP may expose the handoff but cannot complete these decisions, even through actor flags or extra fields.

- Gate 1: approve/reject slate; no production before approval.
- Gate 2: show the durable audit list, preserve unresolved restricted answers, and require human review plus the actual human Submit click outside Jobsss. Record a human observation only; Jobsss never clicks or transmits. Audit acknowledgement alone cannot imply submission.
- Gate 3: require human confirmation with receipt evidence/reference before receipt-confirmed state. An uncertain click/outcome becomes `submission_uncertain`, not submitted.

`ready_for_human_submission` means prep/QA is complete and Gate 2 is still pending. Never map it to submitted/applied. Preserve existing proof/content/visual-review safeguards; do not bypass them to reduce ceremony. Present relevant unresolved review requirements together in the submission-boundary audit rather than introducing a fourth run gate.

**TDD checks:** MCP cannot approve slate, attest submission, confirm receipt, or reuse forged authority; stale packet/slate decisions fail without mutation; audit acknowledgement does not submit; receipt confirmation requires evidence and proper predecessor; human decision on one case does not invalidate unrelated cases.

**Trust limitation:** the existing trusted CLI is a procedural human boundary, not an OS-level mechanism that distinguishes a human from an agent with shell access. Do not claim stronger authentication. Host instructions must forbid agents from executing decision completion commands; stronger interactive authority would require a separately reviewed change.

## 3. Minimal supported interfaces and execution

**Files:** `src/application-runs.js`, `src/mcp.js`, `src/cli.js`, `src/workspace.js`; test `tests/application-runs-interfaces.test.mjs`.

Proposed four MCP tools:

- `create_application_run`: profile, selected job IDs, request key, validated local policy; persists pending slate approval.
- `inspect_application_run`: list or inspect owned runs, checkpoints, summary, handoffs, capabilities.
- `resume_application_run`: bounded next-work manifest from canonical state; no hidden scheduler or unattended loop.
- `checkpoint_application_run`: conductor-only logical join accepting a typed stage result/failure, expected case revision, task/input binding, artifact/evidence references, provenance, and idempotency key. Not an arbitrary status setter.

Expose equivalent `jobsss runs create|inspect|resume|checkpoint` CLI dispatch sharing handlers, for hosts without MCP. Use validated JSON input, not shell interpolation of artifact text. Extend workspace wrapper data injection for `runs`. Human gate completion stays under `decide` only.

Reuse existing score/material functions and registered artifacts. For built-in preparation, persist artifacts and checkpoint together using store-local operations through commitStore where possible. Where an existing public call commits first, reconcile the exact artifact fingerprint on restart before generating again. Tests must exercise the artifact-created/checkpoint-not-yet-committed window. No outreach steps from the old batch composer.

Workers receive immutable task bindings and unique output destinations; return artifacts/results without store-write or decision authority. The conductor validates and joins them. Serial hosts execute one manifest item at a time. Parallel hosts may accelerate independent cases; no shared writable output and no required concurrency setting. Existing `prepare_applications_batch` remains backward-compatible and is not relabelled as a gated run; share narrow preparation helpers only where justified.

## 4. Separate QA and configurable policy

**Files:** create `src/application-run-qa.js`; add `tests/application-runs-qa.test.mjs`; integrate run resume/checkpoint handlers.

Packet production and verification are separate recorded stages. QA binds the exact packet hashes and checks source-backed claims, missing/restricted answers, required documents, artifact availability, and applicable existing PDF QA. With independent workers available, reject verification by the producer identity. In serial mode record separate-pass/self-review explicitly: it is not independent-worker verification. Policy can require independent verification, in which case absent capability yields a durable blocker; never fake independence.

Provide bounded built-in batch checks for configurable shared word runs, overlap thresholds, and banned phrases. Persist checked membership, policy hash and packet hashes. Pairwise failures affect only implicated cases; truly global checks hold the relevant cohort. Blocked/dropped jobs without packets do not hold unrelated eligible cases. Adding/changing a packet invalidates applicable cohort QA. Avoid arbitrary command-execution hooks or importing a personal voice script.

Capture configurable profile/answer policy, letter-check thresholds, required packet formats and evidence freshness in the run. Unknown policy fields/invalid values fail. Defaults retain product truth/safety rules, not personal voice targets or model/provider pins.

Report host-declared worker availability separately from runtime-detected capabilities (local PDF renderer, supported integrations). Unknown workers/live-check availability is `unknown` or unavailable, never inferred from host name. Live research evidence must carry source, capture time, content hash and live/replay/fixture classification; fixture evidence cannot satisfy production live currency.

## 5. Portability, documentation and packaging

**Files:** canonical `skills/jobsss/SKILL.md`; new `skills/jobsss/references/application-runs.md`; update `references/client-compatibility.md`; generated package mirrors only via existing scripts.

Document Bulk Prep in Hermes and Codex Desktop with the same tool sequence, serial fallback, optional parallel worker contracts, resume by run ID, three human handoffs, policy and capability readback. Explicitly configure both hosts to the same canonical store; a read-only mirror or a newly initialized second workspace is not cross-host resume.

The current PID lock does not establish cross-OS process liveness between Windows and WSL. Initial cross-host support is sequential handoff with one writer and a cleanly stopped previous host, not simultaneous cross-OS writes or cloud-synced multiwriter stores. A same-OS stale/live lock remains protected. Test native path resolution separately; Windows and WSL may name the same directory differently.

Regenerate `agent-plugin/` and `codex-pack/` using existing builders only from the agreed integration baseline, preserving pinned companion products. Validate inventory/cachebuster/parity and local workspace snapshots. Runtime changes invalidate native evidence: regenerate `evidence/native-validation.json` with pinned official inputs and update report hashes, never weaken frozen tests.

## 6. Verification and acceptance evidence

Add non-frozen suites listed above plus `tests/application-runs-e2e.test.mjs`.

1. Test a three-role fixture batch: two complete research/fit/packet/QA, one typed live-role blocker; demonstrate unaffected cases ready. Clearly label fixture research and simulated human gate inputs.
2. Stop after one committed packet; launch a fresh process/host adapter, resume same store/run, finish QA, and compare artifact/application IDs and hashes: no duplicates or lost completed work.
3. Inject a kill after material persistence but before checkpoint; reconcile on restart. Test stale/missing/mutated artifacts and rebuildable projection drift separately. Do not promise cross-file crash atomicity beyond tested recovery.
4. Negative cases: stage skipping, wrong ownership, conflicting idempotency keys, stale worker output, forged human claims, producer-as-independent-verifier, incomplete batch QA, receipt without evidence.
5. Run the identical MCP scenario through canonical/Hermes package and Codex package launch surfaces against one test store; this is interface testing, not real host proof.
6. Run a real Hermes-host tool exchange and a real Codex Desktop-host journey in isolated test workspaces, including sequential cross-host resume. Record host version, store identity, calls/results and worker availability. If a real host cannot be exercised, label it unverified and leave that acceptance criterion open.
7. Re-run existing persistence/authority/composition/package/workspace suites and the root AGENTS.md regression command, then native evidence checks using locked inputs. Preserve all reviewer-owned benchmarks.

Focused new-suite command:

`node --test --test-concurrency=1 tests/application-runs-state.test.mjs tests/application-runs-authority.test.mjs tests/application-runs-interfaces.test.mjs tests/application-runs-qa.test.mjs tests/application-runs-e2e.test.mjs`

For each implementation slice: add failing tests, observe RED, implement minimum shared behavior, observe GREEN, review safety/store preservation, and commit only that slice's explicit paths after resolving the dirty baseline. Do not publish/install into live user profiles or write live application data as part of testing.

## Baseline actually executed (before feature changes)

- Node `v26.10.0`.
- `node scripts/build-codex-pack.mjs --check`: verified inventory, 65 files; not a Codex Desktop execution.
- Persistence + authority suites: 9 passed, 0 failed.
- Root-required regression set plus composition, agent-plugin parity and workspace-init: 69 tests, 61 passed, 8 failed.
- Existing failures: B34 Hermes compat-probe timed out; B80/B82/B84 batch fixtures produced partial packets with zero requirement matches; B81 attempted approval without required resume PDF QA; B30/B31/B32 refused the current Node executable because it is not the locked official Node 22.22.3 input. Root causes of the composition fixture mismatches have not been established.

These are baseline failures, not Application Runs regressions. Resolve/reproduce them in the agreed integration baseline; do not change frozen tests or safety gates to manufacture a green result. No real Application Runs host demo has happened because the feature is not implemented.

## First-deliverable scope

This plan is the only authored file. No runtime/architecture changes, store migrations, external submission/outreach, or package regeneration were performed. Implementation begins after this proposed architecture is reviewed; remaining work is the feature, baseline triage, full acceptance tests, and real host demonstrations.
