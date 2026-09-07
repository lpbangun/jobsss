# JobSSS — standalone Agent Plugin

JobSSS is a self-contained Agent Plugin with a bundled runtime. It does not
require a JobOS installation or `jobos` on `PATH`. Core workflows work offline
without API keys; optional public HTTP(S) job intake and ATS discovery use the network.

## Launch

Source installation requires Node 22+ on PATH: the source checkout launcher
begins with `/usr/bin/env node`, so `node` must be installed and explicitly
available on PATH in that setup. The source checkout is not equivalent to the
native standalone package: the deterministic current-host release built via
`./bin/jobsss release` executes with Node and JobOS absent from PATH.

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
- `bin/jobsss` + `src/` — bundled runtime (offline core plus safe public intake; no JobOS dependency); `src/packaging.js` holds the separated ELF/Mach-O/PE platform definitions built through the checksum-pinned Node SEA injector defined in `src/packaging.lock.json`
- `tests/` — reviewer-owned acceptance checks plus fixtures

## Release builds

```
./bin/jobsss release --out <absdir> --target current-host
```

builds the deterministic standalone current-host release: a regular
`bin/jobsss` executable (no Node or JobOS on PATH needed at runtime) plus the
portable plugin core, with repeated clean builds byte-identical. Native
mutation uses the Node-supported SEA injector `postject` pinned with exact
version/URL/SHA-256 in `src/packaging.lock.json`; checksum-verified official
Node v22.22.3 executables are used as real base inputs, downloaded into the
temporary cache only (`JOBSSS_NATIVE_CACHE` or the OS temp dir), never into
the repository. Intended
cross-platform targets (`linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win-x64`) are defined in `src/packaging.js` and selected
with `--target`; `--node-binary <path>` must name the exact checksum-pinned
official Node executable recorded for that target (its `executableSha256` is
enforced before injection — matching format/architecture alone is not
enough). Signed `node.exe` is staged unsigned by packaging (the Security
certificate-table directory is zeroed in a private copy and pinned postject
drops the certificate bytes; no pre-injection signature is ever restored),
so the released Windows artifact must be re-signed on a matching Windows
host. A target is labeled `verified` only after real execution on a matching
host; cross-builds from official inputs remain `unverified` (they validate
the definition, never the platform runtime). Independent Mach-O/PE
validation uses checksum-pinned build/test-only pefile/macholib/altgraph,
never the production parser. Full release evidence and deferred
capabilities are recorded in `RELEASE_REPORT.md`.

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

Identical manual proof retries retain the original record and human verification;
changed summary, skills, or metrics create a separate unverified proof while
preserving prior evidence. Profile reimports resolve a unique exact current name,
including after rename; conflicting renames and ambiguous imports reject rather
than merge identities.

Stored interview-prep readbacks, review-queue drafts, and pending artifact/story
handoffs include computed `freshness: {status: 'current'|'stale', reasons: []}`.
Stale reasons identify historical/retired supporting proof or retired stories.
This is evidence currency, not approval: stored snapshots and trusted hashes are
unchanged, and nothing is deleted or automatically regenerated.

MCP validates JSON-RPC 2.0 envelopes before classifying notifications by absent
`id`. Valid notifications stay silent and do not mutate state. Omitted tool
arguments default to `{}`; explicit null rejects with `-32602`. Invalid envelopes
receive `-32600`; business failures remain tool results with `isError: true`.
`create_decision_handoff.expectedRevision` is an integer, not human authority.

The separately authorized closure follow-up does not reset the historical
five-round NOT CONVERGED result. Current exact-candidate full-suite, independent
review, and real canonical-skill/model-driven mutation/restart acceptance remain
separate gates; historical connectivity and native structural evidence do not
establish a current host PASS.

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

Client compatibility: each client references the same canonical skill and
bundled runtime through thin pointers recorded in `compat/matrix.json`.
MCP registration alone does not prove skill loading or a state-changing
agent-host journey. A client or platform is labeled `verified` only after a
real isolated launch proved it; everything unproven is labeled `unverified`.
See `compat/README.md`.

JobSSS never claims submission, sending, approval, or deferred capability and
never invents jobs, scores, or proofs.
