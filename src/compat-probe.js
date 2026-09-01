// JobSSS client compatibility probes and thin adapter generation.
//
// Contract (BENCHMARK.md B33–B35, B41, reviewer-owned):
//   `./bin/jobsss compat-probe --client <pi|omp|codex|hermes|claude>
//   --config-dir <temp> --plugin-root <plugin>` exits 0 and prints a JSON
//   payload whose `status` is `verified` or `unverified`.
//
// Honesty rules:
//   - `verified` is claimed only after a real isolated launch in temporary
//     configuration proved that the client started the JobSSS runtime
//     (`./bin/jobsss mcp --data <dir>`) and observed its tools.
//   - Probes always use temporary HOME/XDG and per-client home/state
//     overrides under `--config-dir`; real client profiles are never read or
//     written.
//   - A client that cannot be proven in the isolated environment is labeled
//     `unverified` with an exact reason, never `verified`.
//
// Adapting is thin by construction: adapters are generated config/pointer
// files that reference the canonical skill (`skills/jobsss/SKILL.md`) and the
// bundled runtime (`./bin/jobsss`) with absolute launcher/data paths. They
// contain no duplicated policy, tools, or business logic — this module only
// renders config text and runs probes; all product behavior lives in the
// canonical runtime.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const COMPAT_CLIENTS = Object.freeze(['pi', 'omp', 'codex', 'hermes', 'claude']);

const PROBE_TIMEOUT_MS = 45_000;
const VERSION_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Client discovery and process capture.
// ---------------------------------------------------------------------------

/**
 * Resolve the real user home directory even when HOME is overridden to a
 * temporary directory (the reviewer probe environment does exactly that).
 * Uses /etc/passwd for the current uid so common per-user install locations
 * can still be discovered without hardcoding a username.
 */
function realHome() {
  try {
    if (typeof process.getuid === 'function') {
      const uid = process.getuid();
      const text = fs.readFileSync('/etc/passwd', 'utf8');
      for (const line of text.split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 6 && parts[0] && Number(parts[2]) === uid && parts[5] && parts[5].startsWith('/')) {
          return parts[5];
        }
      }
    }
  } catch {
    /* fall through to os.homedir() */
  }
  return os.homedir();
}

function commonInstallDirs() {
  const home = realHome();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.hermes', 'node', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
}

function findClient(name) {
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [...pathDirs, ...commonInstallDirs()].map(dir => path.join(dir, name));
  const seen = new Set();
  for (const abs of candidates) {
    if (seen.has(abs)) continue;
    seen.add(abs);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isFile() && (stat.mode & 0o111)) return abs;
  }
  return null;
}

function runCapture(bin, args, env, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise(resolve => {
    let child;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr, timedOut });
    };
    child.on('error', () => finish(null));
    child.on('close', code => finish(code));
  });
}

async function versionOf(bin, env) {
  const res = await runCapture(bin, ['--version'], env || process.env, VERSION_TIMEOUT_MS);
  const text = (res.stdout || res.stderr || '').trim().split('\n')[0] || '';
  return text.slice(0, 80) || null;
}

// ---------------------------------------------------------------------------
// Isolated probe environment.
// ---------------------------------------------------------------------------

/**
 * Temporary sandbox for one client probe: fresh HOME, XDG roots, blank
 * provider keys, and a JobOS-neutral environment. Per-client home overrides
 * (CODEX_HOME, HERMES_HOME, CLAUDE_CONFIG_DIR, ...) are layered on top.
 */
