---
name: jobsss
description: Standalone job-search skill for offline local workflows over the bundled ./bin/jobsss MCP runtime and PLUGIN_DATA — profile/preferences, secure staged/inline job & contact intake, discovery, scoring, pipeline, materials, tasks, networking drafts, interview prep, and sync preview, without requiring external services or API keys.
---

# JobSSS — standalone bundled runtime

JobSSS is a self-contained Agent Plugin with a bundled runtime. It runs locally
via `./bin/jobsss mcp --data ${PLUGIN_DATA}` and persists all user state under
the host-provided `PLUGIN_DATA` directory. No legacy executable, API keys, or network access are required for the core journey. The runtime works offline; no external executable is spawned or imported at runtime.

`/jobsss` with no intent shows help and a next-action menu. Never fabricate
execution or authority. Do not claim, invent, fabricate, or pretend that a job,
score, proof, send, submission, approval, or applied attestation succeeded. Never
claim submission, sending, approval, or deferred/future capability.

Recommended next action: on a fresh workspace, run `/jobsss start` to
initialize durable state under `PLUGIN_DATA`; then follow the core journey
below in order. Recommend exactly one next action at a time and confirm it with
the real bundled MCP result before proposing the next step.

What JobSSS does, and what it never claims:
- local preparation — every MCP tool below prepares, drafts, plans, or records
  state locally under `PLUGIN_DATA`; none sends, submits, applies, approves, or
  attests externally;
- human observation — only a human records an externally observed application
  status (or an outreach outcome) on the trusted local surface
  `./bin/jobsss decide`, and that record is attributed to the human, never to
  JobSSS;
- unsupported / deferred — external sending, application submission, interview
  scheduling or attestation, packet freezing, and browser automation against sites are
  blocked, out of scope, and never claimed.

## Core journey (offline, local, no API key)

| Invocation | Route |
| --- | --- |
| `/jobsss` | base — Help / next-action menu. Never fabricate execution or authority. |
| `/jobsss doctor` | MCP `doctor` — diagnose the bundled `./bin/jobsss` launcher and `PLUGIN_DATA` readability/writability. No external executable on PATH is required. |
| `/jobsss start` | MCP `start` — initialize durable state under `PLUGIN_DATA`. Creates the local store if absent. |
| `/jobsss profile` or `create_profile` | MCP `create_profile` — create or import a local profile/resume (`name` plus optional resume text or a path under `PLUGIN_DATA`), extracting proof-point candidates for human verification. Returns `profileId`. Pass the source resume text unchanged (keep `Name:`, employment/skills/education headings, and dated role lines). Do not reformat into unlabeled pipe-only prose; the parser still accepts reasonable unlabeled variants. Achievement bullets may sit under the employment heading or in a separate achievements section, and skills/education sections do not need `Production:`/`Education:` label prefixes. |
| `/jobsss find` or `import_job` | MCP `import_job` and `list_jobs` — import job content inline (`text`/`content`) or from a path under `PLUGIN_DATA`, then list imported jobs. Re-importing the same job deduplicates to a single job id. |
| `/jobsss score` or `score_job` | MCP `score_job` (`jobId`, `profileId`) — deterministic local scoring returning `overall` and/or `scoreStatus`. No API key required. |
| `/jobsss pursue` | MCP `pursue_job` (`jobId`, `profileId`) — record local pursuit and prepare a basic readiness artifact for review; never submits, sends, or applies. |
| `/jobsss pipeline` | MCP `applications_plan` and `list_jobs` — local pipeline/readiness for a job; never claims submitted/sent/applied. |
| `/jobsss review` | MCP `review_queue` (`profileId`) plus `list_decision_handoffs` — show local review state and pending decision handoffs, then route the human to the trusted local surface `./bin/jobsss decide --data ${PLUGIN_DATA} --list` for completion (see references/client-compatibility.md). |

Required MCP tools for this journey (all operate under `PLUGIN_DATA` via
`./bin/jobsss mcp --data ${PLUGIN_DATA}`): `doctor`, `start`,
`create_profile`, `import_job`, `list_jobs`, `score_job`, `pursue_job`,
`applications_plan`, `review_queue`. See `references/standalone-journey.md`
for argument shapes and persistence details.

For human-only operations, follow [Human-only handoffs](references/human-only-handoffs.md).
Those tools are not available to MCP and must not be reported as done. Approval,
send, submit, and packet-freeze language is handoff-only via trusted CLI/TUI.

