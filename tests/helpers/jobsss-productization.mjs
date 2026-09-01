import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT, pluginPath, readRequired, readRequiredJson } from './jobsss-gate0.mjs';
import {
  STANDALONE_ARGS,
  STANDALONE_COMMAND,
  STANDALONE_SERVER_NAME,
  assertNoJobosUse,
  expandDataArgs,
  frameJsonl,
  isolate,
  listRelFiles,
  makeIsolatedEnv,
  parseFrames
} from './jobsss-live-mcp.mjs';

export const TRUSTED_DECISION_ACTIONS = Object.freeze([
  'proof.verify',
  'artifact.approve',
  'artifact.reject',
  'contact.approve',
  'contact.suppress',
  'story.verify',
  'story.retire',
  'debrief.record',
  'debrief.correct',
  'outreach.sent',
  'outreach.outcome',
  'application.observe_status'
]);

export const COMPAT_CLIENTS = Object.freeze(['pi', 'omp', 'codex', 'hermes', 'claude']);

export const INTENDED_RELEASE_TARGETS = Object.freeze([
  'current-host',
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win-x64'
]);

export const HANDOFF_MCP_TOOLS = Object.freeze([
  'list_decision_handoffs',
  'create_decision_handoff'
]);

export const AUTHORITY_FORGERY_TOOLS = Object.freeze([
  'approve_artifact',
  'reject_artifact',
  'approve_contact',
  'verify_interview_story',
  'retire_interview_story',
  'record_interview_debrief',
  'correct_interview_debrief',
  'mark_outreach_sent',
  'attest_application_submitted',
  'decide',
  'trusted_decide',
  'proof.verify'
]);

export const REQUIRED_RELEASE_FILES = Object.freeze([
  'plugin.json',
  'mcp.json',
  'skills/jobsss/SKILL.md',
  'bin/jobsss'
]);

export const ADAPTER_BUSINESS_LOGIC = Object.freeze([
  [/\bexport\s+const\s+HANDLERS\b/, 'MCP handler table'],
  [/\bfunction\s+extractProofPoints\b/, 'proof extraction'],
  [/\bcommitStore\s*\(/, 'canonical store writer'],
  [/\bloadStore\s*\(/, 'canonical store reader'],
  [/\bfunction\s+draftInterviewStory\b/, 'interview-story implementation'],
  [/\bfunction\s+tailorResume\b/, 'resume-tailoring implementation'],
  [/\bfunction\s+scoreJob\b/, 'scoring implementation'],
  [/\broleFit\s*:\s*28\b/, 'fit-score weights'],
  [/\bspawn\s*\([^)]*jobos\b/, 'jobos spawn'],
  [/\bHUMAN_ONLY_DOMAIN_TOOLS\b/, 'policy replica'],
  [/CREATE TABLE\s+/i, 'SQL schema']
]);

const HOST_HOME = process.env.HOME || homedir();

export const REAL_CLIENT_STATE = Object.freeze([
  path.join(HOST_HOME, '.claude'),
  path.join(HOST_HOME, '.codex'),
  path.join(HOST_HOME, '.hermes'),
  path.join(HOST_HOME, '.omp'),
  path.join(HOST_HOME, '.pi'),
  path.join(HOST_HOME, '.cursor'),
  path.join(HOST_HOME, '.config', 'claude'),
  path.join(HOST_HOME, '.config', 'codex'),
  path.join(HOST_HOME, '.config', 'opencode'),
  path.join(HOST_HOME, '.config', 'hermes')
]);

const CODE_FILE_RE = /\.(?:js|mjs|cjs|ts|tsx|py|go|rs|java|rb)$/i;

let releaseCache = null;

export function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

export function readHead(abs, n = 96) {
  return readFileSync(abs).subarray(0, n).toString('utf8');
}

export function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const objects = [];
  for (const opener of ['{', '[']) {
    let from = 0;
    while (from < raw.length) {
      const start = raw.indexOf(opener, from);
      if (start < 0) break;
      for (let end = raw.length; end > start + 1; end -= 1) {
        try {
          objects.push(JSON.parse(raw.slice(start, end)));
          from = end;
          break;
        } catch {
          continue;
        }
      }
      if (from <= start) from = start + 1;
    }
  }
  return objects.length ? objects[objects.length - 1] : null;
}

export function runProcess(command, args, env, { cwd = REPO_ROOT, timeoutMs = 25_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`process timed out: ${command} ${args.join(' ')}; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`));
    }, timeoutMs);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      if (error) reject(error);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr });
    });
  });
}

