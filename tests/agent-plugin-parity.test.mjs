// Parity gates for the thin Agent Plugins install package at ./agent-plugin/.
//
// The repository root stays the one canonical JobSSS plugin; ./agent-plugin/ is a
// mechanical byte-for-byte mirror of the runtime + skill surface so a host can
// install the product without dragging in reviewer-owned benchmark evidence.
// This suite fails the moment the mirror drifts: re-run
// `node scripts/build-agent-plugin.mjs` after any canonical change.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import {
  PACKAGE_DIRNAME,
  REPO_ROOT,
  canonicalMirrorFiles,
  packageDrift,
  packageFiles
} from '../scripts/build-agent-plugin.mjs';
import { secretFindings, validatePluginManifest, validateSkillDocument } from './helpers/jobsss-gate0.mjs';

const PACKAGE_DIR = path.join(REPO_ROOT, PACKAGE_DIRNAME);
const REL = (rel) => path.join(PACKAGE_DIRNAME, rel).split(path.sep).join('/');

function readPackage(rel) {
  return readFileSync(path.join(PACKAGE_DIR, rel), 'utf8');
}

/** Relative specifiers a Node module resolves at load time (static import / re-export / require). */
function relativeSpecifiers(text) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*['"](\.[^'"]*)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
    /\bimport\s*['"](\.[^'"]*)['"]/g,
    /\brequire\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

test('P1 agent-plugin mirrors the canonical tree byte-for-byte', () => {
  assert.equal(existsSync(PACKAGE_DIR), true, `${PACKAGE_DIRNAME}/ is missing — run: node scripts/build-agent-plugin.mjs`);
  const drift = packageDrift(REPO_ROOT);
  assert.deepEqual(drift.missing, [], `package files missing from ${PACKAGE_DIRNAME}/: ${drift.missing.join(', ')}`);
  assert.deepEqual(drift.extra, [], `unexpected files in ${PACKAGE_DIRNAME}/: ${drift.extra.join(', ')}`);
  assert.deepEqual(
    drift.changed,
    [],
    `package bytes drifted from the canonical tree (re-run scripts/build-agent-plugin.mjs): ${drift.changed
      .map(item => item.rel)
      .join(', ')}`
  );
  assert.ok(drift.files.length >= 30, `package mirror is suspiciously small (${drift.files.length} files)`);
});

test('P2 agent-plugin ships the install surface and nothing reviewer-owned', () => {
  const files = packageFiles(PACKAGE_DIR);
  for (const rel of ['plugin.json', 'mcp.json', 'bin/jobsss', 'skills/jobsss/SKILL.md']) {
    assert.ok(files.includes(rel), `${rel} must ship inside ${PACKAGE_DIRNAME}/`);
  }
  assert.ok(files.some(rel => rel.startsWith('src/')), 'the bundled runtime src/ must ship inside the package');
  // Reviewer-owned evidence and development trees must never enter the install surface.
  for (const banned of ['BENCHMARK.md', 'README.md', 'AGENTS.md', 'LICENSE']) {
    assert.equal(files.includes(banned), false, `${banned} must stay out of the install package`);
  }
  for (const bannedPrefix of ['tests/', 'docs/', 'evaluation/', 'contracts/', 'compat/', 'scripts/', '.github/', '.hermes/']) {
    assert.deepEqual(
      files.filter(rel => rel.startsWith(bannedPrefix)),
      [],
      `${bannedPrefix} must stay out of the install package`
    );
  }
});

test('P3 package manifests stay single-sourced from the canonical root', () => {
  const rootPlugin = JSON.parse(readFileSync(path.join(REPO_ROOT, 'plugin.json'), 'utf8'));
  const packagePlugin = JSON.parse(readPackage('plugin.json'));
  assert.deepEqual(packagePlugin, rootPlugin, 'agent-plugin/plugin.json must equal the canonical root manifest');
  assert.deepEqual(validatePluginManifest(packagePlugin), [], 'package plugin.json must satisfy the frozen manifest rules');

  const rootMcp = JSON.parse(readFileSync(path.join(REPO_ROOT, 'mcp.json'), 'utf8'));
  const packageMcp = JSON.parse(readPackage('mcp.json'));
  assert.deepEqual(packageMcp, rootMcp, 'agent-plugin/mcp.json must equal the canonical root manifest');
  assert.deepEqual(Object.keys(packageMcp), ['$schema', 'mcpServers'], 'mcp.json keeps the frozen top-level shape');
  const server = packageMcp.mcpServers.jobsss;
  assert.deepEqual(server, {
    type: 'stdio',
    command: './bin/jobsss',
    args: ['mcp', '--data', '${PLUGIN_DATA}']
  });
  const commandPath = path.resolve(PACKAGE_DIR, server.command);
  assert.ok(
    commandPath.startsWith(`${PACKAGE_DIR}${path.sep}`),
    `package stdio command must resolve inside the package, got ${commandPath}`
  );
  assert.equal(existsSync(commandPath), true, 'package stdio command must exist inside the package');
});

test('P4 package skill is the canonical skill, unforked', () => {
  const rootSkill = readFileSync(path.join(REPO_ROOT, 'skills', 'jobsss', 'SKILL.md'));
  const packageSkill = readFileSync(path.join(PACKAGE_DIR, 'skills', 'jobsss', 'SKILL.md'));
  assert.equal(packageSkill.equals(rootSkill), true, 'package SKILL.md must stay byte-identical to skills/jobsss/SKILL.md');
  const { problems } = validateSkillDocument(packageSkill.toString('utf8'), 'agent-plugin/skills/jobsss/SKILL.md');
  assert.deepEqual(problems, [], problems.join('; '));
  for (const rel of ['references/client-compatibility.md', 'references/human-only-handoffs.md', 'references/standalone-journey.md']) {
    const canonicalRel = path.posix.join('skills', 'jobsss', rel);
    assert.equal(filesEqual(canonicalRel), true, `${canonicalRel} must stay byte-identical to the canonical reference`);
  }
});

function filesEqual(rel) {
  const canonical = readFileSync(path.join(REPO_ROOT, rel));
  const mirrored = readFileSync(path.join(PACKAGE_DIR, rel));
  return canonical.equals(mirrored);
}

test('P5 package runtime closure is complete inside the package', () => {
  const files = packageFiles(PACKAGE_DIR);
  const modules = ['bin/jobsss', ...files.filter(rel => rel.startsWith('src/') && rel.endsWith('.js'))];
  assert.ok(modules.length > 10, `expected the bundled runtime modules inside the package, found ${modules.length}`);
  const missing = [];
  let edges = 0;
  for (const rel of modules) {
    const dir = path.dirname(rel);
    for (const specifier of relativeSpecifiers(readPackage(rel))) {
      edges += 1;
      const target = path.posix.normalize(path.posix.join(dir, specifier));
      if (target.startsWith('..')) {
        missing.push(`${rel} -> ${specifier} escapes the package root`);
        continue;
      }
      if (!files.includes(target)) missing.push(`${rel} -> ${specifier} (${target} not shipped)`);
    }
  }
  assert.ok(edges > 20, `expected the runtime to import its own modules, found ${edges} relative edges`);
  assert.deepEqual(missing, [], `package runtime is not self-contained: ${missing.join('; ')}`);
});

test('P6 package carries no secrets or user paths', () => {
  // Scope: the agent-facing surface the frozen gate scans too (manifests + skill).
  // Runtime code under src/ is byte-identical to the canonical root (P1), whose
  // secret/user-path behaviour is already asserted by the frozen gates.
  const files = packageFiles(PACKAGE_DIR).filter(rel => !rel.startsWith('src/') && !rel.startsWith('bin/'));
  assert.ok(files.length >= 5, `expected manifests and the skill in the package, found ${files.length} files`);
  const findings = files.flatMap(rel => secretFindings(readPackage(rel), REL(rel)));
  assert.deepEqual(findings, [], `package leaks secrets or user paths: ${findings.join('; ')}`);
});

test('P7 parity checker detects drift (negative control)', () => {
  const canonical = canonicalMirrorFiles(REPO_ROOT);
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'jobsss-agent-plugin-'));
  try {
    const copy = path.join(scratch, PACKAGE_DIRNAME);
    cpSync(PACKAGE_DIR, copy, { recursive: true });
    const clean = packageDrift(REPO_ROOT, copy);
    assert.equal(clean.ok, true, `a faithful copy must pass parity (${JSON.stringify(clean.changed)})`);

    const victim = path.join(copy, canonical.find(rel => rel === 'src/version.js'));
    writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n// drift\n`);
    const changed = packageDrift(REPO_ROOT, copy);
    assert.equal(changed.ok, false, 'a mutated package file must fail parity');
    assert.deepEqual(changed.changed.map(item => item.rel), ['src/version.js']);

    writeFileSync(victim, readFileSync(path.join(PACKAGE_DIR, 'src/version.js')));
    writeFileSync(path.join(copy, 'src', 'extra.js'), '// unexpected\n');
    assert.deepEqual(packageDrift(REPO_ROOT, copy).extra, ['src/extra.js'], 'an extra file must fail parity');

    rmSync(path.join(copy, 'src', 'extra.js'));
    rmSync(path.join(copy, 'mcp.json'));
    assert.deepEqual(packageDrift(REPO_ROOT, copy).missing, ['mcp.json'], 'a missing file must fail parity');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('P8 package preserves the launcher executable bit', () => {
  const executableClass = (abs) => Boolean(lstatSync(abs).mode & 0o111);
  const launcher = path.join('bin', 'jobsss');
  assert.equal(
    executableClass(path.join(PACKAGE_DIR, launcher)),
    true,
    `agent-plugin/${launcher} must stay executable — mcp.json launches ./bin/jobsss directly`
  );
  assert.equal(
    executableClass(path.join(PACKAGE_DIR, launcher)),
    executableClass(path.join(REPO_ROOT, launcher)),
    'package launcher mode must match the canonical launcher'
  );
  const drifted = canonicalMirrorFiles(REPO_ROOT).filter(
    rel => executableClass(path.join(REPO_ROOT, rel)) !== executableClass(path.join(PACKAGE_DIR, rel))
  );
  assert.deepEqual(drifted, [], `executable-bit drift between canonical tree and package: ${drifted.join(', ')}`);
});

test('P9 package runtime boots and diagnoses from its own root', () => {
  // The package ships no checkout test tree, so this is the gate that a runtime
  // must not hard-require any canonical file outside the mirrored surface.
  const launcher = path.join(PACKAGE_DIR, 'bin', 'jobsss');
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'jobsss-package-doctor-'));
  try {
    const help = spawnSync(process.execPath, [launcher, '--help'], { cwd: PACKAGE_DIR, encoding: 'utf8', timeout: 60_000 });
    assert.equal(help.status, 0, `packaged launcher --help must exit 0: ${help.stderr || help.stdout}`);
    assert.match(help.stdout, /jobsss bundled runtime v\d+\.\d+\.\d+/);
    assert.match(help.stdout, /mcp --data/, 'packaged help must document the MCP entry point');

    const doctor = spawnSync(process.execPath, [launcher, 'doctor', '--data', dataDir], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PLUGIN_DATA: dataDir }
    });
    assert.equal(doctor.status, 0, `packaged launcher doctor must exit 0: ${doctor.stderr || doctor.stdout}`);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true, `packaged doctor must report ok: ${doctor.stdout}`);
    assert.equal(report.bundled, true);
    assert.equal(report.launcher, './bin/jobsss');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('P10 package MCP command answers a real stdio handshake', async () => {
  const manifest = JSON.parse(readPackage('mcp.json'));
  const server = manifest.mcpServers.jobsss;
  const command = path.resolve(PACKAGE_DIR, server.command);
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'jobsss-package-mcp-'));
  const args = server.args.map(argument => argument.replace('${PLUGIN_DATA}', dataDir));
  const child = spawn(process.execPath, [command, ...args], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, PLUGIN_DATA: dataDir },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const frames = [];
  const errors = [];
  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', line => {
    try {
      frames.push(JSON.parse(line));
    } catch {
      /* non-JSON progress output is ignored, exactly like a real MCP client */
    }
  });
  child.stderr.on('data', chunk => errors.push(String(chunk)));

  const send = payload => child.stdin.write(`${JSON.stringify(payload)}\n`);
  const reply = async (id) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const frame = frames.find(candidate => candidate.id === id);
      if (frame) return frame;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`no MCP reply for request id ${id} (stderr: ${errors.join('').slice(0, 400)})`);
  };

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agent-plugin-parity', version: '1' } }
    });
    const initialized = await reply(1);
    assert.match(initialized.result.serverInfo.name, /^jobsss/, 'packaged MCP serverInfo must identify the bundled runtime');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (await reply(2)).result.tools.map(tool => tool.name);
    for (const required of ['doctor', 'start', 'create_profile', 'list_jobs', 'score_job', 'pursue_job']) {
      assert.ok(tools.includes(required), `packaged MCP server is missing tool ${required}`);
    }
    for (const banned of ['decide', 'approve_artifact', 'attest_application_submitted']) {
      assert.equal(tools.includes(banned), false, `human-only action ${banned} must not be MCP-callable`);
    }

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'doctor', arguments: {} } });
    assert.notEqual((await reply(3)).result.isError, true, 'packaged doctor tool call must succeed');
  } finally {
    child.stdin.end();
    child.kill();
    reader.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
