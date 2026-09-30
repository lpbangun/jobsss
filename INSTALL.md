# Install JobSSS and its companions

JobSSS is the front door of a three-product family: **JobSSS** (local job-search
workspace with the bundled MCP runtime), **people-finder** (typed-anchor
candidate-lead discovery) and **contact-brief** (cited contact brief compiler).
Each is its own portable Agent Plugin with its own repository, and they compose
end to end.

This page is written for agents as much as for humans: point your agent at this
repository and let it follow these steps.

## Pick the surface for your host

| Host | One action | Installs | Status |
| --- | --- | --- | --- |
| Hermes | `hermes plugins pack install https://raw.githubusercontent.com/lpbangun/jobsss/main/compat/hermes/find-people.pack.yaml` | all three, pinned to a reviewed trio | **verified** — installed 3/3 into an isolated `HERMES_HOME`; portable MCP servers take effect at `mcp.reload` / the next session, so an empty `hermes mcp list` before then is expected |
| Codex | clone/download this release, then `codex plugin marketplace add .` and `codex plugin add job-search-stack@jobsss-local` | generated aggregate adapter: two MCP runtimes plus the contact-brief compiler skill | **verified on Windows** — fresh install, explicit/natural activation, MCP handshake and state-changing workflow |
| Any other host | the portable package at each repository root (`plugin.json`, `mcp.json`, `skills/`) | one product per repository | unverified |

For a reproducible install, replace `main` with the commit you reviewed:
`https://raw.githubusercontent.com/lpbangun/jobsss/<commit>/compat/hermes/find-people.pack.yaml`

For Codex, use the tagged release so the local marketplace and generated package
remain together:

```bash
git clone --depth 1 --branch v0.1.1 https://github.com/lpbangun/jobsss.git
cd jobsss
codex plugin marketplace add .
codex plugin add job-search-stack@jobsss-local
```

Start a new Codex task after installation. A ZIP from
`https://github.com/lpbangun/jobsss/archive/refs/tags/v0.1.1.zip` works too after
extraction; run the two `codex plugin` commands from the extracted repository root.

Installing only JobSSS is also fine:
`hermes plugins install lpbangun/jobsss/agent-plugin`. The pack is a convenience
channel, never a dependency, and the three products stay separately removable.

## Instructions for an agent asked to install this

1. Identify your host — Hermes, Codex, or neither.
2. **Hermes** — run the pack command above. Hermes shows a review screen (every
   plugin, source, and pinned ref), asks one confirmation for the pack, then runs
   its normal per-plugin install and capability consent. A pack never bulk-grants.
   That confirmation belongs to the human: show it, wait for it, never answer it
   automatically.
3. **Codex** — clone/download the tagged repository, add its root as the generated
   local marketplace, then
   install `job-search-stack@jobsss-local`. The aggregate is a deterministic
   host adapter over the exact reviewed products: JobSSS and people-finder are
   separate MCP servers and contact-brief remains a compiler skill. On Windows,
   the adapter launches extensionless JavaScript/Python products through thin
   Node shims; it does not fork product business logic. Verify a fresh task
   before reporting success. Start a new task after installation so Codex loads
   the new skills and MCP servers.
4. **Any other host** — use that host's own mechanism with the portable package at
   each repository root, or run the bundled launcher from a source checkout.
5. Report each plugin's activation state as **installed**, **enabled**, or
   **deferred until `mcp.reload` / the next session**. An enabled portable plugin
   whose MCP server is not visible until that point is not a failed install.
   Include the pinned commit and any per-plugin failure — a pack install can
   partially succeed. Enable-time capability grants are separate from a
   successful install.
6. Never weaken, skip, or pre-answer a host's consent step. JobSSS never sends,
   submits, approves, or attests anything, and no install changes that.

### Hermes: verify activation before starting a new session

Portable MCP server registration is session-scoped. Enabling a plugin can be
reported immediately, while its MCP server becomes active at `mcp.reload` or in
the next session. Before that reload, `hermes mcp list` may say `No MCP servers
configured.`; for a portable package this is expected, not evidence that the
install failed.

Before restarting, run `hermes plugins show jobsss` and verify `Status: enabled`.
Then start a new Hermes session and verify that the JobSSS MCP server/tools are
visible there. `hermes plugins doctor jobsss` may report
`registrations: 0 tool(s), 0 hook(s)` for a portable package; that counter is
normal and does not mean the portable MCP server failed to load.

Do not add a duplicate `jobsss` entry to Hermes `mcp_servers` configuration, and
do not hand-expand or rewrite the literal `${PLUGIN_ROOT}` / `${PLUGIN_DATA}`
placeholders in `mcp.json`. The portable loader resolves these placeholders when
loading the package and manages the plugin data location; a hand-wired duplicate
can collide with the plugin's own server registration.

### Runtime requirement: Node.js 22+ through PATH or `JOBSSS_NODE`

Both portable package roots declare Node.js `>=22` in `package.json`. The
launcher needs a Node.js 22+ executable available to the Hermes service, either
as `node` or `nodejs` on its `PATH`, or through `JOBSSS_NODE` set to the absolute
path of a Node.js 22+ executable. An interactive shell's PATH change may not
reach a desktop or service process. The override selects an installed Node
runtime; it does not provide Node-free startup.

If neither source is available, the launcher reports:

```text
jobsss: Node.js 22 or newer is required, but this service could not find node or nodejs on PATH.
jobsss: Set JOBSSS_NODE to an executable Node.js 22+ binary, or add node (or nodejs) to the service PATH.
```

Set `JOBSSS_NODE` in the Hermes service environment or add `node`/`nodejs` to
that service's PATH. To inspect the PATH inherited by a running Hermes service,
read `/proc/<pid>/environ` (substitute the Hermes serve-process PID):

```bash
tr '\0' '\n' < /proc/<pid>/environ | grep -E '^(PATH|HOME|JOBSSS_NODE)='
```

Node-free startup of the portable package, such as shipping verified
per-platform SEA launchers, is a separate follow-up and is not provided by the
current launcher metadata or `JOBSSS_NODE` override.

## How these surfaces stay honest

`compat/install-pins.json` pins the reviewed trio to exact 40-character commits.
Every surface (`compat/hermes/find-people.pack.yaml` and the root Codex marketplace
`.agents/plugins/marketplace.json`)
is generated from that file by `scripts/build-install-surfaces.mjs`; `--check`
fails on drift and `--refresh` advances the pins deliberately. Surfaces carry no
authority and grant nothing. Every `compat/` surface remains metadata-only.
`scripts/build-codex-pack.mjs` mirrors the exact runtime/skill bytes into the
root-level generated package `codex-pack/job-search-stack` because the Codex
Windows host cannot execute the portable extensionless shebang launchers
directly. The repository root is the marketplace root, so the thin marketplace
can point to that sibling package without escaping its root. Its generated
`provenance.json` hashes every file and binds the package to the exact pins; it
is never a hand-maintained runtime fork.
