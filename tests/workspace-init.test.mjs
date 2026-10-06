import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'jobsss');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-init-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(cwd, args, launcher = cli, input) {
  return spawnSync(process.execPath, [launcher, ...args], { cwd, input, encoding: 'utf8', timeout: 20000 });
}

test('init creates a persistent workspace with shared agent data and a working local runtime', t => {
  const cwd = fixture(t);
  const result = run(cwd, ['init']);
  assert.equal(result.status, 0, result.stderr);
  const workspace = path.join(cwd, 'jobsss-workspace');
  const data = path.join(workspace, '.jobsss', 'data');
  assert.ok(fs.existsSync(path.join(data, 'store.json')));
  assert.ok(fs.existsSync(path.join(data, 'intake')));
  for (const file of ['README.md', 'AGENTS.md', 'CLAUDE.md', '.agents/skills/jobsss/SKILL.md', '.claude/skills/jobsss/SKILL.md']) assert.ok(fs.existsSync(path.join(workspace, file)), file);
  const config = JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8'));
  const server = config.mcpServers.jobsss;
  assert.equal(server.args.at(-1), data);
  const toml = fs.readFileSync(path.join(workspace, '.codex', 'config.toml'), 'utf8');
  assert.deepEqual(JSON.parse(toml.match(/^args = (.+)$/m)[1]), server.args);
  // Snapshot can be launched without the original package/npm cache.
  const launcher = path.join(workspace, 'jobsss.mjs');
  const doctor = run(cwd, ['doctor'], launcher);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).dataDir, data);
  const profile = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_profile', arguments: { name: 'Workspace Test', resumeText: 'Built internal tools and supported operations.' } } };
  const mcp = run(cwd, server.args.slice(1), server.args[0], `${JSON.stringify(profile)}\n`);
  assert.equal(mcp.status, 0, mcp.stderr);
  assert.ok(!JSON.parse(mcp.stdout.trim()).error, mcp.stdout);
  const store = JSON.parse(fs.readFileSync(path.join(data, 'store.json'), 'utf8'));
  assert.equal(Object.values(store.profiles)[0].name, 'Workspace Test');
  assert.ok(!fs.existsSync(path.join(workspace, '.jobsss', 'plugin', 'store.json')));
  assert.match(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8'), /^\.jobsss\/$/m);
});

test('custom folders with spaces work and repeating init preserves all existing data', t => {
  const cwd = fixture(t);
  const target = path.join(cwd, 'My job search');
  const first = run(cwd, ['init', target]);
  assert.equal(first.status, 0, first.stderr);
  const data = path.join(target, '.jobsss', 'data', 'store.json');
  const before = fs.readFileSync(data);
  const second = run(cwd, ['init', target]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /not empty/);
  assert.deepEqual(fs.readFileSync(data), before);
});

test('init rejects nonempty folders, files, and unknown options without overwriting', t => {
  const cwd = fixture(t);
  const target = path.join(cwd, 'existing');
  fs.mkdirSync(target);
  const file = path.join(target, 'resume.txt');
  fs.writeFileSync(file, 'Keep my resume');
  for (const args of [['init', target], ['init', file], ['init', '--force']]) assert.equal(run(cwd, args).status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Keep my resume');
  assert.deepEqual(fs.readdirSync(target), ['resume.txt']);
});

test('init refuses paths inside the installed plugin, including symlinked ancestors', t => {
  const cwd = fixture(t);
  const destination = path.join(root, `forbidden-workspace-${process.pid}`);
  assert.equal(run(cwd, ['init', destination]).status, 1);
  assert.equal(fs.existsSync(destination), false);
  if (process.platform !== 'win32') {
    fs.symlinkSync(root, path.join(cwd, 'alias'), 'dir');
    assert.equal(run(cwd, ['init', path.join(cwd, 'alias', path.basename(destination))]).status, 1);
    assert.equal(fs.existsSync(destination), false);
  }
});

test('init help is read-only and empty existing directories are supported', t => {
  const cwd = fixture(t);
  assert.equal(run(cwd, ['init', '--help']).status, 0);
  assert.deepEqual(fs.readdirSync(cwd), []);
  const empty = path.join(cwd, 'empty');
  fs.mkdirSync(empty);
  assert.equal(run(cwd, ['init', empty]).status, 0);
});
