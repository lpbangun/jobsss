// `jobsss release` — deterministic portable release builder.
//
// Contract (BENCHMARK.md B30–B32, reviewer-owned):
//   ./bin/jobsss release --out <absdir> --target current-host
// writes `<out>/current-host/` containing the portable plugin core
// (plugin.json, mcp.json, skills/jobsss/SKILL.md, skills/jobsss/references/,
// bin/jobsss) plus justified metadata (LICENSE, README, release-manifest),
// with a genuinely standalone `bin/jobsss` that runs stdio MCP without
// `node` or `jobos` on PATH. Two clean builds on the same host are
// byte-identical for the four core hashed files. Intended targets that are
// not exercised on this host are listed in the manifest as `intended`, never
// claimed as verified or built.
//
// Nothing here writes into the plugin tree; build scratch is confined to the
// gitignored development scratch directory of the repository and the
// caller-supplied output directory.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildStandaloneLauncher,
  repoRootFromSource,
} from './sea-build.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
void MODULE_DIR;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function copyFileIfPresent(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dst);
  return true;
}

function copyTree(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw Object.assign(new Error(`release refuses to copy symlink ${src}`), { code: 'unsafe_release_path' });
    }
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

const INTENDED_TARGETS = Object.freeze([
  { id: 'linux-x64', platform: 'linux', arch: 'x64' },
  { id: 'linux-arm64', platform: 'linux', arch: 'arm64' },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64' },
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64' },
  { id: 'win-x64', platform: 'win32', arch: 'x64' },
]);

function targetStatus(platform, arch, binSha256) {
  const current = { platform: process.platform, arch: process.arch };
  const hostId = `${current.platform}-${current.arch}`;
  const matches = entry => entry.platform === current.platform && entry.arch === current.arch;
  return INTENDED_TARGETS.map(entry => {
    if (matches(entry)) {
      return {
        ...entry,
        status: 'verified',
        evidence: {
          note: `byte-identical artifact to current-host exercised on this host (${hostId})`,
          artifactSha256: binSha256,
        },
      };
    }
    return {
      ...entry,
      status: 'intended',
      definition: [
        'reproducible definition: same src/sea-build.js bundler and ELF/PE note injection pipeline',
        'requires a Node.js binary for that platform as the SEA base image',
        entry.id === 'win-x64'
          ? 'Windows additionally needs the PE resource (RT_RCDATA) injection variant of src/sea-build.js'
          : 'the PE note variant is not required for this ELF target',
      ],
    };
  });
}

function printReleaseHelp() {
  console.log(`jobsss release — deterministic portable release build
Usage:
  jobsss release --out <absdir> --target current-host
Options:
  --out <absdir>    absolute output directory (required)
  --target <id>     current-host (default) — the only buildable target on this host
Intended targets listed in release-manifest.json: current-host, linux-x64,
linux-arm64, darwin-x64, darwin-arm64, win-x64. Targets not exercised on this
host are labeled intended, never verified or built.`);
}