export function writeNodeTrap(trap) {
  mkdirSync(trap.dir, { recursive: true });
  const script = '#!/bin/sh\nprintf \'node-trap\\n\' >> "$JOBSSS_NODE_TRAP"\nexit 66\n';
  for (const name of ['node', 'nodejs']) {
    const abs = path.join(trap.dir, name);
    writeFileSync(abs, script);
    chmodSync(abs, 0o755);
  }
  trap.nodeMarker = trap.nodeMarker || path.join(path.dirname(trap.dir), 'node-trap-fired');
  return trap;
}

export function nodeFreeEnv(dataDir, trap, extra = {}) {
  writeNodeTrap(trap);
  const env = makeIsolatedEnv(dataDir, trap, extra);
  env.PATH = [trap.dir, '/usr/bin', '/bin'].join(path.delimiter);
  env.JOBSSS_NODE_TRAP = trap.nodeMarker;
  return env;
}

export function assertNoNodeUse(trap) {
  const marker = trap.nodeMarker || path.join(path.dirname(trap.dir), 'node-trap-fired');
  assert.equal(existsSync(marker), false, 'released runtime must not resolve or execute node from PATH');
}

const CLIENT_PROFILE_BASENAMES = new Set([
  'config.yaml',
  'config.yml',
  'config.json',
  'config.toml',
  'settings.json',
  'mcp.json',
  '.mcp.json',
  'plugin.json'
]);

function considerClientProfileFile(files, root, rel) {
  const abs = path.join(root, rel);
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.isSymbolicLink()) return;
    files[rel.split(path.sep).join('/')] = { size: st.size, sha256: sha256File(abs) };
  } catch {
    /* absent or unreadable */
  }
}

/**
 * Fingerprint probe-touchable client profile/config files under a real host
 * tree. B34 prose forbids probes from mutating those profiles; it does not
 * require the inode mtime of an entire install/runtime tree (for example
 * ~/.hermes, whose directory mtime is rewritten by the ambient Hermes
 * gateway cron with zero JobSSS activity) to stay frozen.
 */
function snapshotClientTree(root) {
  if (!existsSync(root)) return { exists: false, files: {} };
  const files = {};
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { exists: true, files };
  }
  for (const entry of entries) {
    if (entry.isFile() && CLIENT_PROFILE_BASENAMES.has(entry.name)) {
      considerClientProfileFile(files, root, entry.name);
    }
  }
  const agentDir = path.join(root, 'agent');
  if (existsSync(agentDir)) {
    try {
      for (const entry of readdirSync(agentDir, { withFileTypes: true })) {
        if (entry.isFile() && CLIENT_PROFILE_BASENAMES.has(entry.name)) {
          considerClientProfileFile(files, root, path.join('agent', entry.name));
        }
      }
    } catch {
      /* ignore unreadable agent dir */
    }
  }
  const profilesDir = path.join(root, 'profiles');
  if (existsSync(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const name of CLIENT_PROFILE_BASENAMES) {
          considerClientProfileFile(files, root, path.join('profiles', entry.name, name));
        }
      }
    } catch {
      /* ignore unreadable profiles dir */
    }
  }
  return { exists: true, files };
}

export function snapshotClientState() {
  return Object.fromEntries(REAL_CLIENT_STATE.map(abs => [abs, snapshotClientTree(abs)]));
}

export function assertClientStateUnchanged(before) {
  for (const abs of REAL_CLIENT_STATE) {
    assert.deepEqual(snapshotClientTree(abs), before[abs], `real client state changed: ${abs}`);
  }
}

export function repoLauncher() {
  const launcher = path.resolve(REPO_ROOT, 'bin/jobsss');
  assert.equal(existsSync(launcher), true, 'missing required product file bin/jobsss');
  return launcher;
}

