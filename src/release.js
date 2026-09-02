// `jobsss release` — deterministic portable release builder.
//
// Contract (BENCHMARK.md B30–B32, B42–B45, reviewer-owned):
//   ./bin/jobsss release --out <absdir> --target <id> [--node-binary <path>]
// writes `<out>/<id>/` containing the portable plugin core (plugin.json,
// mcp.json, skills/jobsss/SKILL.md, skills/jobsss/references/, bin/jobsss —
// or bin/jobsss.exe for Windows) plus justified metadata (LICENSE, README,
// release-manifest), with a genuinely standalone `bin/jobsss` that runs
// stdio MCP without `node` or `jobos` on PATH.
//
// Targets come from src/packaging.js (the separated native-format
// definitions module): linux-x64, linux-arm64 (ELF), darwin-x64,
// darwin-arm64 (Mach-O), win-x64 (PE32+), plus the current-host alias which
// resolves to the host-matching definition and the host's own Node binary.
// A target earns `verified` only when it is built from a real matching host
// executable and exercised on this host. A build using a `--node-binary`
// that is a synthetic native-format fixture, or a build on a non-matching
// host, is labeled `unverified` — a fixture validates the definition, never
// the platform runtime.
//
// Determinism: the SEA blob is content-derived (identical entry text), the
// native injection is byte-deterministic for identical inputs, and the
// manifest carries no wall-clock timestamps or absolute build/output paths,
// so two clean builds of the same target are byte-identical.
//
// Nothing here writes into the plugin tree; build scratch is confined to the
// gitignored development scratch directory of the repository and the
// caller-supplied output directory.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TARGETS, identifyExecutable, injectSeaPayload, targetById } from './packaging.js';
import { generateSeaBlob, hostTargetId, nodeBinary, repoRootFromSource } from './sea-build.js';

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

function printReleaseHelp() {
  console.log(`jobsss release — deterministic portable release build
Usage:
  jobsss release --out <absdir> --target <target> [--node-binary <path>]
Options:
  --out <absdir>     absolute output directory (required)
  --target <id>      current-host (default), linux-x64, linux-arm64,
                     darwin-x64, darwin-arm64, or win-x64
  --node-binary <p>  base Node executable of the matching native format and
                     architecture; required for a fixture-level build of a
                     non-host target, and validated strictly when provided
Targets not built from a real matching host executable are labeled
unverified in release-manifest.json; a synthetic fixture exercise is a
definition test, never platform verification.`);
}

function manifestTargetEntries({ builtTargetId, hostId, isCurrentHostBuild, fixtureLevel, binSha, meta }) {
  const entries = [];
  const currentHost = { id: 'current-host', platform: process.platform, arch: process.arch };
  if (isCurrentHostBuild && !fixtureLevel) {
    currentHost.status = 'verified';
    currentHost.evidence = {
      command: './bin/jobsss release --out <abs-out-dir> --target current-host',
      nodeVersion: meta.nodeVersion,
      baseNodeSha256: meta.baseNodeSha256,
      blobSha256: meta.blobSha256,
      artifactSha256: binSha,
      exercisedBy: 'generic stdio MCP subprocess with node and jobos absent from PATH (B31/B32)',
    };
  } else {
    currentHost.status = 'unverified';
    currentHost.notes = ['this output does not contain a current-host artifact; the current-host release is verified separately on a matching host'];
  }
  entries.push(currentHost);
  for (const target of TARGETS) {
    const isBuilt = target.id === builtTargetId;
    const hostMatch = target.id === hostId;
    if (isBuilt && hostMatch && !fixtureLevel) {
      entries.push({
        id: target.id,
        platform: target.platform,
        arch: target.arch,
        status: 'verified',
        evidence: {
          note: 'built from the real host Node executable and exercised on this host',
          artifactSha256: binSha,
        },
      });
    } else {
      entries.push({
        id: target.id,
        platform: target.platform,
        arch: target.arch,
        status: 'unverified',
        notes: isBuilt
          ? [`definition implemented in src/packaging.js and exercised only with a synthetic ${target.format} fixture; not platform verification`, 'unverified until exercised on a real matching host']
          : ['definition implemented in src/packaging.js; not exercised in this output'],
      });
    }
  }
  return entries;
}

