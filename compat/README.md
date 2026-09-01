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