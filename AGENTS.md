# AGENTS.md — JobSSS

Purpose: JobSSS is a standalone Agent Plugin whose bundled runtime
`./bin/jobsss mcp --data ${PLUGIN_DATA}` serves the `jobsss` skill. No JobOS
installation or `jobos` on PATH is required. Persistent user state lives only
under the host-provided `PLUGIN_DATA`.

Paths:
- `plugin.json`, `mcp.json` — Agent Plugins 1.0.0 manifests at repo root.
- `skills/jobsss/SKILL.md` + `skills/jobsss/references/` — the skill.
- `bin/jobsss`, `src/` — bundled runtime (no JobOS import or spawn).
- `BENCHMARK.md`, `tests/jobsss-*.test.mjs` — reviewer-owned pass bar (do not edit).

Commands:
- `node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs`
- Requires Node 22+; no npm dependencies.

Invariants:
- Standalone: one skill, one MCP server (`jobsss` via `./bin/jobsss mcp --data ${PLUGIN_DATA}`); runtime never resolves or spawns `jobos`.
- Keep the plugin portable: no credentials/secrets, no user or workspace paths, no symlinks escaping the root, no client-specific packaging.
- State isolation: all durable state under `PLUGIN_DATA`; never write into the plugin directory.
- Safety: human-only actions are trusted CLI/TUI handoffs and not MCP-attestable; never claim submission, sending, approval, applied attestation, or deferred capability. Local networking drafts and interview preparation are allowed; external sending, scheduling, debrief attestation, and browser automation are blocked.

Verification: run the focused test command above from the repo root before
yielding; keep changes small and report what you ran.
