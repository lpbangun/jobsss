# JobSSS

JobSSS is a portable Agent Plugin that routes job-search requests to JobOS. Install JobOS first and ensure the `jobos` executable is available on `PATH`.

## Structure

- `plugin.json` — plugin manifest
- `mcp.json` — portable MCP server configuration
- `skills/jobsss/SKILL.md` — `/jobsss` routing skill
- `skills/jobsss/references/` — supporting routing and handoff guidance

## Commands

Use `/jobsss` for help and next actions. Supported intents are:

`start`, `daily`, `find`, `pursue`, `pipeline`, `materials`, `network`, `interview`, `review`, `sync`, `config`, and `doctor`.

## Runtime boundary

The portable `mcp.json` connects over stdio by running `jobos mcp`. JobOS remains the sole engine and authority for state, tools, and policy; JobSSS adds routing only.

Actions requiring human trust or attestation are handed off to the JobOS CLI/TUI. JobSSS never claims that an application was sent or applied, that outreach was sent, or that an approval occurred.
