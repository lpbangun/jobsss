import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(REPO_ROOT, 'bin', 'jobsss');

function temporaryRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('direct launcher gives an actionable error when the service PATH has no Node.js', { skip: process.platform === 'win32' }, () => {
  const root = temporaryRoot('jobsss-startup-no-node-');
  const emptyPath = path.join(root, 'empty-bin');
  const dataDir = path.join(root, 'plugin-data');
  mkdirSync(emptyPath);
  try {
    const result = spawnSync(LAUNCHER, ['doctor', '--data', dataDir], {
      cwd: REPO_ROOT,
      env: { PATH: emptyPath, HOME: root },
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.status, 127, `missing runtime should exit 127: ${result.stderr || result.stdout}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Node\.js 22 or newer is required/);
    assert.match(result.stderr, /JOBSSS_NODE/);
    assert.equal(existsSync(dataDir), false, 'startup must fail before creating plugin state');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct launcher accepts JOBSSS_NODE with a minimal service PATH', { skip: process.platform === 'win32' }, () => {
  const root = temporaryRoot('jobsss-startup-explicit-node-');
  const emptyPath = path.join(root, 'empty-bin');
  const dataDir = path.join(root, 'plugin-data');
  mkdirSync(emptyPath);
  try {
    const result = spawnSync(LAUNCHER, ['doctor', '--data', dataDir], {
      cwd: REPO_ROOT,
      env: { PATH: emptyPath, HOME: root, PLUGIN_DATA: dataDir, JOBSSS_NODE: process.execPath },
      encoding: 'utf8',
      timeout: 15_000
    });
    assert.equal(result.status, 0, `explicit Node.js runtime should start: ${result.stderr || result.stdout}`);
    assert.equal(JSON.parse(result.stdout).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct launcher explains when JOBSSS_NODE is older than Node.js 22', { skip: process.platform === 'win32' }, () => {
  const root = temporaryRoot('jobsss-startup-old-node-');
  const emptyPath = path.join(root, 'empty-bin');
  const fakeNode = path.join(root, 'old-node');
  mkdirSync(emptyPath);
  writeFileSync(fakeNode, '#!/bin/sh\nprintf \'v20.19.0\\n\'\n', { mode: 0o755 });
  try {
    const result = spawnSync(LAUNCHER, ['--version'], {
      cwd: REPO_ROOT,
      env: { PATH: emptyPath, HOME: root, JOBSSS_NODE: fakeNode },
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.equal(result.status, 1, `old runtime should be rejected: ${result.stderr || result.stdout}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /selected runtime reports v20\.19\.0/);
    assert.match(result.stderr, /JOBSSS_NODE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
