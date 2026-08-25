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
import {
  HUMAN_ONLY_DOMAIN_TOOLS,
  REPO_ROOT,
  pluginPath,
  readRequiredJson
} from './helpers/jobsss-gate0.mjs';

const STANDALONE_SERVER_NAME = 'jobsss';
const STANDALONE_COMMAND = './bin/jobsss';
const STANDALONE_ARGS = Object.freeze(['mcp', '--data', '${PLUGIN_DATA}']);
const REQUIRED_JOURNEY_TOOLS = Object.freeze([
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
const BLOCKED_MCP_TOOLS = Object.freeze([
  ...HUMAN_ONLY_DOMAIN_TOOLS,
  'submit_application_form',
  'inspect_application_form',
  'assist_application_form'
]);

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

export function makeIsolatedEnv(dataDir, trap) {
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

export function makeJobosTrap(parent) {
  const dir = path.join(parent, 'bin');
  mkdirSync(dir, { recursive: true });
  const marker = path.join(parent, 'jobos-trap-fired');
  const script = path.join(dir, 'jobos');
  writeFileSync(
    script,
    `#!/bin/sh\nprintf 'jobos-trap\\n' >> "$JOBSSS_JOBOS_TRAP"\nexit 66\n`
  );
  chmodSync(script, 0o755);
  return {
    dir,
    marker,
    home: path.join(parent, 'home'),
    jobosHome: path.join(parent, 'jobos-home')
  };
}

export function assertNoJobosUse(trap, pluginBefore, jobAppBefore) {
  assert.equal(existsSync(trap.marker), false, 'bundled runtime must not resolve or execute jobos');
  assert.deepEqual(listRelFiles(trap.jobosHome), [], 'JOBOS_HOME must remain unused');
  assert.equal(existsSync(path.join(trap.home, '.jobos')), false, 'must not write ~/.jobos');
  const pluginAfter = listRelFiles(REPO_ROOT);
  const created = pluginAfter.filter(rel => !pluginBefore.includes(rel) && !rel.startsWith('tests/fixtures/'));
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

test('B10 real bundled MCP initialize and tools with jobos absent', async t => {
  const { launcher, argsTemplate } = resolveStandaloneLauncher();
  const parent = mkdtempSync(path.join(tmpdir(), 'jobsss-gate0-mcp-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dataDir = path.join(parent, 'plugin-data');
  mkdirSync(dataDir, { recursive: true });
  const trap = makeJobosTrap(parent);
  mkdirSync(trap.home, { recursive: true });
  mkdirSync(trap.jobosHome, { recursive: true });
  for (const realState of REAL_USER_STATE) {
    assert.notEqual(path.resolve(dataDir), path.resolve(realState));
  }
  const pluginBefore = listRelFiles(REPO_ROOT);
  const jobAppBefore = Object.fromEntries(REAL_USER_STATE.map(abs => [abs, snapshotPath(abs)]));

  const session = await runMcpRequests(
    launcher,
    expandDataArgs(argsTemplate, dataDir),
    makeIsolatedEnv(dataDir, trap),
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'jobsss-gate0', version: '0.0.0' }
        }
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      }
    ]
  );

  const initialize = session.frames.find(frame => frame.id === 1);
  const listed = session.frames.find(frame => frame.id === 2);
  assert.ok(initialize?.result, `initialize failed: ${JSON.stringify(initialize || session.stderr)}`);
  assert.equal(initialize.result.protocolVersion, '2024-11-05');
  assert.ok(listed?.result?.tools, `tools/list failed: ${JSON.stringify(listed || session.stderr)}`);
  const names = listed.result.tools.map(tool => tool.name);
  for (const tool of REQUIRED_JOURNEY_TOOLS) {
    assert.ok(names.includes(tool), `tools/list missing journey tool ${tool}`);
  }
  const leaked = BLOCKED_MCP_TOOLS.filter(name => names.includes(name));
  assert.deepEqual(leaked, [], `blocked tools must not appear on MCP: ${leaked.join(', ')}`);
  assertNoJobosUse(trap, pluginBefore, jobAppBefore);
});
