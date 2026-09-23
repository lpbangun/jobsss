import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PACKAGE_DIRNAME, REPO_ROOT, packageDrift } from '../scripts/build-agent-plugin.mjs';

const PACKAGE_ROOTS = [
  { name: 'repository root', dir: REPO_ROOT, canonical: true },
  { name: 'agent-plugin', dir: path.join(REPO_ROOT, PACKAGE_DIRNAME), canonical: false }
];
const EXPECTED_METADATA = { type: 'module', engines: { node: '>=22' } };

function packageFilesForCopy(source, destination, canonical) {
  if (!canonical) {
    cpSync(source, destination, { recursive: true });
    return;
  }
  mkdirSync(destination, { recursive: true });
  for (const rel of ['package.json', 'plugin.json', 'mcp.json', 'bin', 'src', 'skills']) {
    cpSync(path.join(source, rel), path.join(destination, rel), { recursive: true });
  }
}

function copyBeneathForeignPackage(source, canonical) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'jobsss-portable-package-'));
  const foreignAncestor = path.join(scratch, 'foreign-ancestor');
  const packageRoot = path.join(foreignAncestor, 'plugin');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(foreignAncestor, 'package.json'), '{}\n');
  packageFilesForCopy(source, packageRoot, canonical);
  return { scratch, foreignAncestor, packageRoot };
}

test('root and install package declare only the required Node metadata', () => {
  for (const { name, dir } of PACKAGE_ROOTS) {
    const metadata = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(metadata, EXPECTED_METADATA, `${name} package.json must stay minimal and match the portable runtime`);
  }
  assert.equal(packageDrift(REPO_ROOT).ok, true, 'agent-plugin must mirror package.json from the canonical root');
});

test('both package roots resolve ESM beneath an unrelated ancestor package.json', () => {
  for (const { name, dir, canonical } of PACKAGE_ROOTS) {
    const copy = copyBeneathForeignPackage(dir, canonical);
    const dataDir = path.join(copy.scratch, 'plugin-data');
    try {
      const result = spawnSync(process.execPath, [
        path.join(copy.packageRoot, 'bin', 'jobsss'), 'doctor', '--data', dataDir
      ], { cwd: copy.foreignAncestor, encoding: 'utf8', timeout: 60_000 });
      assert.equal(result.status, 0, `${name} copy must run doctor successfully: ${result.stderr || result.stdout}`);
      assert.doesNotMatch(result.stderr, /MODULE_TYPELESS_PACKAGE_JSON/, `${name} must not inherit module scope outside its package`);
      const doctor = JSON.parse(result.stdout);
      assert.equal(doctor.ok, true, `${name} copy doctor must report ok`);
    } finally {
      rmSync(copy.scratch, { recursive: true, force: true });
    }
  }
});

test('INSTALL documents deferred Hermes activation and the Node PATH diagnosis', () => {
  const install = readFileSync(path.join(REPO_ROOT, 'INSTALL.md'), 'utf8');
  for (const phrase of [
    'mcp.reload',
    'hermes mcp list',
    'hermes plugins show jobsss',
    'Status: enabled',
    'hermes plugins doctor jobsss',
    'registrations: 0 tool(s), 0 hook(s)',
    'Do not add a duplicate',
    'hand-expand or rewrite',
    '${PLUGIN_ROOT}',
    '${PLUGIN_DATA}',
    "Node.js `>=22`",
    "/usr/bin/env: 'node': No such file or directory",
    'exit code 127, empty stdout',
    '/proc/<pid>/environ',
    'do not guarantee that an installer enforces',
    'Node-free startup'
  ]) {
    assert.ok(install.includes(phrase), `INSTALL.md must document: ${phrase}`);
  }
});

test('launcher reports the documented failure when a verified-empty PATH has no node', { skip: process.platform !== 'linux' }, () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'jobsss-no-node-path-'));
  const emptyPath = path.join(scratch, 'empty-bin');
  const dataDir = path.join(scratch, 'plugin-data');
  mkdirSync(emptyPath);
  const env = { PATH: emptyPath, HOME: scratch };
  try {
    const lookup = spawnSync('/bin/sh', ['-c', 'command -v node'], { env, encoding: 'utf8', timeout: 5_000 });
    assert.equal(lookup.status, 127, 'the same controlled PATH must not resolve node');
    assert.equal(lookup.stdout, '', 'a missing node lookup must be empty');

    const result = spawnSync(path.join(REPO_ROOT, 'bin', 'jobsss'), ['doctor', '--data', dataDir], {
      cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 5_000
    });
    assert.equal(result.status, 127);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^\/usr\/bin\/env: 'node': No such file or directory\n?$/);
    assert.equal(existsSync(dataDir), false, 'the launcher must fail before creating plugin state');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
