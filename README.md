# JobSSS — standalone Agent Plugin

JobSSS is a self-contained Agent Plugin with a bundled runtime. It does not
require a JobOS installation or `jobos` on `PATH` and works offline without API
keys.

## Launch

MCP server `jobsss` (stdio) via the bundled launcher:

```
./bin/jobsss mcp --data ${PLUGIN_DATA}
```

`mcp.json` declares exactly this entry. The host expands `${PLUGIN_DATA}` to a
writable directory; all durable state lives under `PLUGIN_DATA` and survives a
restarted MCP process. No user state is written into the plugin directory.

## Structure

- `plugin.json` — plugin manifest (Agent Plugins 1.0.0)
- `mcp.json` — `jobsss` stdio server (`./bin/jobsss mcp --data ${PLUGIN_DATA}`)
- `skills/jobsss/SKILL.md` — `/jobsss` routing for the standalone journey
- `skills/jobsss/references/` — journey and human-only handoff guidance
- `bin/jobsss` + `src/` — bundled runtime (offline, no JobOS dependency)
- `tests/` — reviewer-owned acceptance checks plus fixtures

## Core journey

```
/jobsss doctor
→ /jobsss start
→ create or import a profile (create_profile)
→ import or discover a job (import_job, list_jobs)
→ score and pursue it (score_job, pursue_job)
→ /jobsss pipeline (applications_plan)
→ /jobsss review (review_queue)
```

All steps run locally under `PLUGIN_DATA`. Resume imports extract proof-point
candidates for human verification, and pursuit prepares a basic readiness
artifact for the review queue. Re-importing the same fixture deduplicates to one
job id. Scoring and pursuit do not require credentials and never claim
submitted/sent/applied/approved.

## Boundaries

Network, interview, scheduling, and browser automation (including
`inspect_application_form` / `assist_application_form` / `submit_application_form`)
are out of scope and blocked or handed off to a trusted CLI/TUI. Human-only
operations listed in `skills/jobsss/references/human-only-handoffs.md` are not
MCP-attestable.

JobSSS never claims submission, sending, approval, or deferred capability and
never invents jobs, scores, or proofs.
