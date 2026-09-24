import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = process.env.JOBSSS_PACK_ROOT
  ? path.resolve(process.env.JOBSSS_PACK_ROOT)
  : path.join(ROOT, 'codex-pack', 'job-search-stack');
const MCP = JSON.parse(readFileSync(path.join(PACK, '.mcp.json'), 'utf8')).mcpServers;
const request = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });
const call = (id, name, args = {}) => request(id, 'tools/call', { name, arguments: args });
const initialize = request(1, 'initialize', {
  protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'installed-pack-smoke', version: '1' }
});

function invoke(server, messages, env = {}) {
  const args = server.args.map(String);
  const command = server.command === 'node' ? process.execPath : server.command;
  const run = spawnSync(command, args, {
    cwd: PACK, env: { ...process.env, ...env },
    input: messages.map(message => JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8', timeout: 20_000
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const frames = run.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const byId = id => frames.find(frame => frame.id === id);
  assert.ok(byId(1)?.result, `initialize failed: ${run.stdout}`);
  return { byId, stderr: run.stderr };
}

function value(frame) {
  assert.ok(frame?.result, JSON.stringify(frame));
  const content = frame.result.content?.find(item => item.type === 'text');
  return content ? JSON.parse(content.text) : frame.result;
}

test('shipped Codex pack launches both MCP servers and compiles/imports a no-email brief', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'jobsss-installed-pack-'));
  const dataDir = path.join(scratch, 'plugin-data');
  try {
    const people = invoke(MCP['people-finder'], [initialize, request(2, 'tools/list')]);
    assert.ok(people.byId(2).result.tools.some(tool => tool.name === 'compile_people_queries'));

    const profile = invoke(MCP.jobsss, [
      initialize, request(2, 'tools/list'), call(3, 'start'),
      call(4, 'create_profile', {
        name: 'Avery Example',
        resumeText: 'Name: Avery Example\nExperience\n- Built a documented onboarding workflow for a fictional team.'
      })
    ], { PLUGIN_DATA: dataDir });
    assert.ok(profile.byId(2).result.tools.some(tool => tool.name === 'import_contact'));
    const profileId = value(profile.byId(4)).profileId;
    assert.ok(profileId);

    const skill = path.join(PACK, 'skills', 'contact-brief');
    const output = path.join(scratch, 'brief');
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const build = spawnSync(python, [
      'scripts/contact_brief.py', 'build', 'examples/offline-request.json',
      '--out', output, '--now', '2026-09-08T12:00:00Z'
    ], { cwd: skill, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    const validate = spawnSync(python, ['scripts/contact_brief.py', 'validate', output + '.json'], {
      cwd: skill, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 20_000
    });
    assert.equal(validate.status, 0, validate.stderr || validate.error?.message);

    const staged = path.join(dataDir, 'contact-brief.json');
    copyFileSync(output + '.json', staged);
    const imported = invoke(MCP.jobsss, [
      initialize, call(2, 'import_contact', { profileId, path: staged }),
      call(3, 'list_contacts', { profileId })
    ], { PLUGIN_DATA: dataDir });
    assert.equal(value(imported.byId(2)).ok, true);
    assert.equal(value(imported.byId(3)).count, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