MCP callers may create and list non-authoritative decision requests via
`list_decision_handoffs` and `create_decision_handoff`; they cannot complete or
forge a human decision. Only the trusted local surface `./bin/jobsss decide
--data ${PLUGIN_DATA}` completes proof verification, artifact approve/reject,
contact approve/suppress, story verify/retire, debrief record/correct,
outreach sent/outcome, and externally observed application status (see
references/client-compatibility.md).

## Extended local workflows (all offline, all under PLUGIN_DATA)

These bundled MCP tools extend the core journey. They run locally without external services or API keys and do not require an external executable on `PATH`. Route them by MCP
tool name or natural language; do not add stable slash sub-intents for
networking, interview planning, or scheduling. External sending, scheduling,
and browser actions stay blocked or human-only.

| Workflow | MCP tools | Notes |
| --- | --- | --- |
| Secure intake | `import_job` (inline `text`/`content` or a path under `PLUGIN_DATA`), `import_job_url` (fetches public HTTP(S), rejects `file:`/private URLs), `import_contact` (inline card, inline `contact-brief.v1` JSON, or a `PLUGIN_DATA` path), `list_contacts` | No arbitrary absolute filesystem paths are read. Re-importing the same job deduplicates to one id, and a repeat or address-less contact re-import reconciles onto the existing logical contact instead of duplicating it; an address-bearing contact re-import also reconciles the unprotected address-less machine duplicate an older release left beside it. |
| Migration & state | `start` | A legacy `store.json` migrates losslessly into versioned persistence with an audit trail; never drop or rewrite ids. |
| Profile & preferences | `create_profile`, `list_profiles`, `update_profile`, `archive_profile`, `restore_profile`, `list_resumes`, `get_resume`, `add_proof_point` | Versioned structured resumes, preferences, and proof candidates remain profile-owned and require human verification. Reimport with an explicit `profileId` when known; an unfamiliar name sharing an email produces `identityCollisionProfileIds` rather than overwriting a profile. Correct parsed `resumeIdentity` with `update_profile`. Archive/restore require the current `expectedRevision` and preserve audit history. `get_resume` is a read-only restart readback that returns the full current resume text and identity. |
| Discovery & saves | `create_saved_search`, `list_saved_searches`, `search_jobs`, `daily_discovery`, `save_job`, `skip_job`, `archive_job`, `list_jobs` | Fetch public Greenhouse ATS boards by `boardToken`, or select the public ohshi.work intelligence saved-search source with query filters; staged offline search data under `PLUGIN_DATA` is also supported. ohshi data is CC BY 4.0 and must retain attribution. Discoveries stay database-only until saved/pursued. |
| Scoring | `score_job`, `get_score` | Offline deterministic multidimensional fit (`jobsss.fit-score.v1`) with all seven weighted dimensions; no API key. `get_score` is a read-only restart readback of the stored fit/eligibility/constraints for an owned job. |
| Lifecycle & tasks | `pursue_job`, `applications_plan`, `update_application_status`, `list_tasks`, `update_task` | Local pipeline and next actions. `update_application_status` rejects `applied`/`submitted` — it cannot attest submission. |
| Materials | `inspect_resume_requirements`, `tailor_resume`, `revise_resume`, `render_resume`, `inspect_resume_qa`, `list_resume_designs`, `compare_resume_designs`, `list_resume_design_variants`, `select_resume_design`, `inspect_cover_letter_brief`, `draft_cover_letter`, `revise_cover_letter`, `save_answer`, `list_answers`, `match_answers` | Resume drafting uses one canonical document for normalized and migrated legacy profiles. Revise by preferring or suppressing source-linked claim IDs, then inspect requirement spans and the stored PDF QA before human review. Compare navy, editorial, and scan PDFs from the same content; a local style selection does not prove external use or a better outcome. Cover-letter briefs are read-only; revisions require the current content hash and explicit active proof IDs. Answers use exact owned proof wording; never arbitrary claims, invented metrics, auto-fill, or send. `save_answer` accepts only `sensitivity: public \| personal \| sensitive \| restricted` (default `personal`) and `reuseScope: global \| employer_specific \| never_auto_fill`; other values fail with typed `invalid_sensitivity`/`invalid_reuse_scope` for the caller to correct. |
| Networking drafts | `record_research`, `list_research`, `map_reachable_network`, `plan_outreach`, `draft_outreach`, `list_outreach` | Local people/company research, maps, plans, follow-ups, and drafts only. Sending stays human-only; `mark_outreach_sent` is not MCP. |
| Interview prep | `draft_interview_story`, `list_interview_stories`, `interview_prep`, `get_interview_prep`, `interview_debrief_handoff` | Local story drafting, preparation, coverage gaps, and a non-attesting handoff. Verification/debrief confirmation stays human-only via trusted CLI/TUI. |
| Sync preview | `preview_sync` | Dry-run, secret-safe preview of derived/export data. No automatic or cloud sync. |
| Host composition (multi-job preparation) | `prepare_applications_batch`, `record_contact_discovery`, `list_preparation_batches`, `list_contact_discoveries` | One bounded local request prepares up to five owned jobs for one profile (score → pursue → tailor materials → record host-supplied people evidence → unsent outreach draft → tracker/next actions) with honest per-item statuses. JobSSS never searches for people or jobs here: the host supplies people evidence (people-finder / contact-brief) and it is recorded, joined, and projected. A contact miss is non-fatal and carries a structured reason code. Re-running the same request reuses the same records instead of duplicating jobs, contacts, drafts, or packets. Still no sending, no submission, no application. |

