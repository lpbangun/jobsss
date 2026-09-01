# JobSSS — standalone Agent Plugin

JobSSS is a self-contained Agent Plugin with a bundled runtime. It does not
require a JobOS installation or `jobos` on `PATH`. Core workflows work offline
without API keys; optional public HTTP(S) job intake and ATS discovery use the network.

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
- `bin/jobsss` + `src/` — bundled runtime (offline core plus safe public intake; no JobOS dependency)
- `tests/` — reviewer-owned acceptance checks plus fixtures

## Core journey

```
/jobsss doctor
→ /jobsss start
→ create or import a profile (create_profile)
→ import or discover jobs (import_job, import_job_url, saved searches, daily_discovery)
→ score, save/skip/archive, or pursue them
→ prepare proof-grounded materials, reusable answers, and persistent tasks
→ map local network paths and draft outreach without sending
→ prepare interview stories, coverage gaps, and a human debrief handoff
→ /jobsss pipeline (applications_plan) and /jobsss review (review_queue plus
    pending decision handoffs; a human completes them on ./bin/jobsss decide)
```

All steps run locally under `PLUGIN_DATA`. Resume imports extract proof-point
candidates for human verification, and pursuit prepares a basic readiness
artifact for the review queue. Re-importing the same job deduplicates to one
job id. Scoring and pursuit do not require credentials and never claim
submitted/sent/applied/approved.

## Boundaries

Local contact/network research, outreach plans and drafts, interview story drafts,
preparation, coverage gaps, and debrief handoffs are supported. Public job pages
and ATS boards may be fetched through bounded, public-address-only HTTP(S).
External sending, application submission or attestation, interview verification or
debrief confirmation, automatic email/calendar actions, scheduling, and browser
automation (including `inspect_application_form` / `assist_application_form` /
`submit_application_form`) are blocked or handed off to a trusted human CLI/TUI.
Human-only operations listed in `skills/jobsss/references/human-only-handoffs.md`
are not MCP-attestable: a human completes each one on the trusted local CLI
`./bin/jobsss decide --data ${PLUGIN_DATA} --list` with the exact entity id,
revision, and content hash. MCP callers can only list and create non-authoritative
decision handoffs (`list_decision_handoffs`, `create_decision_handoff`).

Client compatibility: Pi/OMP, Codex, Hermes, and Claude load the same canonical
skill and bundled runtime through thin pointers recorded in `compat/matrix.json`.
A client or platform is labeled `verified` only after a real isolated launch
proved it; everything unproven is labeled `unverified`. See `compat/README.md`.

JobSSS never claims submission, sending, approval, or deferred capability and
never invents jobs, scores, or proofs.