export function builderEnv(trap) {
  return {
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    HOME: trap.home,
    JOBOS_BIN: '',
    JOBOS_HOME: trap.jobosHome,
    JOBOS_WORKSPACE: '',
    JOBOS_LLM_API_KEY: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    NODE_PATH: '',
    PLUGIN_DATA: '',
    JOBSSS_JOBOS_TRAP: trap.marker,
    JOBSSS_NODE_TRAP: trap.nodeMarker || path.join(path.dirname(trap.dir), 'node-trap-fired')
  };
}

export async function runRepoJobsss(args, env, options) {
  return runProcess(repoLauncher(), args, env, options);
}

export function resolveReleasePluginRoot(outDir) {
  const candidates = [
    path.join(outDir, 'current-host'),
    path.join(outDir, 'jobsss', 'current-host'),
    outDir
  ];
  for (const dir of candidates) {
    if (
      existsSync(path.join(dir, 'bin', 'jobsss'))
      && existsSync(path.join(dir, 'plugin.json'))
      && existsSync(path.join(dir, 'mcp.json'))
      && existsSync(path.join(dir, 'skills', 'jobsss', 'SKILL.md'))
    ) {
      return dir;
    }
  }
  const listing = listRelFiles(outDir).slice(0, 40).join(', ') || '(empty)';
  assert.fail(
    `./bin/jobsss release --out must write the portable current-host layout (plugin.json, mcp.json, skills/jobsss/SKILL.md, bin/jobsss) under ${outDir}; found: ${listing}`
  );
}

export function readReleaseManifest(outDir, pluginRoot) {
  const candidates = [
    path.join(outDir, 'release-manifest.json'),
    path.join(pluginRoot, 'release-manifest.json'),
    path.join(outDir, 'current-host', 'release-manifest.json')
  ];
  const hit = candidates.find(abs => existsSync(abs));
  assert.ok(
    hit,
    'release output must include release-manifest.json describing targets and clients with verified|built|intended|unverified status'
  );
  return { path: hit, doc: JSON.parse(readFileSync(hit, 'utf8')) };
}

export function readCompatMatrix() {
  const rel = 'compat/matrix.json';
  const abs = pluginPath(rel);
  assert.equal(existsSync(abs), true, `missing required product file ${rel}`);
  assert.equal(lstatSync(abs).isSymbolicLink(), false, `${rel} must not be a symlink`);
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  assert.equal(doc && typeof doc === 'object' && !Array.isArray(doc), true, 'compat/matrix.json must be a JSON object');
  return doc;
}

function collectNamedEntries(value, keys) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
      return Object.entries(value[key]).map(([id, entry]) => (
        entry && typeof entry === 'object' ? { id, ...entry } : { id, status: entry }
      ));
    }
  }
  return [];
}

export function matrixTargets(doc) {
  return collectNamedEntries(doc, ['targets', 'platforms', 'releaseTargets']);
}

export function matrixClients(doc) {
  return collectNamedEntries(doc, ['clients', 'compat', 'compatibility']);
}

export function entryStatus(entry) {
  return String(entry?.status || entry?.verification || entry?.state || '').trim().toLowerCase();
}

export function assertHonestStatus(status, label) {
  assert.match(
    status,
    /^(verified|built|intended|unverified)$/,
    `${label} status must be verified, built, intended, or unverified (got ${status || '<empty>'})`
  );
}

export async function buildReleaseTo(outDir, trap, extraArgs = []) {
  mkdirSync(outDir, { recursive: true });
  const env = builderEnv(trap);
  const result = await runRepoJobsss(
    ['release', '--out', outDir, '--target', 'current-host', ...extraArgs],
    env,
    { timeoutMs: 180_000 }
  );
  assert.equal(
    result.code,
    0,
    `./bin/jobsss release --out must exit 0 (got ${result.code}): stdout=${result.stdout.slice(0, 500)} stderr=${result.stderr.slice(0, 500)}`
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /\b(submitted|sent|applied|approved)\b/i
  );
  return result;
}