export function releaseCommand(argv, { repoRoot = repoRootFromSource() } = {}) {
  let outDir = null;
  let targetArg = 'current-host';
  let nodeBinaryArg = null;
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--out' || flag === '-o') {
      outDir = args[i + 1];
      i += 1;
    } else if (flag.startsWith('--out=')) {
      outDir = flag.slice('--out='.length);
    } else if (flag === '--target') {
      targetArg = args[i + 1];
      i += 1;
    } else if (flag.startsWith('--target=')) {
      targetArg = flag.slice('--target='.length);
    } else if (flag === '--node-binary') {
      nodeBinaryArg = args[i + 1];
      i += 1;
    } else if (flag.startsWith('--node-binary=')) {
      nodeBinaryArg = flag.slice('--node-binary='.length);
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

  const isCurrentHostBuild = targetArg === 'current-host';
  const definition = isCurrentHostBuild ? null : targetById(targetArg);
  if (!isCurrentHostBuild && !definition) {
    throw new Error(`release: unsupported target ${targetArg}; targets are current-host, linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64`);
  }

  const hostId = hostTargetId();
  const hostDef = targetById(hostId);
  const injectTargetId = isCurrentHostBuild ? hostId : targetArg;
  const hostMatch = isCurrentHostBuild || definition.id === hostId;

  // release requires the source runtime modules (bundler input).
  const srcMcp = path.join(repoRoot, 'src', 'mcp.js');
  if (!fs.existsSync(srcMcp)) {
    console.error('release: source runtime missing; run release from the checked-out plugin tree');
    process.exit(1);
  }

  // Resolve the base executable: an explicit --node-binary (validated
  // strictly against the target definition) or the host's own Node binary
  // when the target matches the host.
  let base;
  let fixtureLevel = false;
  if (nodeBinaryArg) {
    let raw;
    try {
      raw = fs.readFileSync(nodeBinaryArg);
    } catch (cause) {
      throw new Error(`release: invalid --node-binary: cannot read ${nodeBinaryArg} (${cause.message})`);
    }
    const ident = identifyExecutable(raw);
    const expected = isCurrentHostBuild ? hostDef : definition;
    if (!expected) throw new Error(`release: unsupported target ${targetArg}`);
    if (ident.format !== expected.format) {
      throw new Error(
        `release: mismatched --node-binary: a ${ident.format}/${ident.arch} executable was provided but target ${expected.id} requires a ${expected.format}/${expected.arch} executable`
      );
    }
    if (ident.arch !== expected.arch) {
      throw new Error(
        `release: wrong architecture for --node-binary: a ${ident.format}/${ident.arch} executable was provided but target ${expected.id} requires a ${expected.format}/${expected.arch} executable`
      );
    }
    base = raw;
    let providedReal = null;
    try {
      providedReal = fs.realpathSync(nodeBinaryArg);
    } catch {
      providedReal = null;
    }
    fixtureLevel = !(hostMatch && providedReal === process.execPath);
  } else if (hostMatch) {
    base = fs.readFileSync(process.execPath);
  } else {
    throw new Error(
      `release: target ${targetArg} is unavailable on this host (${process.platform}/${process.arch}); ` +
      `pass --node-binary with a matching ${definition.format}/${definition.arch} base executable for a fixture-level build, which remains unverified and is not platform verification`
    );
  }

  // Deterministic SEA payload from the checked-out bundle; the runner is the
  // real host Node so fixture-level builds still produce a valid blob.
  const { blob } = generateSeaBlob({ repoRoot, nodeBinary: process.execPath });
  const injected = injectSeaPayload({ target: injectTargetId, executable: base, blob });

  const outDirName = isCurrentHostBuild ? 'current-host' : targetArg;
  const pluginDir = path.join(outDir, outDirName);
  const skillsDst = path.join(pluginDir, 'skills');
  fs.mkdirSync(path.join(pluginDir, 'bin'), { recursive: true });
  copyTree(path.join(repoRoot, 'skills'), skillsDst);
  copyFileIfPresent(path.join(repoRoot, 'plugin.json'), path.join(pluginDir, 'plugin.json'));
  copyFileIfPresent(path.join(repoRoot, 'mcp.json'), path.join(pluginDir, 'mcp.json'));
  copyFileIfPresent(path.join(repoRoot, 'LICENSE'), path.join(pluginDir, 'LICENSE'));
  copyFileIfPresent(path.join(repoRoot, 'README.md'), path.join(pluginDir, 'README.md'));
  assert(fs.existsSync(path.join(pluginDir, 'plugin.json')), 'release: plugin.json missing from source tree');
  assert(fs.existsSync(path.join(pluginDir, 'mcp.json')), 'release: mcp.json missing from source tree');

  const launcherRel = !isCurrentHostBuild && definition.format === 'pe' ? path.join('bin', 'jobsss.exe') : path.join('bin', 'jobsss');
  const binPath = path.join(pluginDir, launcherRel);
  fs.writeFileSync(binPath, injected);
  fs.chmodSync(binPath, 0o755);

  // Real host builds get a smoke probe of the standalone launcher; fixture
  // builds cannot run on this host and must not be probed.
  if (hostMatch && !fixtureLevel) {
    const probe = spawnSync(binPath, ['--help'], { encoding: 'utf8', timeout: 30_000 });
    assert(probe.status === 0, `standalone launcher probe failed (${probe.status}): ${probe.stderr || probe.stdout}`);
  }

  const binSha = crypto.createHash('sha256').update(injected).digest('hex');
  const blobSha = crypto.createHash('sha256').update(blob).digest('hex');
  const baseSha = crypto.createHash('sha256').update(base).digest('hex');
  const meta = {
    nodeVersion: process.version,
    baseNodeSha256: baseSha,
    blobSha256: blobSha,
    binSha256: binSha,
  };

  // The manifest is content-derived and path-free: repeated clean builds to
  // different output directories produce byte-identical copies. Evidence
  // fields are portable (relative commands, hashes, versions); absolute
  // build/Node/scratch/output paths are intentionally omitted.
  const manifest = {
    $schema: 'jobsss-release-manifest/v1',
    plugin: 'jobsss',
    version: '0.1.0',
    kind: 'deterministic-portable-release',
    builtTarget: isCurrentHostBuild ? 'current-host' : targetArg,
    targets: manifestTargetEntries({
      builtTargetId: injectTargetId,
      hostId,
      isCurrentHostBuild,
      fixtureLevel,
      binSha,
      meta,
    }),
    rootFiles: [
      { rel: 'plugin.json', sha256: sha256File(path.join(pluginDir, 'plugin.json')) },
      { rel: 'mcp.json', sha256: sha256File(path.join(pluginDir, 'mcp.json')) },
      { rel: 'skills/jobsss/SKILL.md', sha256: sha256File(path.join(pluginDir, 'skills', 'jobsss', 'SKILL.md')) },
      { rel: launcherRel, sha256: binSha },
    ],
    notes: [
      'Repeated clean builds are byte-identical for the complete release tree: deterministic SEA bundle, base executable, and content-derived portable metadata.',
      'Source of truth remains the portable Agent Plugin at the repository root; the release is a copy for download.',
      'Non-host targets are labeled unverified: a synthetic fixture exercise validates the native-format definition, never the platform runtime.',
      'Client compatibility adapters and the trusted-local decide surface are owned by their own slices and are not part of this packaging slice.',
    ],
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, 'release-manifest.json'), manifestText, 'utf8');
  fs.writeFileSync(path.join(pluginDir, 'release-manifest.json'), manifestText, 'utf8');

  console.log(`release: wrote portable ${targetArg} tree to ${pluginDir}`);
  console.log(`release: standalone bin/jobsss sha256 ${binSha}`);
  console.log(`release: manifest ${path.join(outDir, 'release-manifest.json')}`);
}