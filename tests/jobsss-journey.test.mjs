import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, pluginPath, readRequiredJson } from './helpers/jobsss-gate0.mjs';

const STANDALONE_SERVER_NAME = 'jobsss';
const STANDALONE_COMMAND = './bin/jobsss';
const STANDALONE_ARGS = Object.freeze(['mcp', '--data', '${PLUGIN_DATA}']);
const PROFILE_NAME = 'Gate Zero Profile';
const REAL_USER_STATE = [
  path.join(process.env.HOME || '', '.jobos'),
  '/home/logani/projects/Job App/.jobos',
  '/home/logani/projects/Job App/jobos-workspace'
];

function frameJsonl(message) {
  return `${JSON.stringify(message)}\n`;
}

function parseFrames(text) {
  const frames = [];
  let rest = Buffer.from(text, 'utf8');
  while (rest.length) {
    const prefix = rest.toString('utf8', 0, Math.min(rest.length, 15));
    if (prefix.startsWith('Content-Length:') || 'Content-Length:'.startsWith(prefix)) {
      const headerEnd = rest.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = rest.toString('utf8', 0, headerEnd);
      const match = header.match(/^Content-Length:\s*(\d+)\s*$/im);
      const length = Number(match?.[1]);
      if (!Number.isFinite(length)) break;
      const bodyStart = headerEnd + 4;
      if (rest.length - bodyStart < length) break;
      frames.push(JSON.parse(rest.toString('utf8', bodyStart, bodyStart + length)));
      rest = rest.subarray(bodyStart + length);
      continue;
    }
    const newline = rest.indexOf('\n');
    if (newline < 0) break;
    const line = rest.toString('utf8', 0, newline).trim();
    rest = rest.subarray(newline + 1);
    if (line) frames.push(JSON.parse(line));
  }
  return frames;
}

function parseToolValue(frame) {
  if (!frame) return null;
  if (frame.error) return { error: frame.error };
  const result = frame.result;
  if (!result) return null;
  const text = result.content?.find?.(item => item?.type === 'text')?.text;
  if (typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result;
}

function snapshotPath(abs) {
  if (!existsSync(abs)) return { exists: false, mtimeMs: 0, size: 0 };
  const stat = statSync(abs);
  return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
}

function listRelFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.pi' || entry.name === 'node_modules') continue;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) stack.push(child);
      else out.push(child);
    }
  }
  return out.sort();
}

function resolveStandaloneLauncher() {
  const mcpPath = pluginPath('mcp.json');
  assert.equal(existsSync(mcpPath), true, 'missing required product file mcp.json');
  const doc = readRequiredJson('mcp.json');
  const server = doc?.mcpServers?.[STANDALONE_SERVER_NAME];
  assert.ok(server, `mcp.json must declare stdio server "${STANDALONE_SERVER_NAME}"`);
  assert.equal(server.command, STANDALONE_COMMAND);
  assert.deepEqual(server.args, [...STANDALONE_ARGS]);
  const launcher = path.resolve(REPO_ROOT, server.command);
  assert.equal(existsSync(launcher), true, 'missing required product file bin/jobsss');
  assert.equal(lstatSync(launcher).isSymbolicLink(), false, 'bin/jobsss must not be a symlink');
  assert.equal(lstatSync(launcher).isFile(), true, 'bin/jobsss must be a regular file');
  return { launcher, argsTemplate: server.args };
}

function expandDataArgs(argsTemplate, dataDir) {
  return argsTemplate.map(value => value.replaceAll('${PLUGIN_DATA}', dataDir));
}

function makeIsolatedEnv(dataDir, trap) {
  const pathDirs = [trap.dir, path.dirname(process.execPath), '/usr/bin', '/bin'];
  return {
    PATH: pathDirs.join(path.delimiter),
    PLUGIN_DATA: dataDir,
    JOBOS_BIN: '',
    JOBOS_HOME: trap.jobosHome,
    JOBOS_WORKSPACE: '',
    JOBOS_LLM_PROVIDER: '',
    JOBOS_LLM_MODEL: '',
    JOBOS_LLM_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    NODE_PATH: '',
    HOME: trap.home,
    JOBSSS_JOBOS_TRAP: trap.marker
  };
}