export async function ensureCurrentHostRelease() {
  if (releaseCache) return releaseCache;
  const parent = mkdtempSync(path.join(tmpdir(), 'jobsss-release-cache-'));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const { isolate: makeIsolate } = await import('./jobsss-live-mcp.mjs');
  void makeIsolate;
  const trapParent = parent;
  const trapDir = path.join(trapParent, 'bin');
  mkdirSync(trapDir, { recursive: true });
  const marker = path.join(trapParent, 'jobos-trap-fired');
  writeFileSync(path.join(trapDir, 'jobos'), '#!/bin/sh\nprintf \'jobos-trap\\n\' >> "$JOBSSS_JOBOS_TRAP"\nexit 66\n');
  chmodSync(path.join(trapDir, 'jobos'), 0o755);
  const trap = {
    dir: trapDir,
    marker,
    home: path.join(trapParent, 'home'),
    jobosHome: path.join(trapParent, 'jobos-home')
  };
  mkdirSync(trap.home, { recursive: true });
  mkdirSync(trap.jobosHome, { recursive: true });
  writeNodeTrap(trap);
  const outDir = path.join(parent, 'out-a');
  await buildReleaseTo(outDir, trap);
  const pluginRoot = resolveReleasePluginRoot(outDir);
  const launcher = path.join(pluginRoot, 'bin', 'jobsss');
  releaseCache = { parent, outDir, pluginRoot, launcher, trap };
  return releaseCache;
}

export async function buildSecondRelease(trap) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'jobsss-release-b-'));
  await buildReleaseTo(outDir, trap);
  return { outDir, pluginRoot: resolveReleasePluginRoot(outDir) };
}

export function assertPortableReleaseTree(pluginRoot) {
  for (const rel of REQUIRED_RELEASE_FILES) {
    const abs = path.join(pluginRoot, rel);
    assert.equal(existsSync(abs), true, `release missing ${rel}`);
    assert.equal(lstatSync(abs).isSymbolicLink(), false, `release ${rel} must not be a symlink`);
  }
  const refs = path.join(pluginRoot, 'skills', 'jobsss', 'references');
  assert.equal(existsSync(refs), true, 'release missing skills/jobsss/references/');
  assert.equal(lstatSync(refs).isDirectory(), true, 'release skills/jobsss/references/ must be a directory');
  const launcher = path.join(pluginRoot, 'bin', 'jobsss');
  assert.equal(lstatSync(launcher).isFile(), true, 'release bin/jobsss must be a regular file');
  const mode = lstatSync(launcher).mode;
  assert.ok(mode & 0o111, 'release bin/jobsss must be executable');
  const head = readHead(launcher);
  assert.doesNotMatch(
    head,
    /^#!\s*\/usr\/bin\/env\s+node\b/m,
    'release bin/jobsss must be a standalone executable, not a Node-on-PATH launcher'
  );
  const mcp = JSON.parse(readFileSync(path.join(pluginRoot, 'mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers || {}), [STANDALONE_SERVER_NAME]);
  assert.deepEqual(mcp.mcpServers[STANDALONE_SERVER_NAME], {
    type: 'stdio',
    command: STANDALONE_COMMAND,
    args: [...STANDALONE_ARGS]
  });
  const plugin = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'jobsss');
}

export function isolateReleaseMcp(t, pluginRoot, trap, extraEnv = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'jobsss-rel-mcp-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const env = nodeFreeEnv(dataDir, trap, extraEnv);
  const launcher = path.join(pluginRoot, 'bin', 'jobsss');
  return {
    parent,
    dataDir,
    trap,
    launcher,
    args: expandDataArgs([...STANDALONE_ARGS], dataDir),
    env,
    pluginBefore: listRelFiles(pluginRoot),
    releaseRoot: pluginRoot
  };
}

export function runReleaseMcp(ctx, requests, { timeoutMs = 25_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ctx.launcher, ctx.args, {
      cwd: cwd || ctx.parent,
      env: ctx.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const wanted = new Set(requests.map(request => request.id));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`released MCP timed out; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`));
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

export async function runDecide(ctx, argv, { timeoutMs = 25_000 } = {}) {
  const args = ['decide', '--data', ctx.dataDir, ...argv];
  const result = await runProcess(ctx.launcher, args, ctx.env, { cwd: REPO_ROOT, timeoutMs });
  return { ...result, json: extractJson(result.stdout) || extractJson(result.stderr) };
}

export function pendingItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.pending)) return payload.pending;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.decisions)) return payload.decisions;
  if (Array.isArray(payload.handoffs)) return payload.handoffs;
  if (Array.isArray(payload.queue)) return payload.queue;
  return [];
}

