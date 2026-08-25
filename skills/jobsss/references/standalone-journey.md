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
| `create_profile` | `name`, optional `resumePath`/`path`/`filePath` | Creates a profile and extracts proof-point candidates marked for human verification; returns `profileId` or `id`. |
| `import_job` | `profileId` plus local `path`/`filePath` | Imports a local job fixture (e.g. `tests/fixtures/job-posting.md`); returns `jobId`. Offline; re-import deduplicates to a single id. |
| `list_jobs` | `profileId` | Lists imported jobs for that profile. |
| `score_job` | `jobId`, `profileId` | Local deterministic scoring; returns `overall` number and/or `scoreStatus`. No API key. |
| `pursue_job` | `jobId`, `profileId` | Records local pursuit and prepares a basic readiness artifact in draft review state; never claims submitted/sent/applied/approved. |
| `applications_plan` | `jobId`, `profileId` | Local pipeline/readiness; never claims submitted/sent/applied. |
| `review_queue` | `profileId` | Local review state. |

Re-importing the same local job fixture for one profile must deduplicate to the
same job id.

## Blocked / human-only boundary

These must not appear on `tools/list` and are not MCP-attestable — hand off to
trusted CLI/TUI instead and never report as done. See `human-only-handoffs.md`
for the complete frozen catalog:

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

- network — out of scope and blocked (human-only handoff required)
- interview — out of scope and blocked (human-only handoff required)
- scheduling — out of scope and blocked (human-only handoff required)
- browser automation — out of scope and blocked (human-only handoff required)

These are not part of the doctor→review journey and must be described as
blocked, handed off, or out of scope, never as an MCP capability.

## Safety phrasing

The skill and references must forbid invented success: do not claim, invent,
fabricate, or pretend that jobs, scores, proofs, sends, or submissions
succeeded when they have not. Every route reports only actual bundled MCP
results.