### Host composition: one request, many jobs

Use `prepare_applications_batch` when the user asks for several jobs to be
prepared in one go ("select the best five eligible jobs for my profile and
complete preparation for every selected job"). Route it by MCP tool name or
natural language; no slash sub-intent is needed.

- Provider-neutral by design: the tool selects from jobs already in the local
  store, never fetches a board or a people provider, and never invents a
  person. People evidence arrives in `contacts[]` (`subjectName`,
  `subjectCompany`, `role`, `email`, `status`, `missReasonCode`, `class`,
  `provider`, `runId`) from the host plugin that owns discovery.
- Evidence class is mandatory: `class: live | replay | fixture`. `live`
  requires current-run metadata (`provider` plus `runId` or `capturedAt`) and
  `replay` must name the original run, so a replayed or synthetic payload can
  never be presented as fresh live discovery. A provider-reported address is
  recorded as `provider_reported`, never as a verified mailbox, and an
  unattributed address is refused.
- A contact miss is bounded preparation, not a failure: it is recorded with a
  structured reason code (`no_public_channel`, `not_found`,
  `identity_mismatch`, `uncertain`, `not_enriched`, `no_candidates`,
  `budget_exhausted`, `provider_error`, `timeout`, `rate_limited`,
  `replay_no_match`) and the job's packet still completes.
- Per-item status is honest: `prepared`, `partial` (for example no profile
  proof matches any extracted requirement), `failed`, `blocked`, `duplicate`
  (one logical employer/role/location posting), or `skipped` (an item the
  local record already closed). One item's failure never collapses the rest,
  and nothing is fabricated to reach a target count.
- Both entry points are equivalent: running `prepare_applications_batch` and
  running the individual tools (`score_job`, `pursue_job`, `tailor_resume`,
  `draft_cover_letter`, `import_contact`, `record_research`, `plan_outreach`,
  `draft_outreach`) in that order leave the same durable JobSSS state.
- The projection is deterministic: every local commit regenerates
  `profiles/<profileId>/profile.md`, `profiles/<profileId>/tracker.md`, and,
  per prepared job, `applications/<jobId>/application.md` (job/source
  snapshot, fit rationale, materials and their coverage gaps, checklist and
  review-gap truth, people/contact brief or miss, unsent outreach draft,
  outcome history), `resume.md`, `cover-letter.md` when one exists, and
  `applications/<jobId>/contacts/<contactKey>.md`. Human-only state
  (artifact approval, contact approval or suppression, recorded external
  outcomes) is preserved across regeneration and is never overwritten.
- On a new workspace, MCP `start` with `outputMode: "compact"` opts out of
  automatic JSON and Markdown projections. All state and history still live in
  `store.json`; use the MCP readback tools. Existing workspaces keep their mode.
  `draft_cover_letter` defaults to editable DOCX in compact mode and also
  accepts `format: "docx"` explicitly;
  text, Markdown, and PDF remain available.
- Read back at any time with `list_preparation_batches` and
  `list_contact_discoveries`; both are plain local reads from `PLUGIN_DATA`.


See `references/standalone-journey.md` for argument shapes and the frozen
human-only catalog.

### Applicant documents and fit/contact evidence

For a resume, follow [the resume workflow](references/resume-workflow.md).
Use `doctor.resumeRenderer` before `render_resume` with
`{profileId, jobId, contactEmail}`. A local Chrome/Edge executable
prints plugin-generated HTML from a local file. Return the actual `document.path`,
renderer, page count, and QA metadata. Missing browser returns
`resume_renderer_unavailable`; do not substitute the native material renderer.
The one-page Letter PDF remains under `PLUGIN_DATA`. Call
`inspect_resume_requirements` and `inspect_resume_qa`, then inspect the
source-linked draft, requirement gaps, searchable text, and rendered page before
sharing. Trusted approval requires PDF QA and verified cited proof points.
For a cover letter, start with the read-only `inspect_cover_letter_brief` to see
the job context, selected active proof, and any candidate-owned voice or company
context. The brief's suggested narrative is a starting point, not a claim or
approval. Use `draft_cover_letter` to establish a source draft, then author the
tailored prose from the brief and save it with `revise_cover_letter`. Choose
`format: "docx"` for an editable Word document or `format: "pdf"` for the native
PDF renderer. Searchable PDF text is an ATS-readability proxy, not an ATS guarantee.

Keep the imported resume as the fact source. Change preferences with
`update_profile`; never replace achievements with formatting instructions.
A real preference revision (for example the target role family) flows into
the tailored resume focus, so successive `tailor_resume` PDFs
stay distinct truthful revisions and both are kept under `PLUGIN_DATA`;
formatting-only changes regenerate the identical file.
Applicant copy excludes proof IDs, posting inventories, and human-review notes; those remain in the returned metadata and review artifact. Write cover letters in a natural first-person voice that fits the candidate's preferences and the role. `profile.preferences.coverLetterVoice` may contain `tone` and `style` (each at most 120 characters) and up to three `{label?, text}` writing samples (label at most 80 characters; text at most 2,000 characters each and 5,000 total). Samples are style references only: observe tone, rhythm, punctuation, and structure, but never copy their claims, names, or sentences as evidence. Prefer relevant, recent context if voice preferences conflict.

Choose a focused narrative from the job description and active, supported proof. Use employer research or a “why this role” angle only when recorded and confirmed by the candidate; do not invent company praise. Make the employer-specific point concrete enough that it could not be pasted into any application. State established evidence as past fact, then distinguish a proposed future contribution (what the candidate could help do). Never rewrite a posting requirement as an accomplishment. Write naturally with varied openings and sentence rhythms, usually three to five paragraphs as the material warrants; avoid a repeated template and do not force a fixed word count or bullet count. Include ordinary business-letter date and contact details when available.

For a finished tailored letter, compose a fresh narrative using the brief; do not present the deterministic starter as the final personalized prose. An evidence-first letter may open with a relevant result, a project-led letter with the work itself, and a career-bridge letter with a supported connection to the posting. Choose the structure for the job rather than randomly swapping synonyms. Preserve the authored or user-edited text with `revise_cover_letter`, supplying the source draft's current content hash and explicit active proof IDs. Treat each reviewed edit as a separate revision; later generation must not overwrite it. Keep human approval and any external use as separate decisions.

Use native `score_job.eligibility` and its grounded hard failures when making a
shortlist: excluded roles are not actionable high-fit recommendations. Missing
pay/currency/authorization evidence is not permission to assume eligibility;
preferred skills are not mandatory exclusions. Never invent exchange rates or
count bonus/equity toward a guaranteed-base floor.

Preserve contact relationship/source notes with `import_contact` and
`record_research`. `import_contact` reads a plain card or the documented
`contact-brief.v1` JSON natively (subject name/company/role plus the
attribution-labelled provider-reported address) from inline input or a
`PLUGIN_DATA`-staged path, so a host contact-brief handoff needs no restated
inline fields; the record stays `humanApproved: false` with the mailbox
`not_checked` and its attribution and provenance kept. A repeat import, or an
address-less import for a name/company that already has one machine-created
address-bearing record, reconciles onto the existing logical contact instead of
creating a second one — an address-bearing re-import also reconciles the
address-less machine duplicate an older release may have left beside it, keeping
that record's id and source metadata in the survivor's history — while
human-approved, suppressed, do-not-use, human-note, decision-ledger and
conflicting-address records are never collapsed. Maps and plans distinguish
cold professional email access, weak acquaintance, and channel-pending
stakeholders. A profile URL is not a messaging channel, and same-name people at
different companies are not merged. Recipient-facing subject/body stay separate
from internal notes. All drafts remain UNSENT; only trusted human actions
approve/suppress contacts or attest external outcomes.

## Conversational tailoring for an individual job

After resume upload, for individual-job material requests, call `inspect_tailoring_brief` before generating BOTH the resume and cover letter. This returns the current resume facts, active evidence, posting requirements, role-scoped reusable narratives, and per-job conversation. Ask the user what their thesis or point of view is about the target role and one or two things they like about this company. If a matching reusable role-family thesis exists, offer it for confirmation or editing rather than interviewing again. Let the user skip unanswered questions; never invent answers. Choose the role family with the user; do not assume a universal/global preference from a specific role.

Save the answers with `record_tailoring_context` using `{profileId, jobId, expectedRevision, context: {roleFamily, roleThesis?, companyInterests?: [string, string], feedback?}}`. Re-read the brief after a restart. Background facts remain in the uploaded resume and active proof inventory; newly stated achievements require the existing proof verification flow. Thesis, voice samples, interests and feedback are editorial guidance only, never candidate achievement evidence or verified employer facts.

Generate the resume with `tailor_resume`, then use its source-linked claim ledger and `revise_resume` to prefer or suppress grounded claims that support the user's role thesis and posting. Do not put company motivations or unsupported thesis assertions into the factual resume summary. For the cover letter, establish a draft with `draft_cover_letter`, author natural prose from the conversation, posting and cited active proof, then use hash-checked `revise_cover_letter` for an editable DOCX preview. Express company interests as the user's motivations and ground any company factual assertions in posting or recorded research. Neither material may invent metrics, credentials, job history or achievements.

Present BOTH drafts for editable review. Persist feedback in this job's context, revise the materials through their existing revision tools, and preserve earlier versions and final human approval. A one-off edit must not automatically change reusable preferences. Ask explicit confirmation of the exact thesis and/or voice AND role-family scope before `remember_role_narrative` with `confirmedByUser:true`, the current `expectedRevision`, and optional bounded `voice` (same shape as `coverLetterVoice`). This is a preference record, never proof verification or artifact approval. Company interests and feedback cannot be promoted by this tool. Role narratives are profile-owned and match only the explicitly selected role family.

For batch requests, retain `prepare_applications_batch`: do not require a per-company interview or create invented conversation answers. Conversation is an optional individual-job authoring flow, not a gate on bulk preparation. No sending or submission is performed.

## PLUGIN_DATA and bundled launcher

- The installing agent expands `${PLUGIN_DATA}` to an absolute writable data
  directory. The launcher honors `--data <dir>` and environment `PLUGIN_DATA`
  and persists only under that directory. No user state is written into the
  installed plugin directory.
- The MCP server is `jobsss` over stdio with command `./bin/jobsss` and args
  `["mcp", "--data", "${PLUGIN_DATA}"]`. No `env`, `cwd`, headers, or
  credentials are set in `mcp.json`.

## Doctor — bundled runtime diagnosis

For `/jobsss doctor`, diagnose whether `./bin/jobsss` is present and executable
and whether `PLUGIN_DATA` is set, absolute, and writable. If state is missing,
advise running `./bin/jobsss mcp --data ${PLUGIN_DATA}` and then `doctor` →
`start`. No legacy executable is required or should be placed on `PATH`;
do not invent or claim success, jobs, scores, proofs, sends, or submissions
while diagnosing. Do not claim, invent, or fabricate success.

## Out of scope — blocked or handed off

Local planning and drafting for these domains is available via the bundled MCP
tools above, but the external or authoritative action is out of scope, blocked,
or handed off to a trusted human and must never be claimed via MCP:

- network — out of scope and blocked (human-only handoff required; no autonomous outreach or `mark_outreach_sent`; local `map_reachable_network`/`plan_outreach`/`draft_outreach` never send).
- interview — out of scope and blocked (human-only handoff required; no `verify_interview_story` or similar via MCP; local `draft_interview_story`/`interview_prep` do not verify or schedule).
- scheduling — out of scope and blocked (human-only handoff required; no autonomous calendar or scheduler via MCP).
- browser automation including `inspect_application_form` and `assist_application_form` — out of scope and blocked (human-only handoff required; no browser apply).

Additional blocked MCP names that must not appear on `tools/list`:
`submit_application_form`, `inspect_application_form`, `assist_application_form`
plus the frozen human-only catalog in references. Never claim submission,
sending, approval, applied attestation, or a deferred/future capability.