export function itemKind(item) {
  return String(item?.kind || item?.action || item?.type || item?.decision || '').toLowerCase();
}

export function itemId(item) {
  for (const key of ['id', 'entityId', 'proofPointId', 'artifactId', 'contactId', 'storyId', 'applicationId', 'outreachId']) {
    if (typeof item?.[key] === 'string' && item[key].trim()) return item[key];
  }
  return null;
}

export function itemRevision(item) {
  const value = item?.revision ?? item?.expectedRevision ?? item?.storeRevision ?? item?.entityRevision;
  return Number(value);
}

export function itemHash(item) {
  for (const key of ['contentHash', 'content_hash', 'hash', 'sha256']) {
    if (typeof item?.[key] === 'string' && item[key].trim()) return item[key].trim().toLowerCase();
  }
  return null;
}

export function findPending(items, kindRe) {
  return items.filter(item => kindRe.test(`${itemKind(item)} ${JSON.stringify(item)}`));
}

export function assertBinding(item, label) {
  const id = itemId(item);
  const revision = itemRevision(item);
  const hash = itemHash(item);
  assert.ok(id, `${label} must expose entity id: ${JSON.stringify(item)}`);
  assert.ok(Number.isInteger(revision) && revision >= 1, `${label} must expose integer revision: ${JSON.stringify(item)}`);
  assert.match(String(hash || ''), /^[a-f0-9]{64}$/, `${label} contentHash must be lowercase SHA-256 hex: ${JSON.stringify(item)}`);
  return { id, revision, hash };
}

export function staleBlob(result) {
  return JSON.stringify({
    code: result.code,
    json: result.json,
    stdout: result.stdout,
    stderr: result.stderr
  });
}

export function assertStaleConflict(result, label) {
  const blob = staleBlob(result);
  assert.ok(
    result.code !== 0 || result.json?.ok === false || result.json?.error,
    `${label} must not succeed: ${blob}`
  );
  assert.match(
    blob,
    /stale_conflict|stale-conflict|content_hash_mismatch|stale_revision/i,
    `${label} must be a typed stale conflict: ${blob}`
  );
}

export function assertNoAuthorityClaim(value, label) {
  const blob = JSON.stringify(value || {}).toLowerCase();
  assert.doesNotMatch(
    blob,
    /\bjobsss (?:sent|submitted|interviewed|approved externally|applied)\b/,
    `${label} must not claim JobSSS performed an external action`
  );
}

export function adapterRoots(pluginRoot = REPO_ROOT) {
  const roots = [];
  for (const rel of ['compat', path.join('current-host', 'compat')]) {
    const abs = path.join(pluginRoot, rel);
    if (existsSync(abs) && lstatSync(abs).isDirectory()) roots.push({ rel, abs });
  }
  return roots;
}

export function adapterFiles(pluginRoot = REPO_ROOT) {
  const out = [];
  for (const root of adapterRoots(pluginRoot)) {
    for (const rel of listRelFiles(root.abs)) {
      if (rel === 'matrix.json' || rel.endsWith(`${path.sep}matrix.json`)) continue;
      out.push({
        rel: path.join(root.rel, rel),
        abs: path.join(root.abs, rel)
      });
    }
  }
  return out;
}

export function isAdapterCode(rel) {
  return CODE_FILE_RE.test(rel);
}

export function collectDocsCorpus() {
  const parts = [readRequired('skills/jobsss/SKILL.md')];
  const refs = pluginPath('skills/jobsss/references');
  if (existsSync(refs)) {
    for (const rel of listRelFiles(refs)) {
      parts.push(readFileSync(path.join(refs, rel), 'utf8'));
    }
  }
  if (existsSync(pluginPath('README.md'))) parts.push(readFileSync(pluginPath('README.md'), 'utf8'));
  if (existsSync(pluginPath('compat/matrix.json'))) parts.push(readFileSync(pluginPath('compat/matrix.json'), 'utf8'));
  return parts.join('\n\n');
}

