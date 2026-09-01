# AGENTS.md — JobSSS

Purpose: JobSSS is a standalone Agent Plugin whose bundled runtime
`./bin/jobsss mcp --data ${PLUGIN_DATA}` serves the `jobsss` skill. No JobOS
installation or `jobos` on PATH is required. Persistent user state lives only
under the host-provided `PLUGIN_DATA`.

Paths:
- `plugin.json`, `mcp.json` — Agent Plugins 1.0.0 manifests at repo root.
- `skills/jobsss/SKILL.md` + `skills/jobsss/references/` — the skill.
- `bin/jobsss`, `src/` — bundled runtime (no JobOS import or spawn).
- `compat/` — thin client adapters/probes referencing the canonical assets; never a source of truth.
- `BENCHMARK.md`, `tests/jobsss-*.test.mjs` — reviewer-owned pass bar (do not edit).

Commands:
- `node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs tests/jobsss-journey.test.mjs tests/jobsss-persistence.test.mjs tests/jobsss-discovery.test.mjs tests/jobsss-workflows.test.mjs tests/jobsss-integrity.test.mjs tests/jobsss-release.test.mjs tests/jobsss-adapters.test.mjs tests/jobsss-authority.test.mjs`
- `./bin/jobsss release --out <absdir> --target current-host` builds the deterministic portable current-host release (standalone `bin/jobsss`, no Node on PATH needed at runtime; repeated builds byte-identical).
- `./bin/jobsss compat-probe --client <pi|omp|codex|hermes|claude> --config-dir <temp> --plugin-root <plugin>` probes one client in isolated temporary configuration and prints `verified`/`unverified` JSON.
- Requires Node 22+; no npm dependencies.

Invariants:
- Standalone: one skill, one MCP server (`jobsss` via `./bin/jobsss mcp --data ${PLUGIN_DATA}`); runtime never resolves or spawns `jobos`.
- Keep the plugin portable: no credentials/secrets, no user or workspace paths, no symlinks escaping the root. Client-specific packaging is never a source of truth; `compat/` holds only thin adapters/probes that reference the canonical skill and runtime.
- State isolation: all durable state under `PLUGIN_DATA`; never write into the plugin directory.
- Safety: human-only actions are trusted CLI/TUI handoffs and not MCP-attestable; never claim submission, sending, approval, applied attestation, or deferred capability. Local networking drafts and interview preparation are allowed; external sending, scheduling, debrief attestation, and browser automation are blocked.

Verification: run the focused test command above from the repo root before
yielding; keep changes small and report what you ran.
