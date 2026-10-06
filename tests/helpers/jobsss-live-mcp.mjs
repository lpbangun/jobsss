import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HUMAN_ONLY_DOMAIN_TOOLS, REPO_ROOT, pluginPath, readRequiredJson } from './jobsss-gate0.mjs';

export const STANDALONE_SERVER_NAME = 'jobsss';
export const STANDALONE_COMMAND = './bin/jobsss';
export const STANDALONE_ARGS = Object.freeze(['mcp', '--data', '${PLUGIN_DATA}']);

export const REQUIRED_JOURNEY_TOOLS = Object.freeze([
  'doctor',
  'start',
  'create_profile',
  'import_job',
  'list_jobs',
  'score_job',
  'pursue_job',
  'applications_plan',
  'review_queue'
]);

export const REQUIRED_EXTENDED_TOOLS = Object.freeze([
  'import_job_url',
  'create_saved_search',
  'list_saved_searches',
  'search_jobs',
  'daily_discovery',
  'save_job',
  'skip_job',
  'tailor_resume',
  'draft_cover_letter',
  'list_tasks',
  'update_application_status',
  'import_contact',
  'map_reachable_network',
  'plan_outreach',
  'draft_outreach',
  'list_interview_stories',
  'draft_interview_story',
  'interview_prep',
  'preview_sync'
]);

export const BLOCKED_MCP_TOOLS = Object.freeze([
  ...HUMAN_ONLY_DOMAIN_TOOLS,
  'submit_application_form',
  'inspect_application_form',
  'assist_application_form'
]);

export const UNSUPPORTED_MCP_TOOLS = Object.freeze([
  'apply_job',
  'send_email',
  'send_outreach',
  'schedule_interview',
  'browser_apply'
]);

export const FIT_DIMENSION_WEIGHTS = Object.freeze({
  roleFit: 28,
  domainFit: 18,
  seniority: 14,
  locationWorkModel: 12,
  compensation: 8,
  missionInterest: 14,
  networkAccess: 6
});

export const LOCK_FILE_NAME = 'jobsss.lock';

export const FROZEN_FIXTURE_RESUME = 'tests/fixtures/profile-resume.md';
export const FROZEN_FIXTURE_JOB = 'tests/fixtures/job-posting.md';

const REAL_USER_STATE = [
  path.join(process.env.HOME || '', '.jobos'),
  '/home/logani/projects/Job App/.jobos',
  '/home/logani/projects/Job App/jobos-workspace'
];

export function frameJsonl(message) {
  return `${JSON.stringify(message)}\n`;
}

export function parseFrames(text) {
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

export function parseToolValue(frame) {
  if (!frame) return null;
  if (frame.error) return { error: frame.error };
  const result = frame.result;
  if (!result) return null;
  if (result.isError) {
    const text = result.content?.find?.(item => item?.type === 'text')?.text;
    return { error: { message: text || 'isError', mcpIsError: true }, raw: result };
  }
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

export function snapshotPath(abs) {
  if (!existsSync(abs)) return { exists: false, mtimeMs: 0, size: 0 };
  const stat = statSync(abs);
  return { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
}

export function listRelFiles(root) {
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

export function resolveStandaloneLauncher() {
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

export function expandDataArgs(argsTemplate, dataDir) {
  return argsTemplate.map(value => value.replaceAll('${PLUGIN_DATA}', dataDir));
}

export function makeJobosTrap(parent) {
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

export function makeIsolatedEnv(dataDir, trap, extra = {}) {
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
    OPENAI_API_KEY: extra.OPENAI_API_KEY || '',
    ANTHROPIC_API_KEY: '',
    NODE_PATH: '',
    HOME: trap.home,
    JOBSSS_JOBOS_TRAP: trap.marker,
    ...extra
  };
}

export function assertNoJobosUse(trap, pluginBefore, jobAppBefore) {
  assert.equal(existsSync(trap.marker), false, 'bundled runtime must not resolve or execute jobos');
  assert.deepEqual(listRelFiles(trap.jobosHome), [], 'JOBOS_HOME must remain unused');
  assert.equal(existsSync(path.join(trap.home, '.jobos')), false, 'must not write ~/.jobos');
  const created = listRelFiles(REPO_ROOT).filter(rel => !pluginBefore.includes(rel) && !rel.startsWith('tests/fixtures/'));
  assert.deepEqual(created, [], `user state leaked into plugin root: ${created.join(', ')}`);
  for (const realState of REAL_USER_STATE) {
    assert.deepEqual(snapshotPath(realState), jobAppBefore[realState], `real user state changed: ${realState}`);
  }
}

export function runMcpRequests(launcher, args, env, requests, { timeoutMs = 25_000 } = {}) {
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

export function initializeRequest(id) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'jobsss-gate0-round2', version: '0.0.0' }
    }
  };
}

export function callRequest(id, name, args) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  };
}

export function listToolsRequest(id) {
  return { jsonrpc: '2.0', id, method: 'tools/list', params: {} };
}