export function isolateForAuthority(t, label) {
  return isolate(t, label);
}

export function posixRel(rel) {
  return String(rel).split(path.sep).join('/');
}

export function hashedReleaseTree(root) {
  const hashes = {};
  for (const relRaw of listRelFiles(root)) {
    const abs = path.join(root, relRaw);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink()) continue;
    hashes[posixRel(relRaw)] = sha256File(abs);
  }
  return hashes;
}

export function releaseManifestCopies(outDir, pluginRoot) {
  return {
    outputRoot: path.join(outDir, 'release-manifest.json'),
    pluginTree: path.join(pluginRoot, 'release-manifest.json')
  };
}

export function requireBothReleaseManifests(outDir, pluginRoot) {
  const copies = releaseManifestCopies(outDir, pluginRoot);
  assert.equal(existsSync(copies.outputRoot), true, 'release output root must include release-manifest.json');
  assert.equal(existsSync(copies.pluginTree), true, 'current-host plugin tree must include its own release-manifest.json copy');
  const outputBytes = readFileSync(copies.outputRoot);
  const pluginBytes = readFileSync(copies.pluginTree);
  const outputSha = createHash('sha256').update(outputBytes).digest('hex');
  const pluginSha = createHash('sha256').update(pluginBytes).digest('hex');
  assert.equal(
    outputSha,
    pluginSha,
    'both release-manifest.json copies must be byte-identical within a build'
  );
  return {
    ...copies,
    doc: JSON.parse(outputBytes.toString('utf8')),
    sha256: outputSha
  };
}

function pushNeedle(needles, value) {
  const text = String(value || '').trim();
  if (text.length >= 6) needles.add(text);
}

export function buildPathNeedles({ outDir, pluginRoot } = {}) {
  const needles = new Set();
  pushNeedle(needles, REPO_ROOT);
  try {
    pushNeedle(needles, realpathSync(REPO_ROOT));
  } catch {
    /* keep REPO_ROOT */
  }
  pushNeedle(needles, path.join(REPO_ROOT, 'src'));
  pushNeedle(needles, path.join(REPO_ROOT, 'tests'));
  pushNeedle(needles, path.join(REPO_ROOT, '.tmp'));
  pushNeedle(needles, '.tmp/jobsss-productization');
  pushNeedle(needles, 'tests/fixtures');
  if (HOST_HOME && HOST_HOME !== '/tmp' && HOST_HOME !== '/' && HOST_HOME.length >= 6) {
    pushNeedle(needles, HOST_HOME);
  }
  if (outDir) pushNeedle(needles, path.resolve(outDir));
  if (pluginRoot) pushNeedle(needles, path.resolve(pluginRoot));
  return [...needles].sort((a, b) => b.length - a.length);
}

function excerptAt(buf, idx, needleLen, span = 72) {
  const start = Math.max(0, idx - 24);
  const end = Math.min(buf.length, idx + needleLen + span);
  return buf.subarray(start, end).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
}

export function findReleasePathLeaks(root, needles) {
  const leaks = [];
  for (const relRaw of listRelFiles(root)) {
    const abs = path.join(root, relRaw);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink()) continue;
    const rel = posixRel(relRaw);
    const buf = readFileSync(abs);
    for (const needle of needles) {
      const nbuf = Buffer.from(needle, 'utf8');
      const idx = buf.indexOf(nbuf);
      if (idx < 0) continue;
      leaks.push({
        rel,
        needle,
        excerpt: excerptAt(buf, idx, nbuf.length)
      });
    }
  }
  return leaks;
}

export function assertNoBuildPathLeakage({ outDir, pluginRoot }) {
  const needles = buildPathNeedles({ outDir, pluginRoot });
  const leaks = findReleasePathLeaks(outDir, needles);
  assert.deepEqual(
    leaks,
    [],
    `no release file or printable binary string may contain build-user/home/workspace/source/scratch/output paths: ${leaks.slice(0, 8).map(item => `${item.rel} contains ${item.needle} (${item.excerpt})`).join(' | ')}`
  );
}

