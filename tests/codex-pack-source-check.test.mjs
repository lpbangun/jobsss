import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Codex pack check detects canonical source drift even when its inventory agrees with itself', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'jobsss-pack-check-'));
  try {
    for (const rel of [
      'scripts/build-codex-pack.mjs', 'scripts/build-install-surfaces.mjs',
      'compat/install-pins.json', 'codex-pack/job-search-stack',
      'bin', 'src', 'skills/jobsss', 'plugin.json'
    ]) cpSync(path.join(ROOT, rel), path.join(scratch, rel), { recursive: true });
    const command = ['scripts/build-codex-pack.mjs', '--check'];
    const before = spawnSync(process.execPath, command, { cwd: scratch, encoding: 'utf8' });
    assert.equal(before.status, 0, before.stderr);

    const source = path.join(scratch, 'src', 'cli.js');
    writeFileSync(source, readFileSync(source, 'utf8') + '\n// changed after pack generation\n');
    const after = spawnSync(process.execPath, command, { cwd: scratch, encoding: 'utf8' });
    assert.notEqual(after.status, 0, 'stale generated package must fail');
    assert.match(after.stderr, /Codex pack source bytes drift/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
