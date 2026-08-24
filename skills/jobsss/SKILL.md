---
name: jobsss
description: Natural-language router for /jobsss job-search requests, delegating supported work to JobOS over MCP and handing human-only or runtime setup actions to trusted CLI/TUI.
---

# JobSSS router

JobSSS is guidance only: JobOS is the engine, store, tool registry, and policy authority. Interpret natural-language equivalents of the commands below, select the narrowest matching route, and report only actual JobOS MCP results. `/jobsss` with no intent shows this menu and suggests a next action; it does not fabricate execution or authority.

| Invocation | Route |
| --- | --- |
| `/jobsss start` | There is **no MCP init**. Hand off setup to the trusted CLI/TUI; do not claim setup completed. |
| `/jobsss daily` | Call `daily_discovery`. |
| `/jobsss find` | As appropriate, call `list_saved_searches`, `search_jobs`, `list_jobs`, or `import_job_url`. |
| `/jobsss pursue` | Call `pursue_job`. |
| `/jobsss pipeline` | As appropriate, call `list_jobs`, `applications_plan`, `list_tasks`, or `list_lifecycle_observations`. |
| `/jobsss materials` | As appropriate, call `tailor_resume`, `draft_cover_letter`, `review_queue`, or `diff_artifact`. |
| `/jobsss network` | As appropriate, call `map_reachable_network`, `start_people_research`, `plan_outreach`, or `draft_outreach`. Drafting and planning do not mean sending. |
| `/jobsss interview` | Call `interview_prep` and, as appropriate, `list_interview_stories` or `draft_interview_story`. |
| `/jobsss review` | As appropriate, call `review_queue`, `diff_artifact`, `weekly_review`, or `lifecycle_analytics`. |
| `/jobsss sync` | There is no MCP sync tool. SQLite is canonical, mirrors are derived, and there is no cloud sync. |
| `/jobsss config` | There is **no MCP config**. Hand off documented configuration to the trusted CLI/TUI. |
| `/jobsss doctor` | Diagnose runtime and MCP readiness. This is not an MCP tool; use the trusted CLI/TUI for runtime setup. If `jobos` is missing, follow recovery below. |

For human-only operations, follow [Human-only handoffs](references/human-only-handoffs.md).

## Missing JobOS

For `/jobsss doctor`, detect whether the `jobos` executable is unavailable, not installed, or not on `PATH`. Recover by installing JobOS, putting `jobos` on `PATH`, and configuring the stdio entry as `jobos mcp`. Until it is available, do not invent or claim success, jobs, scores, proofs, sends, or submissions.

Never claim submission, sending, approval, deferred or future capability. Never imply a request was applied, submitted, sent, approved, or attested without the required trusted human action. `submit_application_form` is conditional, user-configured, and default-off; never claim it ran.

This skill supplies no scripts, runtime, database or business logic, credentials, workspace locations, or copied policy implementation.