function makeJobosTrap(parent) {
  const dir = path.join(parent, 'bin');
  mkdirSync(dir, { recursive: true });
  const marker = path.join(parent, 'jobos-trap-fired');
  writeFileSync(path.join(dir, 'jobos'), '#!/bin/sh\nprintf \'jobos-trap\\n\' >> "$JOBSSS_JOBOS_TRAP"\nexit 66\n');
  chmodSync(path.join(dir, 'jobos'), 0o755);
  return {
    dir,
    marker,
    home: path.join(parent, 'home'),
    jobosHome: path.join(parent, 'jobos-home')
  };
}

function assertNoJobosUse(trap, pluginBefore, jobAppBefore) {
  assert.equal(existsSync(trap.marker), false, 'bundled runtime must not resolve or execute jobos');
  assert.deepEqual(listRelFiles(trap.jobosHome), [], 'JOBOS_HOME must remain unused');
  assert.equal(existsSync(path.join(trap.home, '.jobos')), false, 'must not write ~/.jobos');
  const created = listRelFiles(REPO_ROOT).filter(rel => !pluginBefore.includes(rel) && !rel.startsWith('tests/fixtures/'));
  assert.deepEqual(created, [], `user state leaked into plugin root: ${created.join(', ')}`);
  for (const realState of REAL_USER_STATE) {
    assert.deepEqual(snapshotPath(realState), jobAppBefore[realState], `real user state changed: ${realState}`);
  }
}

function runMcpRequests(launcher, args, env, requests, { timeoutMs = 25_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const wanted = new Set(requests.map(request => request.id));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`bundled MCP timed out; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`));
    }, timeoutMs);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve({ stdout, stderr, frames: parseFrames(stdout) });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      let frames;
      try {
        frames = parseFrames(stdout);
      } catch {
        return;
      }
      const seen = new Set(frames.filter(frame => frame.id != null && (frame.result || frame.error)).map(frame => frame.id));
      if ([...wanted].every(id => seen.has(id))) finish();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', error => finish(error));
    for (const request of requests) child.stdin.write(frameJsonl(request));
  });
}

function pickId(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  if (value.profile && typeof value.profile === 'object') {
    const nested = pickId(value.profile, keys);
    if (nested) return nested;
  }
  if (value.job && typeof value.job === 'object') {
    const nested = pickId(value.job, keys);
    if (nested) return nested;
  }
  if (Array.isArray(value.jobs) && value.jobs[0]) return pickId(value.jobs[0], keys);
  return null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.jobs)) return value.jobs;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.artifacts)) return value.artifacts;
  if (Array.isArray(value?.queue)) return value.queue;
  return [];
}

function claimText(value) {
  return JSON.stringify(value || {}).toLowerCase();
}

function initializeRequest(id) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'jobsss-gate0', version: '0.0.0' }
    }
  };
}

function callRequest(id, name, args) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  };
}

function requireOk(session, id, label) {
  const frame = session.frames.find(item => item.id === id);
  const value = parseToolValue(frame);
  assert.ok(value && !value.error && !frame?.error, `${label} failed: ${JSON.stringify(frame || session.stderr)}`);
  return value;
}

function isolate(t, label) {
  const parent = mkdtempSync(path.join(tmpdir(), `${label}-`));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const trap = makeJobosTrap(parent);
  mkdirSync(trap.home, { recursive: true });
  mkdirSync(trap.jobosHome, { recursive: true });
  return {
    dataDir,
    trap,
    env: makeIsolatedEnv(dataDir, trap),
    pluginBefore: listRelFiles(REPO_ROOT),
    jobAppBefore: Object.fromEntries(REAL_USER_STATE.map(abs => [abs, snapshotPath(abs)]))
  };
}