export function assertReleasedRuntimeHasNoCheckoutDependency({ pluginRoot }) {
  const launcher = path.join(pluginRoot, 'bin', 'jobsss');
  assert.equal(existsSync(launcher), true, 'release missing bin/jobsss');
  const buf = readFileSync(launcher);
  const forbidden = [];
  const checkoutNeedles = [
    REPO_ROOT,
    'tests/fixtures',
    '.tmp/jobsss-productization'
  ];
  if (HOST_HOME && HOST_HOME !== '/tmp' && HOST_HOME.length >= 6) checkoutNeedles.push(HOST_HOME);
  try {
    checkoutNeedles.push(realpathSync(REPO_ROOT));
  } catch {
    /* keep REPO_ROOT */
  }
  for (const needle of [...new Set(checkoutNeedles)]) {
    const nbuf = Buffer.from(needle, 'utf8');
    const idx = buf.indexOf(nbuf);
    if (idx < 0) continue;
    forbidden.push(`${needle} at offset ${idx}: ${excerptAt(buf, idx, nbuf.length)}`);
  }
  assert.deepEqual(
    forbidden,
    [],
    `released runtime must not depend on the build checkout or tests/fixtures: ${forbidden.join(' | ')}`
  );
}

function walkManifestStrings(value, visit, trail = '$') {
  if (typeof value === 'string') {
    visit(value, trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkManifestStrings(item, visit, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkManifestStrings(child, visit, `${trail}.${key}`);
    }
  }
}

export function assertPortableReleaseEvidence(doc, { outDir, pluginRoot }) {
  const needles = buildPathNeedles({ outDir, pluginRoot });
  const hits = [];
  walkManifestStrings(doc, (text, trail) => {
    if (path.isAbsolute(text)) {
      hits.push(`${trail}=${text}`);
      return;
    }
    for (const needle of needles) {
      if (text.includes(needle)) hits.push(`${trail} contains ${needle}`);
    }
  });
  assert.deepEqual(
    hits,
    [],
    `release-manifest evidence fields must be portable/relative: ${hits.join('; ')}`
  );

  const binSha = sha256File(path.join(pluginRoot, 'bin', 'jobsss'));
  for (const entry of matrixTargets(doc)) {
    const id = String(entry.id || entry.target || entry.name || '').trim();
    const status = entryStatus(entry);
    if (status !== 'verified' && status !== 'built') continue;
    const sha = String(entry.evidence?.artifactSha256 || entry.artifactSha256 || '').trim().toLowerCase();
    assert.match(
      sha,
      /^[a-f0-9]{64}$/,
      `target ${id} status ${status} must record a real artifactSha256; null or missing hashes are untruthful`
    );
    const platform = String(entry.platform || entry.os || '');
    const arch = String(entry.arch || '');
    const matchesHost = (
      (platform === process.platform || (platform === 'linux' && process.platform === 'linux'))
      && (!arch || arch === process.arch)
    );
    if (id === 'current-host' || matchesHost) {
      assert.equal(
        sha,
        binSha,
        `target ${id} artifactSha256 must match released bin/jobsss`
      );
    }
  }
}

export function assertCompleteReleaseDeterminism(first, second) {
  const firstManifests = requireBothReleaseManifests(first.outDir, first.pluginRoot);
  const secondManifests = requireBothReleaseManifests(second.outDir, second.pluginRoot);
  const firstTree = hashedReleaseTree(first.outDir);
  const secondTree = hashedReleaseTree(second.outDir);
  assert.deepEqual(
    Object.keys(firstTree).sort(),
    Object.keys(secondTree).sort(),
    'repeated clean current-host releases must contain the same complete file set including both release-manifest.json copies'
  );
  assert.equal(
    firstManifests.sha256,
    secondManifests.sha256,
    'both release-manifest.json copies must be byte-identical across clean builds; wall-clock generatedAt and build-absolute paths are not justified unavoidable metadata'
  );
  assert.deepEqual(
    firstTree,
    secondTree,
    'repeated clean current-host releases must be byte-identical for the complete --out tree including both release-manifest.json copies; prefer no per-build metadata'
  );
}

export { isolate, assertNoJobosUse, readRequiredJson, pluginPath, REPO_ROOT };