export function pickId(value, keys) {
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
  if (value.search && typeof value.search === 'object') {
    const nested = pickId(value.search, keys);
    if (nested) return nested;
  }
  if (value.artifact && typeof value.artifact === 'object') {
    const nested = pickId(value.artifact, keys);
    if (nested) return nested;
  }
  if (Array.isArray(value.jobs) && value.jobs[0]) return pickId(value.jobs[0], keys);
  return null;
}

export function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.jobs)) return value.jobs;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.artifacts)) return value.artifacts;
  if (Array.isArray(value?.queue)) return value.queue;
  if (Array.isArray(value?.tasks)) return value.tasks;
  if (Array.isArray(value?.searches)) return value.searches;
  if (Array.isArray(value?.contacts)) return value.contacts;
  if (Array.isArray(value?.stories)) return value.stories;
  return [];
}

export function claimText(value) {
  return JSON.stringify(value || {}).toLowerCase();
}

export function isRejected(frame, value) {
  if (!frame) return false;
  if (frame.error || value?.error) return true;
  if (value?.ok === false) return true;
  if (value?.rejected === true) return true;
  return false;
}

export function rejectionBlob(frame, value) {
  return JSON.stringify({
    error: frame?.error || value?.error || null,
    value
  });
}

export function assertOwnershipRejection(frame, value, label) {
  assert.ok(
    isRejected(frame, value),
    `${label} must reject a foreign-owned record: ${JSON.stringify(frame)}`
  );
  assert.match(
    rejectionBlob(frame, value),
    /profile_mismatch|belongs to profile|profile_job_mismatch|ownership|not owned/i,
    `${label} rejection must name profile ownership: ${rejectionBlob(frame, value)}`
  );
  assert.notEqual(value?.ok, true, `${label} must not succeed for a foreign profile`);
}

export function assertBlockedCall(frame, value, name) {
  assert.ok(isRejected(frame, value), `${name} must not succeed: ${JSON.stringify(frame)}`);
  assert.match(
    rejectionBlob(frame, value),
    /not available|human-only|blocked|forbidden|mcp_tool_not_available|unsupported/i,
    `${name} must be a truthful block, not a fake success: ${rejectionBlob(frame, value)}`
  );
  assert.doesNotMatch(
    claimText({ frame, value }),
    /\b(submitted|sent|applied|approved)\b/
  );
  assert.doesNotMatch(
    claimText({ frame, value }),
    /coming soon|will be available|deferred capability|not yet implemented, try later/i
  );
}

export function requireOk(session, id, label) {
  const frame = session.frames.find(item => item.id === id);
  const value = parseToolValue(frame);
  assert.ok(value && !value.error && !frame?.error, `${label} failed: ${JSON.stringify(frame || session.stderr)}`);
  return value;
}

export function requireToolListed(names, tool) {
  assert.ok(names.includes(tool), `tools/list missing required extended tool ${tool}`);
}

export function readStore(dataDir) {
  const abs = path.join(dataDir, 'store.json');
  assert.equal(existsSync(abs), true, 'PLUGIN_DATA/store.json is missing');
  return JSON.parse(readFileSync(abs, 'utf8'));
}

export function storeRevision(store) {
  const value = store?.revision ?? store?.storeRevision ?? store?.meta?.revision;
  return Number(value);
}

export function isolate(t, label, extraEnv = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), `${label}-`));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const trap = makeJobosTrap(parent);
  mkdirSync(trap.home, { recursive: true });
  mkdirSync(trap.jobosHome, { recursive: true });
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const env = makeIsolatedEnv(dataDir, trap, extraEnv);
  return {
    parent,
    dataDir,
    trap,
    launcher,
    args: expandDataArgs(argsTemplate, dataDir),
    env,
    pluginBefore: listRelFiles(REPO_ROOT),
    jobAppBefore: Object.fromEntries(REAL_USER_STATE.map(abs => [abs, snapshotPath(abs)]))
  };
}

export async function mcp(ctx, requests, options) {
  return runMcpRequests(ctx.launcher, ctx.args, ctx.env, requests, options);
}

export function resumeFixture() {
  return pluginPath(FROZEN_FIXTURE_RESUME);
}

export function jobFixture() {
  return pluginPath(FROZEN_FIXTURE_JOB);
}

export function writeLock(dataDir, pid = process.pid) {
  const abs = path.join(dataDir, LOCK_FILE_NAME);
  writeFileSync(abs, JSON.stringify({ pid, createdAt: new Date().toISOString() }));
  return abs;
}

export function projectionFiles(dataDir) {
  return listRelFiles(dataDir).filter(rel => rel !== 'store.json' && !rel.endsWith(`${path.sep}store.json`));
}

export function readAllProjections(dataDir) {
  const files = projectionFiles(dataDir);
  return files.map(rel => ({
    rel,
    text: readFileSync(path.join(dataDir, rel), 'utf8')
  }));
}

export const LEGACY_PROFILE_ID = 'legacy-probe-profile';
export const LEGACY_JOB_ID = 'job_5fa7236535eb384d';
export const LEGACY_PROOF_IDS = Object.freeze([
  'proof_134063ea753e1997',
  'proof_c9ce3bcde80593e5',
  'proof_da98113c837d187e',
  'proof_c103b62c0217b093'
]);
export const LEGACY_ARTIFACT_ID = 'artifact_6e23181c13b9be6c';
