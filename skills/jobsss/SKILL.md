---
name: jobsss
description: Standalone job-search skill for offline local workflows using the bundled ./bin/jobsss MCP runtime over PLUGIN_DATA — doctor, start, profile, job ingest, scoring, pursuit, pipeline, and review without requiring JobOS.
---

# JobSSS — standalone bundled runtime

JobSSS is a self-contained Agent Plugin with a bundled runtime. It runs locally
via `./bin/jobsss mcp --data ${PLUGIN_DATA}` and persists all user state under
the host-provided `PLUGIN_DATA` directory. No JobOS installation, `jobos`
executable, API keys, or network access are required for the core journey. The
runtime works offline without JobOS — JobOS is not required, not spawned, and
not imported at runtime.

`/jobsss` with no intent shows help and a next-action menu. Never fabricate
execution or authority. Do not claim, invent, fabricate, or pretend that a job,
score, proof, send, submission, approval, or applied attestation succeeded. Never
claim submission, sending, approval, or deferred/future capability.

## Core journey (offline, local, no API key)

| Invocation | Route |
| --- | --- |
| `/jobsss` | base — Help / next-action menu. Never fabricate execution or authority. |
| `/jobsss doctor` | MCP `doctor` — diagnose the bundled `./bin/jobsss` launcher and `PLUGIN_DATA` readability/writability. No JobOS on PATH is required. |
| `/jobsss start` | MCP `start` — initialize durable state under `PLUGIN_DATA`. Creates the local store if absent. |
| `/jobsss profile` or `create_profile` | MCP `create_profile` — create or import a local profile/resume (`name` plus optional `resumePath`/`path`/`filePath`), extracting proof-point candidates for human verification. Returns `profileId`. |
| `/jobsss find` or `import_job` | MCP `import_job` and `list_jobs` — import a local job fixture (`profileId` plus `path`/`filePath`) and list imported jobs. Offline fixture import; re-import deduplicates to a single job id. |
| `/jobsss score` or `score_job` | MCP `score_job` (`jobId`, `profileId`) — deterministic local scoring returning `overall` and/or `scoreStatus`. No API key required. |
| `/jobsss pursue` | MCP `pursue_job` (`jobId`, `profileId`) — record local pursuit and prepare a basic readiness artifact for review; never submits, sends, or applies. |
| `/jobsss pipeline` | MCP `applications_plan` and `list_jobs` — local pipeline/readiness for a job; never claims submitted/sent/applied. |
| `/jobsss review` | MCP `review_queue` (`profileId`) — local review state for the profile. |

Required MCP tools for this journey (all operate under `PLUGIN_DATA` via
`./bin/jobsss mcp --data ${PLUGIN_DATA}`): `doctor`, `start`,
`create_profile`, `import_job`, `list_jobs`, `score_job`, `pursue_job`,
`applications_plan`, `review_queue`. See `references/standalone-journey.md`
for argument shapes and persistence details.

For human-only operations, follow [Human-only handoffs](references/human-only-handoffs.md).
Those tools are not available to MCP and must not be reported as done. Approval,
send, submit, and packet-freeze language is handoff-only via trusted CLI/TUI.

## PLUGIN_DATA and bundled launcher

- The host expands `${PLUGIN_DATA}` to an absolute writable data directory. The
  launcher honors `--data <dir>` and environment `PLUGIN_DATA` and persists only
  under that directory. No user state is written into the installed plugin
  directory.
- The MCP server is `jobsss` over stdio with command `./bin/jobsss` and args
  `["mcp", "--data", "${PLUGIN_DATA}"]`. No `env`, `cwd`, headers, or
  credentials are set in `mcp.json`.

## Doctor — bundled runtime diagnosis

For `/jobsss doctor`, diagnose whether `./bin/jobsss` is present and executable
and whether `PLUGIN_DATA` is set, absolute, and writable. If state is missing,
advise running `./bin/jobsss mcp --data ${PLUGIN_DATA}` and then `doctor` →
`start`. Do not send the agent to install JobOS onto `PATH` and do not invent
or claim success, jobs, scores, proofs, sends, or submissions while diagnosing.
Do not claim, invent, or fabricate success.

## Out of scope — blocked or handed off

The standalone journey does not include these. They are out of scope and
blocked (or require explicit human-only handoff) and must not be claimed via
MCP:

- network — out of scope and blocked (human-only handoff required; no autonomous outreach or `mark_outreach_sent`).
- interview — out of scope and blocked (human-only handoff required; no `verify_interview_story` or similar via MCP).
- scheduling — out of scope and blocked (human-only handoff required; no autonomous calendar or scheduler via MCP).
- browser automation including `inspect_application_form` and `assist_application_form` — out of scope and blocked (human-only handoff required; no browser apply).

Additional blocked MCP names that must not appear on `tools/list`:
`submit_application_form`, `inspect_application_form`, `assist_application_form`
plus the frozen human-only catalog in references. Never claim submission,
sending, approval, applied attestation, or a deferred/future capability.