test('B11 PLUGIN_DATA persistence never writes the plugin root', async t => {
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const ctx = isolate(t, 'jobsss-gate0-persist');
  const args = expandDataArgs(argsTemplate, ctx.dataDir);

  const first = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {})
  ]);
  assert.ok(first.frames.find(frame => frame.id === 1)?.result, `initialize failed: ${first.stderr}`);
  requireOk(first, 2, 'doctor');
  requireOk(first, 3, 'start');
  assert.ok(listRelFiles(ctx.dataDir).length > 0, 'start must persist state under PLUGIN_DATA');

  const second = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'doctor', {})
  ]);
  requireOk(second, 2, 'restart doctor');
  assert.ok(listRelFiles(ctx.dataDir).length > 0, 'PLUGIN_DATA must survive a new MCP process');
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B12 full standalone doctor-to-review journey', async t => {
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const ctx = isolate(t, 'jobsss-gate0-journey');
  const args = expandDataArgs(argsTemplate, ctx.dataDir);
  const resumePath = pluginPath('tests/fixtures/profile-resume.md');
  const jobPath = pluginPath('tests/fixtures/job-posting.md');
  assert.equal(existsSync(resumePath), true, 'missing tests/fixtures/profile-resume.md');
  assert.equal(existsSync(jobPath), true, 'missing tests/fixtures/job-posting.md');

  const setup = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: PROFILE_NAME, resumePath, path: resumePath })
  ]);
  requireOk(setup, 2, 'doctor');
  requireOk(setup, 3, 'start');
  const created = requireOk(setup, 4, 'create_profile');
  const profileId = pickId(created, ['profileId', 'id']);
  assert.ok(profileId, `create_profile must return a profile id: ${JSON.stringify(created)}`);

  const imported = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath })
  ]);
  const firstImport = requireOk(imported, 2, 'import_job');
  const jobId = pickId(firstImport, ['jobId', 'id']);
  assert.ok(jobId, `import_job must return a job id: ${JSON.stringify(firstImport)}`);

  const again = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId, path: jobPath, filePath: jobPath }),
    callRequest(3, 'list_jobs', { profileId })
  ]);
  const secondImport = requireOk(again, 2, 'import_job dedup');
  const listed = requireOk(again, 3, 'list_jobs');
  const secondId = pickId(secondImport, ['jobId', 'id']);
  const unique = new Set(asList(listed).map(job => pickId(job, ['jobId', 'id'])).filter(Boolean));
  unique.add(jobId);
  if (secondId) unique.add(secondId);
  assert.equal(unique.size, 1, `re-importing the same local job must deduplicate: ${JSON.stringify({ listed, first: jobId, second: secondId })}`);

  const acted = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'score_job', { jobId, profileId }),
    callRequest(3, 'pursue_job', { jobId, profileId }),
    callRequest(4, 'applications_plan', { jobId, profileId }),
    callRequest(5, 'review_queue', { profileId, jobId })
  ], { timeoutMs: 45_000 });
  const score = requireOk(acted, 2, 'score_job');
  const pursue = requireOk(acted, 3, 'pursue_job');
  const plan = requireOk(acted, 4, 'applications_plan');
  requireOk(acted, 5, 'review_queue');
  const scored = [score, score.fit, score.score].some(value => value && (
    typeof value.overall === 'number' || typeof value.scoreStatus === 'string' || typeof value.score === 'number'
  ));
  assert.equal(scored, true, `score_job must return overall or scoreStatus: ${JSON.stringify(score)}`);
  assert.doesNotMatch(claimText(pursue), /\b(submitted|sent|applied|approved)\b/);
  assert.doesNotMatch(claimText(plan), /\b(submitted|sent|applied)\b/);
  assert.ok(listRelFiles(ctx.dataDir).length > 0, 'journey state must persist under PLUGIN_DATA');

  const restarted = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'list_jobs', { profileId })
  ]);
  const restartedJobs = asList(requireOk(restarted, 2, 'list_jobs after restart'));
  assert.ok(
    restartedJobs.some(job => pickId(job, ['jobId', 'id']) === jobId || JSON.stringify(job).includes(jobId)),
    `restart must still see imported job ${jobId}: ${JSON.stringify(restartedJobs)}`
  );
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});

