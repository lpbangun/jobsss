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
| Codex | `codex plugin marketplace add lpbangun/jobsss@<commit> --sparse compat/codex` then `codex plugin add job-search-stack@lpbangun` | all three as one Codex plugin | **unverified** — surface not generated yet; do not claim it works |
| Any other host | the portable package at each repository root (`plugin.json`, `mcp.json`, `skills/`) | one product per repository | unverified |

For a reproducible install, replace `main` with the commit you reviewed:
`https://raw.githubusercontent.com/lpbangun/jobsss/<commit>/compat/hermes/find-people.pack.yaml`

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
3. **Codex** — the surface is not verified yet. Say so; do not install or claim
   that it works. (The plugin manifest and marketplace entry will be generated
   from the same pins once a real run has proven them.)
4. **Any other host** — use that host's own mechanism with the portable package at
   each repository root, or run the bundled launcher from a source checkout.
5. Report exactly what happened: which plugins installed, at which pinned commit,
   and any per-plugin failure — a pack install can partially succeed. Enable-time
   capability grants are separate from a successful install.
6. Never weaken, skip, or pre-answer a host's consent step. JobSSS never sends,
   submits, approves, or attests anything, and no install changes that.

## How these surfaces stay honest

`compat/install-pins.json` pins the reviewed trio to exact 40-character commits.
Every surface (`compat/hermes/find-people.pack.yaml`, and any later host surface)
is generated from that file by `scripts/build-install-surfaces.mjs`; `--check`
fails on drift and `--refresh` advances the pins deliberately. Surfaces carry no
product bytes and grant nothing — they are distribution metadata. A surface
advance ships together with the pins it was generated from, so an install always
names a combination that was actually verified.