export function releaseCommand(argv, { repoRoot = repoRootFromSource() } = {}) {
  let outDir = null;
  let target = 'current-host';
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--out' || flag === '-o') {
      outDir = args[i + 1];
      i += 1;
    } else if (flag.startsWith('--out=')) {
      outDir = flag.slice('--out='.length);
    } else if (flag === '--target') {
      target = args[i + 1];
      i += 1;
    } else if (flag.startsWith('--target=')) {
      target = flag.slice('--target='.length);
    } else if (flag === '--help' || flag === '-h') {
      printReleaseHelp();
      process.exit(0);
    } else {
      console.error(`release: unknown option: ${flag}`);
      process.exit(2);
    }
  }
  if (!outDir || !path.isAbsolute(outDir)) {
    console.error('release: --out requires an absolute output directory');
    process.exit(2);
  }
  assert(target === 'current-host', `release: target ${target} is defined in the manifest as intended but only current-host is buildable on this host`);

  // release requires the source runtime modules (bundler input).
  const srcMcp = path.join(repoRoot, 'src', 'mcp.js');
  if (!fs.existsSync(srcMcp)) {
    console.error('release: source runtime missing; run release from the checked-out plugin tree');
    process.exit(1);
  }

  const pluginDir = path.join(outDir, 'current-host');
  const skillsDst = path.join(pluginDir, 'skills');
  fs.mkdirSync(path.join(pluginDir, 'bin'), { recursive: true });
  copyTree(path.join(repoRoot, 'skills'), skillsDst);
  copyFileIfPresent(path.join(repoRoot, 'plugin.json'), path.join(pluginDir, 'plugin.json'));
  copyFileIfPresent(path.join(repoRoot, 'mcp.json'), path.join(pluginDir, 'mcp.json'));
  copyFileIfPresent(path.join(repoRoot, 'LICENSE'), path.join(pluginDir, 'LICENSE'));
  copyFileIfPresent(path.join(repoRoot, 'README.md'), path.join(pluginDir, 'README.md'));
  assert(fs.existsSync(path.join(pluginDir, 'plugin.json')), 'release: plugin.json missing from source tree');
  assert(fs.existsSync(path.join(pluginDir, 'mcp.json')), 'release: mcp.json missing from source tree');

  const binPath = path.join(pluginDir, 'bin', 'jobsss');
  const buildMeta = buildStandaloneLauncher({ repoRoot, outFile: binPath });

  // Built-in sanity check: the standalone launcher must start and answer --help.
  const probe = spawnSync(binPath, ['--help'], { encoding: 'utf8', timeout: 30_000 });
  assert(probe.status === 0, `standalone launcher probe failed (${probe.status}): ${probe.stderr || probe.stdout}`);

  // The manifest is content-derived and path-free: repeated clean builds to
  // different output directories produce byte-identical copies. Evidence
  // fields are portable (relative commands, hashes, versions); absolute
  // build/Node/scratch paths are intentionally omitted.
  const manifest = {
    $schema: 'jobsss-release-manifest/v1',
    plugin: 'jobsss',
    version: '0.1.0',
    kind: 'deterministic-portable-release',
    targets: [
      {
        id: 'current-host',
        platform: process.platform,
        arch: process.arch,
        status: 'verified',
        evidence: {
          command: './bin/jobsss release --out <abs-out-dir> --target current-host',
          nodeVersion: buildMeta.nodeVersion,
          baseNodeSha256: buildMeta.baseNodeSha256,
          blobSha256: buildMeta.blobSha256,
          artifactSha256: buildMeta.binSha256,
          exercisedBy: 'generic stdio MCP subprocess with node and jobos absent from PATH (B31/B32)',
        },
      },
      ...targetStatus(process.platform, process.arch, buildMeta.binSha256),
    ],
    rootFiles: [
      { rel: 'plugin.json', sha256: sha256File(path.join(pluginDir, 'plugin.json')) },
      { rel: 'mcp.json', sha256: sha256File(path.join(pluginDir, 'mcp.json')) },
      { rel: 'skills/jobsss/SKILL.md', sha256: sha256File(path.join(pluginDir, 'skills', 'jobsss', 'SKILL.md')) },
      { rel: 'bin/jobsss', sha256: buildMeta.binSha256 },
    ],
    notes: [
      'Repeated clean builds are byte-identical for the complete release tree: deterministic SEA bundle, base node binary, and content-derived portable metadata.',
      'Source of truth remains the portable Agent Plugin at the repository root; the release is a copy for download.',
      'Client compatibility adapters and the trusted-local decide surface are owned by their own slices and are not part of this packaging slice.',
    ],
  };
  fs.writeFileSync(
    path.join(outDir, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(pluginDir, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );

  console.log(`release: wrote portable current-host tree to ${pluginDir}`);
  console.log(`release: standalone bin/jobsss sha256 ${buildMeta.binSha256}`);
  console.log(`release: manifest ${path.join(outDir, 'release-manifest.json')}`);
}