function probeEnv(configDir, dataDir, extra = {}) {
  const home = path.join(configDir, 'home');
  const xdgConfig = path.join(configDir, 'xdg-config');
  const xdgData = path.join(configDir, 'xdg-data');
  for (const dir of [home, xdgConfig, xdgData]) fs.mkdirSync(dir, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    PLUGIN_DATA: dataDir,
    JOBOS_BIN: '',
    JOBOS_HOME: path.join(configDir, 'jobos-home'),
    JOBOS_WORKSPACE: '',
    JOBOS_LLM_API_KEY: '',
    JOBOS_LLM_PROVIDER: '',
    JOBOS_LLM_MODEL: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    NODE_PATH: '',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Per-client probes.
// ---------------------------------------------------------------------------

async function probePi(bin, ctx) {
  // Isolated env first so version detection and any client side effects stay
  // inside the temporary sandbox and never touch a real profile.
  const env = probeEnv(ctx.configDir, ctx.dataDir, { PI_CODING_AGENT_DIR: path.join(ctx.configDir, 'pi-agent') });
  const version = await versionOf(bin, env);
  return {
    status: 'unverified',
    version,
    command: `${bin} --version`,
    reason: 'stock Pi core exposes native skill loading but no documented native stdio MCP host; proving the JobSSS runtime would require a custom extension tool bridge plus a model-authorized session, which is outside the thin-adapter scope',
    evidence: ['binary present', 'skill loading is native; no native stdio MCP configuration is documented for the stock core'],
    notes: 'isolated availability check only; no MCP launch was claimed',
  };
}

async function probeOmp(bin, ctx) {
  const env = probeEnv(ctx.configDir, ctx.dataDir);
  const version = await versionOf(bin, env);
  return {
    status: 'unverified',
    version,
    command: `${bin} --version`,
    reason: 'this build exposes no mcp/plugin subcommand (both fall through to the launch help), and no documented native Agent Plugins loader was established; proving the JobSSS runtime would require an extension file plus a model-authorized session',
    evidence: ['binary present', 'no `mcp` or `plugin` subcommand available for a config-only adapter'],
    notes: 'isolated availability check only; no MCP launch was claimed',
  };
}

async function probeCodex(bin, ctx) {
  const codexHome = path.join(ctx.configDir, 'codex');
  fs.mkdirSync(codexHome, { recursive: true });
  const configToml =
    '# JobSSS thin adapter: references the canonical skill (skills/jobsss/SKILL.md)\n' +
    '# and bundled runtime (./bin/jobsss). No job-search policy or tools live here.\n' +
    '[mcp_servers.jobsss]\n' +
    `command = ${JSON.stringify(ctx.launcher)}\n` +
    `args = ["mcp", "--data", ${JSON.stringify(ctx.dataDir)}]\n`;
  fs.writeFileSync(path.join(codexHome, 'config.toml'), configToml, 'utf8');
  const env = probeEnv(ctx.configDir, ctx.dataDir, { CODEX_HOME: codexHome });
  const version = await versionOf(bin, env);
  const get = await runCapture(bin, ['mcp', 'get', 'jobsss'], env);
  const output = `${get.stdout}\n${get.stderr}`;
  const registered = get.code === 0 && /jobsss/i.test(output) && output.includes(ctx.launcher);
  return {
    status: 'unverified',
    version,
    command: `${bin} mcp get jobsss`,
    reason: 'isolated temporary CODEX_HOME registration is accepted and the JobSSS runtime is referenced by the generated config, but a live JobSSS tool exchange could not be proven because the agent session requires provider authentication (probe keys are blank by design)',
    evidence: registered
      ? ['config.toml registration accepted by `codex mcp get jobsss`', `registering ${ctx.launcher} with a temporary data dir`]
      : ['registration could not be verified'],
    notes: 'marked unverified, never verified, until a real authenticated isolated session proves the runtime launch',
  };
}

async function probeHermes(bin, ctx) {
  const hermesHome = path.join(ctx.configDir, 'hermes');
  fs.mkdirSync(hermesHome, { recursive: true });
  const configYaml =
    '# JobSSS thin adapter: references the canonical skill (skills/jobsss/SKILL.md)\n' +
    '# and bundled runtime (./bin/jobsss). No job-search policy or tools live here.\n' +
    'mcp_servers:\n' +
    '  jobsss:\n' +
    `    command: ${ctx.launcher}\n` +
    `    args: [mcp, --data, ${ctx.dataDir}]\n`;
  fs.writeFileSync(path.join(hermesHome, 'config.yaml'), configYaml, 'utf8');
  // HERMES_REVISION diverts Hermes' startup update check away from its live
  // git checkout. Without it, `check_for_updates()` runs `git fetch origin
  // --depth 1` inside the real install tree (e.g. ~/.hermes/hermes-agent),
  // which attempts to write .git/shallow.lock there. With HERMES_REVISION set
  // the check uses a read-only `git ls-remote` comparison instead, so the
  // probe process tree never writes to the real install: all probe state is
  // confined to --config-dir / the temporary HERMES_HOME.
  const env = probeEnv(ctx.configDir, ctx.dataDir, {
    HERMES_HOME: hermesHome,
    HERMES_ACCEPT_HOOKS: '1',
    HERMES_REVISION: '0000000000000000000000000000000000000000',
  });
  const version = await versionOf(bin, env);
  const res = await runCapture(bin, ['mcp', 'test', 'jobsss'], env);
  const output = `${res.stdout}\n${res.stderr}`;
  const connected = res.code === 0 && /connected/i.test(output) && /tools discovered/i.test(output) && /jobsss/i.test(output);
  const toolCount = (output.match(/tools discovered:\s*(\d+)/i) || [])[1] || null;
  return {
    status: connected ? 'verified' : 'unverified',
    version,
    command: `${bin} mcp test jobsss`,
    reason: connected ? undefined : '`hermes mcp test jobsss` did not report a clean connection',
    evidence: connected
      ? [
          `hermes mcp test connected to the bundled runtime in a temporary HERMES_HOME${toolCount ? ` and discovered ${toolCount} tools` : ''}`,
          `launcher: ${ctx.launcher}`,
          `data dir: ${ctx.dataDir}`,
        ]
      : ['connection test failed or timed out'],
    notes: connected ? 'real isolated launch: the client spawned the JobSSS stdio MCP server and observed its tools' : undefined,
  };
}

async function probeClaude(bin, ctx) {
  const claudeConfigDir = path.join(ctx.configDir, 'claude-config');
  fs.mkdirSync(claudeConfigDir, { recursive: true });
  const env = probeEnv(ctx.configDir, ctx.dataDir, { CLAUDE_CONFIG_DIR: claudeConfigDir });
  const version = await versionOf(bin, env);
  const add = await runCapture(bin, ['mcp', 'add', '--scope', 'user', 'jobsss', '--', ctx.launcher, 'mcp', '--data', ctx.dataDir], env);
  const list = await runCapture(bin, ['mcp', 'list'], env);
  const get = await runCapture(bin, ['mcp', 'get', 'jobsss'], env);
  const listOut = `${list.stdout}\n${list.stderr}`;
  const getOut = `${get.stdout}\n${get.stderr}`;
  const connected =
    add.code === 0
    && list.code === 0
    && /jobsss/i.test(listOut)
    && /connected/i.test(listOut)
    && (getOut.includes(ctx.launcher) || /jobsss/i.test(getOut));
  return {
    status: connected ? 'verified' : 'unverified',
    version,
    command: `${bin} mcp add --scope user jobsss -- ${ctx.launcher} mcp --data ${ctx.dataDir} && ${bin} mcp list`,
    reason: connected ? undefined : '`claude mcp list` did not report the jobsss server as Connected',
    evidence: connected
      ? [
          'claude mcp add registered the JobSSS stdio server in a temporary CLAUDE_CONFIG_DIR',
          'claude mcp list reported the jobsss server as Connected',
          `launcher: ${ctx.launcher}`,
          `data dir: ${ctx.dataDir}`,
        ]
      : ['registration or health check failed'],
    notes: connected ? 'real isolated launch: the client health-checked the JobSSS stdio MCP server' : undefined,
  };
}

async function probeClient(client, bin, ctx) {
  switch (client) {
    case 'pi': return probePi(bin, ctx);
    case 'omp': return probeOmp(bin, ctx);
    case 'codex': return probeCodex(bin, ctx);
    case 'hermes': return probeHermes(bin, ctx);
    case 'claude': return probeClaude(bin, ctx);
    default: throw new Error(`compat-probe: unknown client ${client}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

function printProbeHelp() {
  console.log(`jobsss compat-probe — isolated client compatibility probe
Usage:
  jobsss compat-probe --client <pi|omp|codex|hermes|claude> --config-dir <temp> --plugin-root <plugin>
Prints a JSON payload with status verified or unverified. All configuration is
temporary (HOME, XDG, and per-client home overrides under --config-dir); real
client profiles are never read or written. See compat/matrix.json.`);
}

function jsonPayload(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null) out[key] = entry;
  }
  return JSON.stringify(out, null, 2);
}

export async function runCompatProbe(argv, { pluginRoot } = {}) {
  let client = null;
  let configDir = null;
  let explicitPluginRoot = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => { i += 1; return argv[i]; };
    if (flag === '--client') client = value();
    else if (flag.startsWith('--client=')) client = flag.slice('--client='.length);
    else if (flag === '--config-dir') configDir = value();
    else if (flag.startsWith('--config-dir=')) configDir = flag.slice('--config-dir='.length);
    else if (flag === '--plugin-root') explicitPluginRoot = value();
    else if (flag.startsWith('--plugin-root=')) explicitPluginRoot = flag.slice('--plugin-root='.length);
    else if (flag === '--help' || flag === '-h') { printProbeHelp(); process.exit(0); }
    else {
      console.error(`compat-probe: unknown option ${flag}`);
      process.exit(2);
    }
  }
  if (!client || !COMPAT_CLIENTS.includes(client)) {
    console.error(`compat-probe: --client is required (one of ${COMPAT_CLIENTS.join(', ')})`);
    process.exit(2);
  }
  if (!configDir) {
    console.error('compat-probe: --config-dir <temp dir> is required');
    process.exit(2);
  }

  const resolvedPluginRoot = explicitPluginRoot
    ? fs.realpathSync(explicitPluginRoot)
    : pluginRoot || process.cwd();
  const launcher = path.join(resolvedPluginRoot, 'bin', 'jobsss');

  if (!fs.existsSync(launcher)) {
    console.log(jsonPayload({
      client,
      status: 'unverified',
      runtime: 'jobsss',
      reason: `plugin root is missing the bundled launcher ${launcher}`,
      pluginRoot: resolvedPluginRoot,
      isolated: true,
    }));
    process.exit(0);
  }

  const bin = findClient(client);
  if (!bin) {
    console.log(jsonPayload({
      client,
      status: 'unverified',
      runtime: 'jobsss',
      reason: `client binary ${client} was not found on PATH or in common install locations; the launch is unverified`,
      launcher,
      pluginRoot: resolvedPluginRoot,
      isolated: true,
    }));
    process.exit(0);
  }

  try {
    const dataDir = path.join(configDir, 'plugin-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const result = await probeClient(client, bin, {
      configDir,
      dataDir,
      launcher,
      pluginRoot: resolvedPluginRoot,
    });
    console.log(jsonPayload({
      client,
      status: result.status,
      runtime: 'jobsss',
      version: result.version || undefined,
      command: result.command || undefined,
      reason: result.reason || undefined,
      evidence: result.evidence || [],
      notes: result.notes || undefined,
      launcher,
      pluginRoot: resolvedPluginRoot,
      configDir,
      dataDir,
      isolated: true,
    }));
  } catch (error) {
    console.log(jsonPayload({
      client,
      status: 'unverified',
      runtime: 'jobsss',
      reason: `probe failed unexpectedly: ${error && error.message ? error.message : String(error)}`,
      isolated: true,
    }));
  }
  process.exit(0);
}