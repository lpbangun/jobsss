// Shared CLI routing for the bundled JobSSS runtime.
//
// Single source of truth for command dispatch: the source launcher
// (`bin/jobsss`) and the standalone release binary (built by
// `src/sea-build.js`) both route through `runCli`, so the released runtime
// behaves identically to the source runtime.
//
// JobOS attribution: launch/transport framing concepts are attributed to
// JobOS src/mcp.js and are reimplemented for the standalone PLUGIN_DATA
// runtime (see src/mcp.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFromArgv } from './mcp.js';
import { doctor, start } from './domain.js';
import { releaseCommand } from './release.js';
import { runCompatProbe } from './compat-probe.js';
import { decideCommand, decidePrintHelp } from './authority.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Standalone SEA bundles embed the runtime (there is no source tree next to
// the binary); ROOT then derives from the binary's own location at load
// time. Source mode keeps the normal source-tree layout. The flag is
// `typeof`-safe so source mode never references an undeclared binding.
const IS_STANDALONE =
  typeof __sea !== 'undefined' && !!__sea && __sea.standalone === true;

function printHelp() {
  console.log(`jobsss bundled runtime v0.1.0
Usage:
  jobsss mcp --data <dir>     Start MCP stdio server with PLUGIN_DATA
  jobsss doctor --data <dir>  Diagnose bundled runtime
  jobsss start --data <dir>   Initialize PLUGIN_DATA
  jobsss release --out <dir> --target <id> [--node-binary <path>]
                              Build a deterministic standalone release
                              (targets: current-host linux-x64 linux-arm64
                              darwin-x64 darwin-arm64 win-x64; non-host
                              fixture builds stay unverified)
  jobsss compat-probe --client <pi|omp|codex|hermes|claude> --config-dir <temp> --plugin-root <plugin>
                              Probe one client in an isolated temporary config

Human-only authority (not available to MCP):
  jobsss decide --data <dir> --list
                              List pending human decisions
  jobsss decide --data <dir> --action <action> --id <id> --revision <n> --content-hash <sha256>
                              Complete one human decision via the trusted local CLI
  jobsss decide --help        Show the decide surface in full`);
}

export function runCli(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }
  if (!IS_STANDALONE) {
    const srcMcp = path.join(ROOT, 'src', 'mcp.js');
    if (!fs.existsSync(srcMcp)) {
      console.error(`missing bundled runtime: ${srcMcp}`);
      process.exit(1);
    }
  }
  if (cmd === 'mcp') {
    runFromArgv(argv.slice(1));
    return;
  }
  // Optional direct CLI shims for manual smoke and release builds (not used
  // by the MCP journey tests).
  if (cmd === 'doctor' || cmd === 'start') {
    const idx = argv.indexOf('--data');
    const dir = idx !== -1 ? argv[idx + 1] : process.env.PLUGIN_DATA;
    if (!dir) {
      console.error('requires --data <dir>');
      process.exit(2);
    }
    const out = cmd === 'doctor' ? doctor(dir) : start(dir);
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === 'release') {
    releaseCommand(argv.slice(1), { repoRoot: ROOT });
    return;
  }
  if (cmd === 'compat-probe') {
    runCompatProbe(argv.slice(1), { pluginRoot: ROOT });
    return;
  }
  if (cmd === 'decide') {
    if (argv.slice(1).includes('--help') || argv.slice(1).includes('-h')) {
      decidePrintHelp();
      process.exit(0);
    }
    decideCommand(argv.slice(1));
    return;
  }
  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}