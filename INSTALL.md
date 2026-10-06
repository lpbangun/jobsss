# Install JobSSS

JobSSS means **Job Search Shape Send**.

Use `init` to create a dedicated folder with the core JobSSS runtime, local
data, and agent configuration. Then open your agent in that folder to work
through chat. The CLI also handles diagnostics and human decisions.

## Requirements

- **Node.js 22+**, including npm/npx.
- **Git** for the GitHub installation commands.
- An agent host for chat workflows. The Codex pack has been verified on Windows;
  other integration details are in [client compatibility](compat/README.md).
- A local **Chrome or Edge** browser for resume PDF export. Other core workflows
  do not need a browser. In WSL, the browser executable must be available to the
  WSL runtime; check the `resumeRenderer` result from `doctor`.

Use the same environment as your agent: WSL terminal for a WSL agent, Windows
terminal for a Windows agent. Node must also be on the agent process's PATH.

## Run once with npx

```bash
npx --package=github:lpbangun/jobsss jobsss init
```

No global install is needed. `init` creates a dedicated `jobsss-workspace/` folder. You can also run diagnostics directly:

```bash
npx --package=github:lpbangun/jobsss jobsss doctor --data "$HOME/.local/share/jobsss"
```

The `$HOME` examples here are for Linux, macOS, and WSL. On Windows PowerShell,
use a writable path such as `"$env:LOCALAPPDATA/JobSSS"` instead.

## Install the CLI globally

```bash
npm install -g github:lpbangun/jobsss
jobsss init
```

Follow the workspace steps below to check setup and start using your agent.

Both npm routes use the GitHub source, rather than a published npm registry
package. They require this packaging change to be published to GitHub first.
For a local checkout before publication, run `npm install -g .` from its root.
To remove the global CLI later, run `npm uninstall -g jobsss`.

## Open your new workspace

`jobsss init` creates `jobsss-workspace/` in your current directory. Choose
another location with `jobsss init my-job-search`. Run it outside the installed
plugin/repository folder. Existing nonempty folders are refused without changes.

```bash
cd jobsss-workspace
node jobsss.mjs doctor
codex  # or claude
```

The workspace includes:

| Location | Purpose |
| --- | --- |
| `.jobsss/data/` | Your profiles, jobs, documents, and persistent records. |
| `.jobsss/data/intake/` | A place to stage your resume and job descriptions. |
| `.jobsss/plugin/` | A local runtime snapshot, independent of the npx cache. |
| `.agents/skills/jobsss/`, `.codex/config.toml` | Codex skill and project MCP configuration. |
| `.claude/skills/jobsss/`, `.mcp.json` | Claude Code skill and project MCP configuration. |
| `jobsss.mjs` | Local CLI wrapper that selects this workspace's data folder. |

Review the host's trust/activation prompts. Project configuration support depends
on your agent version; verify JobSSS tools are available in a fresh chat. Both
project configurations use the same data folder. No host-wide configuration is
changed. Other hosts can load the included portable package with the explicit
workspace data path in `.mcp.json`.

Paste your resume in chat, or stage files under `.jobsss/data/intake/`. Back up
`.jobsss/data/`; it is excluded from Git along with the runtime snapshot. The
agent configs contain absolute paths, so moving the workspace requires updating
them. Updates to the installed CLI do not automatically update the snapshot.

From an unpublished source checkout, create a workspace beside the repo:

```bash
node bin/jobsss init ../my-job-search
```

The workspace contains core JobSSS. Companions use the separate pack below;
that plugin host manages a different data folder and does not automatically
share this workspace's state.

## Load the companion stack in Codex

```bash
git clone https://github.com/lpbangun/jobsss.git
cd jobsss
codex plugin marketplace add .
codex plugin add job-search-stack@jobsss-local
```

If you already have this checkout, run the two `codex plugin` commands from its
root. Start a **new Codex chat** after installation so the skills and servers
load. Keep the checkout available: it contains the local marketplace and plugin.

The pack includes **JobSSS**, **people-finder**, and **contact-brief**. JobSSS
manages your local search; the companions add candidate-lead discovery and
contact briefs. The generated Codex pack has been verified on Windows with
skill activation, MCP startup, and state-changing workflows.

Try this in the new chat:

> Use JobSSS to create my profile from this resume. Compare this job with my
> experience and preferences, explain the fit, and suggest my next steps.

No API key is required for JobSSS's core workflow. Optional live contact lookup
has separate provider credentials and possible charges. Your agent host has its
own model/account requirements.

## Hermes and other hosts

Hermes supports the portable plugin format. To install JobSSS alone:

```bash
hermes plugins install lpbangun/jobsss/agent-plugin
```

Review the host's confirmation prompts yourself. Check `hermes plugins show
jobsss` for enabled status, then reload MCP with `mcp.reload` or start a new
session. An empty MCP list before reload can be expected. The existing Hermes
integration evidence is described in [client compatibility](compat/README.md);
this hosted command has not been newly verified by this documentation update.

The generated Hermes three-plugin pack still contains `OWNER` publishing
placeholders in `compat/install-pins.json`. It is **not ready for public use**
until the real repository owners and reviewed commit pins are configured and
the pack is regenerated and verified.

For another host, use its plugin-loading mechanism with the portable package
(`plugin.json`, `mcp.json`, `skills/`). Host support and verification vary;
see [client compatibility](compat/README.md). Loading an MCP server alone does
not establish that the skill and full workflow work in that host.

## Run from source

From a checkout, you can run the existing CLI without npm installation:

```bash
node bin/jobsss --help
node bin/jobsss doctor --data "$HOME/.local/share/jobsss"
node bin/jobsss start --data "$HOME/.local/share/jobsss"
```

This works with Node.js 22+ and has no npm runtime dependencies. The plugin host
runs the MCP server with its own data directory. Manual MCP configuration and
native release builds are covered in the [technical reference](TECHNICAL.md).

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `node` or `npm` is missing | Install Node.js 22+ in the environment where your agent runs. |
| `jobsss` is missing after a global install | Check that npm's global executable directory is on your PATH. |
| No tools in the current chat | Start a new Codex chat, or reload MCP/start a new Hermes session. |
| Resume PDF export is unavailable | Check `doctor.resumeRenderer`; make Chrome/Edge available to the runtime, or set `JOBSSS_RESUME_BROWSER` to its executable. |
| Hermes reports zero tool/hook registrations | Check enabled status and the next session's MCP tools; portable registration is session-scoped. |

For loader behavior, consent handling, package generation, and service PATH
checks, see [install surface implementation notes](TECHNICAL.md#install-surface-implementation-notes).

Generated project configuration follows [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex skill locations](https://learn.chatgpt.com/docs/build-skills), and [Claude Code project MCP setup](https://code.claude.com/docs/en/mcp).
