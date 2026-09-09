# Standalone journey — doctor → review

This reference documents the bundled standalone journey that works offline
without JobOS, without API keys, and with `jobos` absent from `PATH`.

## Launcher and state root

- Launcher: `./bin/jobsss`
- MCP entry: `./bin/jobsss mcp --data ${PLUGIN_DATA}` (stdio)
- State root: the host-provided `PLUGIN_DATA` directory. All durable files live
  under `PLUGIN_DATA` only. A restarted MCP process against the same directory
  must still list prior data. No state is written into the plugin directory
  itself.
- The journey requires no JobOS CLI, files, or runtime at execution time. JobOS
  is not required. Mention `PLUGIN_DATA` and `./bin/jobsss` in every
  diagnosis.

## Frozen MCP journey tools

All tools operate locally under `PLUGIN_DATA` via the bundled runtime.

| Tool | Required inputs | Behavior |
| --- | --- | --- |
| `doctor` | none | Diagnoses bundled `./bin/jobsss` and `PLUGIN_DATA`; succeeds without credentials. Do not claim, invent, or fabricate jobs/scores. |
| `start` | none | Initializes durable state under `PLUGIN_DATA`. |
| `create_profile` | `name`, optional resume text or a path under `PLUGIN_DATA` | Creates a profile and extracts proof-point candidates marked for human verification; returns `profileId` or `id`. Pass source resume text unchanged (headings and dated roles). No arbitrary filesystem paths are read. |
| `import_job` | `profileId` plus inline `text`/`content` or a path under `PLUGIN_DATA` | Imports job content locally; returns `jobId`. Offline; re-importing the same job deduplicates to a single id. |
| `list_jobs` | `profileId` | Lists imported jobs for that profile. |
| `score_job` | `jobId`, `profileId` | Local deterministic scoring; returns `overall` number and/or `scoreStatus`. No API key. |
| `pursue_job` | `jobId`, `profileId` | Records local pursuit and prepares a basic readiness artifact in draft review state; never claims submitted/sent/applied/approved. |
| `applications_plan` | `jobId`, `profileId` | Local pipeline/readiness; never claims submitted/sent/applied. |
| `review_queue` | `profileId` | Local review state. Pending decisions are also listed by MCP `list_decision_handoffs` and completed by a human only on the trusted local CLI `./bin/jobsss decide --data ${PLUGIN_DATA} --list` (see `client-compatibility.md`). |

Re-importing the same job for one profile must deduplicate to the
same job id.

## Extended local workflows (offline, no JobOS, no API keys)

All extended tools operate locally under `PLUGIN_DATA` via `./bin/jobsss`. They
are routed by MCP tool name or natural language only — no stable slash
sub-intents for networking, interview planning, or scheduling.

| Workflow | Tool | Notes |
| --- | --- | --- |
| Secure intake | `import_job` | Accepts inline `text`/`content` or a path under `PLUGIN_DATA`; rejects arbitrary absolute paths. Deduplicates on content. |
| Secure intake | `import_job_url` | Fetches and parses public HTTP(S) posting content; rejects `file:`, credentialed, private-address, unsafe-redirect, oversized, and failed responses. |
| Secure intake | `import_contact`, `list_contacts` | Inline contact card (`name`, `email`, `company`) or a `PLUGIN_DATA` path; never arbitrary paths. |
| Migration & state | `start` | Migrates a legacy `store.json` losslessly into versioned persistence with an audit trail under `PLUGIN_DATA`; ids are preserved. |
| Profile & preferences | `create_profile`, `list_profiles`, `update_profile`, `list_resumes`, `add_proof_point` | Profile preferences, structured resume revisions, and proof candidates remain profile-owned and need human verification. |
| Discovery & saves | `create_saved_search`, `list_saved_searches`, `search_jobs`, `daily_discovery` | Fetches public Greenhouse boards by `boardToken`, with staged offline search data under `PLUGIN_DATA` as the offline path; no keys. Discoveries stay database-only until saved/pursued. |
| Save / skip / archive | `save_job`, `skip_job`, `archive_job`, `list_jobs` | Explicit local decisions; unsaved discoveries create no application folder. |
| Scoring | `score_job` | Offline deterministic `jobos.fit-score.v1` with all seven weighted dimensions; `deterministic-degraded` mode; no provider. |
| Lifecycle & tasks | `pursue_job`, `applications_plan`, `update_application_status`, `list_tasks`, `update_task` | Local pipeline and next actions. `update_application_status` rejects `applied`/`submitted` (cannot attest). |
| Materials | `tailor_resume`, `draft_cover_letter`, `save_answer`, `list_answers`, `match_answers` | Tailoring extracts requirements, ranks/selects relevant owned proof, and reports coverage gaps. Answers require exact owned proof wording; no arbitrary claims, invented metrics, auto-fill, or send. |
| Networking drafts | `record_research`, `list_research`, `map_reachable_network`, `plan_outreach`, `draft_outreach`, `list_outreach` | Local people/company research, maps, plans, follow-ups, and drafts only; never send (`mark_outreach_sent` is not MCP). |
| Interview prep | `draft_interview_story`, `list_interview_stories`, `interview_prep`, `get_interview_prep`, `interview_debrief_handoff` | Local stories, prep, coverage gaps, and a non-attesting handoff; verification/debrief confirmation stays human-only CLI/TUI. |
| Sync preview | `preview_sync` | Dry-run, secret-safe preview of derived/export data; no auto or cloud sync. |

## Blocked / human-only boundary

These must not appear on `tools/list` and are not MCP-attestable — hand off to
the trusted local CLI `./bin/jobsss decide` instead and never report as done.
See `human-only-handoffs.md` for the complete frozen catalog:

`approve_artifact`, `reject_artifact`, `approve_contact`, `answers_add`,
`create_application_packet`, `attest_application_submitted`,
`confirm_application_receipt`, `checkpoint_application_form`,
`verify_interview_story`, `retire_interview_story`,
`add_interview_question_source`, `record_interview_debrief`,
`correct_interview_debrief`, `record_job_feedback`,
`correct_memory_observation`, `undo_memory_observation`,
`accept_memory_proposal`, `reject_memory_proposal`, `revoke_memory_proposal`,
`undo_memory_transition`, `network_contact_record`, `mark_outreach_sent`,
plus `submit_application_form`, `inspect_application_form`,
`assist_application_form`.

Never claim submission, sending, approval, applied attestation, or a
deferred/future capability. Pursuit and pipeline steps are local preparation
only.

## Out-of-scope groups

Local planning/drafting tools listed above are available, but the external or
authoritative action stays blocked and human-only:

- network — out of scope and blocked (human-only handoff required; local drafts above never send)
- interview — out of scope and blocked (human-only handoff required; local prep above does not verify or schedule)
- scheduling — out of scope and blocked (human-only handoff required)
- browser automation — out of scope and blocked (human-only handoff required)

These external actions are described as blocked, handed off, or out of scope,
never as an MCP capability. Calling `update_application_status` cannot attest
`applied` or `submitted`.

## Safety phrasing

The skill and references must forbid invented success: do not claim, invent,
fabricate, or pretend that jobs, scores, proofs, sends, or submissions
succeeded when they have not. Every route reports only actual bundled MCP
results.
