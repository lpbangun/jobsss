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
| Hermes | `hermes plugins pack install https://raw.githubusercontent.com/lpbangun/jobsss/main/compat/hermes/find-people.pack.yaml` | all three, pinned to a reviewed trio | **verified** — installed 3/3 into an isolated `HERMES_HOME` |
| Codex | clone/download this release, then `codex plugin marketplace add .` and `codex plugin add job-search-stack@jobsss-local` | generated aggregate adapter: two MCP runtimes plus the contact-brief compiler skill | **verified on Windows** — fresh install, explicit/natural activation, MCP handshake and state-changing workflow |
| Any other host | the portable package at each repository root (`plugin.json`, `mcp.json`, `skills/`) | one product per repository | unverified |

For a reproducible install, replace `main` with the commit you reviewed:
`https://raw.githubusercontent.com/lpbangun/jobsss/<commit>/compat/hermes/find-people.pack.yaml`

For Codex, use the tagged release so the local marketplace and generated package
remain together:

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/lpbangun/jobsss.git
cd jobsss
codex plugin marketplace add .
codex plugin add job-search-stack@jobsss-local
```

Start a new Codex task after installation. A ZIP from
`https://github.com/lpbangun/jobsss/archive/refs/tags/v0.1.0.zip` works too after
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
5. Report exactly what happened: which plugins installed, at which pinned commit,
   and any per-plugin failure — a pack install can partially succeed. Enable-time
   capability grants are separate from a successful install.
6. Never weaken, skip, or pre-answer a host's consent step. JobSSS never sends,
   submits, approves, or attests anything, and no install changes that.

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
