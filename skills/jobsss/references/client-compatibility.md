# Client compatibility — verified vs unverified

JobSSS stays client-neutral: the portable Agent Plugin at the repository root
(`plugin.json`, `mcp.json`, `skills/jobsss/SKILL.md`, `./bin/jobsss`) is the
single source of truth. Client integrations are thin pointers that reference
the canonical skill and bundled runtime and contain no duplicated policy,
tools, or business logic. The machine-readable matrix lives at
`compat/matrix.json` and the probes are exercised by the reviewer-owned
compatibility checks.

## Status rule (honest by default)

A client is `verified` only after a real isolated launch in temporary
configuration proved that the client started the JobSSS runtime with
`./bin/jobsss mcp --data <dir>` and observed its tools. Everything else —
binaries present but not proven, unproven platforms — is `unverified`.

- `pi` — unverified: stock Pi core exposes native skill loading but no
  documented native stdio MCP host; a custom extension bridge and a
  model-authorized session would be required to prove the runtime.
- `omp` — unverified: no `mcp`/plugin subcommand is exposed by this build.
- `codex` — unverified: isolated temporary `CODEX_HOME` registration is
  accepted by the CLI, but a live JobSSS tool exchange could not be proven
  because the agent session requires provider authentication (probe keys are
  blank by design).
- `hermes` — verified: `hermes mcp test jobsss` connected to the bundled
  runtime in an isolated temporary `HERMES_HOME` and discovered its tools.
- `claude` — verified: `claude mcp list` reported the `jobsss` server as
  Connected under an isolated temporary `CLAUDE_CONFIG_DIR`.

Probes run `./bin/jobsss compat-probe --client <name> --config-dir <temp>
--plugin-root <plugin>` with temporary HOME/XDG and client home overrides;
real client profiles are never read or written.

Command meanings are identical across clients: every client loads this same
canonical skill and routes to the same bundled `jobsss` runtime, so a command
means the same thing in Pi/OMP, Codex, Hermes, and Claude. Client adapters
never change tool semantics, add tools, or duplicate policy.

## Trusted local surface and pending decisions

`/jobsss review` routes to `review_queue` plus the pending decisions available
on the trusted local surface `./bin/jobsss decide --data ${PLUGIN_DATA}`. MCP
callers create and list non-authoritative requests with the handoff tools
`list_decision_handoffs` and `create_decision_handoff`; only direct local
human interaction completes a decision. See `human-only-handoffs.md`.

## Language across clients

- local preparation — profiles, drafts, plans, and prep stay local under
  `PLUGIN_DATA` and are never external actions;
- human observation — an externally observed application status is recorded
  by a human on the trusted local surface and attributed to the human, never
  to JobSSS;
- unsupported — external sending, submission, scheduling, and browser
  automation are blocked or unavailable and are never claimed.