test('B13 real MCP applications_plan rejects a job owned by another profile', async t => {
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const ctx = isolate(t, 'jobsss-gate0-isolation');
  const args = expandDataArgs(argsTemplate, ctx.dataDir);
  const resumePath = pluginPath('tests/fixtures/profile-resume.md');
  const jobPath = pluginPath('tests/fixtures/job-posting.md');
  assert.equal(existsSync(resumePath), true, 'missing tests/fixtures/profile-resume.md');
  assert.equal(existsSync(jobPath), true, 'missing tests/fixtures/job-posting.md');

  const setup = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'doctor', {}),
    callRequest(3, 'start', {}),
    callRequest(4, 'create_profile', { name: 'Isolation Owner Profile', resumePath, path: resumePath }),
    callRequest(5, 'create_profile', { name: 'Isolation Foreign Profile', resumePath, path: resumePath })
  ]);
  requireOk(setup, 2, 'doctor');
  requireOk(setup, 3, 'start');
  const ownerCreated = requireOk(setup, 4, 'create_profile owner');
  const foreignCreated = requireOk(setup, 5, 'create_profile foreign');
  const ownerProfileId = pickId(ownerCreated, ['profileId', 'id']);
  const foreignProfileId = pickId(foreignCreated, ['profileId', 'id']);
  assert.ok(ownerProfileId, `owner create_profile must return a profile id: ${JSON.stringify(ownerCreated)}`);
  assert.ok(foreignProfileId, `foreign create_profile must return a profile id: ${JSON.stringify(foreignCreated)}`);
  assert.notEqual(ownerProfileId, foreignProfileId, 'isolation requires two distinct profiles');

  const imported = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'import_job', { profileId: ownerProfileId, path: jobPath, filePath: jobPath })
  ]);
  const firstImport = requireOk(imported, 2, 'import_job owner');
  const jobId = pickId(firstImport, ['jobId', 'id']);
  assert.ok(jobId, `import_job must return a job id: ${JSON.stringify(firstImport)}`);

  const crossed = await runMcpRequests(launcher, args, ctx.env, [
    initializeRequest(1),
    callRequest(2, 'applications_plan', { jobId, profileId: foreignProfileId }),
    callRequest(3, 'applications_plan', { jobId, profileId: ownerProfileId }),
    callRequest(4, 'list_jobs', { profileId: foreignProfileId })
  ]);
  const foreignFrame = crossed.frames.find(item => item.id === 2);
  const foreignPlan = parseToolValue(foreignFrame);
  const foreignErr = foreignFrame?.error || foreignPlan?.error;
  assert.ok(
    foreignErr,
    `applications_plan must reject a job owned by another profile: ${JSON.stringify(foreignFrame || crossed.stderr)}`
  );
  assert.match(
    JSON.stringify(foreignErr),
    /profile_mismatch|belongs to profile/i,
    `applications_plan rejection must name the profile isolation failure: ${JSON.stringify(foreignErr)}`
  );
  assert.notEqual(
    foreignPlan?.ok,
    true,
    `applications_plan must not succeed for a foreign-owned job: ${JSON.stringify(foreignPlan)}`
  );
  assert.ok(
    !foreignPlan?.plan,
    `applications_plan must not return a pipeline plan for a foreign-owned job: ${JSON.stringify(foreignPlan)}`
  );

  const ownerPlan = requireOk(crossed, 3, 'applications_plan owner');
  assert.ok(
    ownerPlan.profileId === ownerProfileId || ownerPlan.plan?.profileId === ownerProfileId,
    `owner applications_plan must stay on the owning profile: ${JSON.stringify(ownerPlan)}`
  );
  const foreignListed = asList(requireOk(crossed, 4, 'list_jobs foreign'));
  assert.equal(
    foreignListed.some(job => pickId(job, ['jobId', 'id']) === jobId || JSON.stringify(job).includes(jobId)),
    false,
    `list_jobs must not expose another profile's job: ${JSON.stringify(foreignListed)}`
  );
  assertNoJobosUse(ctx.trap, ctx.pluginBefore, ctx.jobAppBefore);
});
