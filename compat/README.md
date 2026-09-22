# JobSSS client compatibility

JobSSS is a client-neutral Agent Plugin. The canonical source of truth is the
portable plugin at the repository root (`plugin.json`, `mcp.json`,
`skills/jobsss/SKILL.md`, `./bin/jobsss`). No client-specific packaging
duplicates that source.

## Matrix and probes

`compat/matrix.json` records the compatibility status of every intended
client (`pi`, `omp`, `codex`, `hermes`, `claude`) and release target
(`current-host`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`win-x64`). A status is `verified`, `built`, `intended`, or `unverified`, and
only a status proven by a real isolated launch claims `verified`.

Re-run the probes with:

    ./bin/jobsss compat-probe --client <name> --config-dir <temp-dir> --plugin-root <plugin>

Probes always use temporary configuration (temporary HOME, XDG, and per-client
home/state directories created under `--config-dir`); real user profiles are
never read or written. The Hermes probe additionally sets `HERMES_REVISION` so the
update check Hermes performs at CLI launch uses a read-only `git ls-remote`
comparison instead of `git fetch` into the real install checkout — the probe
process tree never writes the live `~/.hermes` install. Clients that cannot be
proven in the isolated environment are labeled `unverified`, never invented as
supported.

## Thin adapter generation

Where a client cannot load the Agent Plugin itself, `compat-probe` renders the
smallest config/pointer adapter into the temporary `--config-dir`:

- `compat/codex/config.toml.template` — Codex `[mcp_servers.jobsss]` entry
  with the absolute launcher and an absolute temporary data directory.
- `compat/hermes/config.yaml.template` — Hermes `mcp_servers.jobsss` entry.
- `compat/claude/mcp.json.template` and
  `compat/claude/.claude-plugin/plugin.json` — Claude configuration/plugin
  wrapper pointing at the canonical skill and bundled runtime.

Adapters reference the canonical assets (`skills/jobsss/SKILL.md`,
`./bin/jobsss`) and contain no job-search policy, tool implementations, or
business logic. Human-authority decisions stay on the trusted local surface
(`./bin/jobsss decide`) and are never exposed through client adapters.

## Install surfaces

`compat/install-pins.json` pins the reviewed product trio — this plugin plus
people-finder and contact-brief — to exact 40-character commits.
`compat/hermes/find-people.pack.yaml` and the root Codex marketplace
`.agents/plugins/marketplace.json` are generated from those pins by
`scripts/build-install-surfaces.mjs`; `--check` fails on
drift and `--refresh` advances the pins to each repository's default-branch head.

Every `compat/` surface is distribution metadata only. The thin root-level
Codex marketplace points to the generated root-level
`codex-pack/job-search-stack`, which mirrors the pinned runtime and skill bytes
because Windows cannot directly launch the portable extensionless shebang entry
points. Its adapters contain no business logic and `provenance.json` hashes
every generated file. Regenerate with exact pinned companion checkouts, then
verify both layers:

```sh
node scripts/build-codex-pack.mjs --people-finder <path> --contact-brief <path>
node scripts/build-codex-pack.mjs --check
node scripts/build-install-surfaces.mjs --check
```
