# AGENTS.md — JobSSS

Purpose: JobSSS (Job Search Skill System) is a portable Agent Plugin whose single
`jobsss` skill routes `/jobsss` commands to JobOS over MCP. JobOS is the only
engine; JobSSS adds routing and handoffs, never behavior.

Paths:
- `plugin.json`, `mcp.json` — Agent Plugins 1.0.0 manifests at repo root.
- `skills/jobsss/SKILL.md` + `skills/jobsss/references/` — the skill.
- `BENCHMARK.md`, `tests/jobsss-*.test.mjs` — reviewer-owned pass bar (do not edit).

Commands:
- `node --test --test-concurrency=1 tests/jobsss-gate0.test.mjs tests/jobsss-mcp-compat.test.mjs`
- Requires Node 22+; no npm dependencies.

Invariants:
- Reuse JobOS: one skill, one MCP server (`jobos mcp`), no duplicated logic,
  no second runtime, database, policy layer, or auto-apply/submit/send path.
- Keep the plugin portable: no credentials/secrets, user or workspace paths,
  symlinks, paths escaping the plugin root, or client-specific packaging.
- Human-only actions are CLI/TUI handoffs; never claim submission, sending,
  approval, or deferred capabilities.

Verification: run the focused test command above from the repo root before
yielding; keep changes small and report what you ran.
