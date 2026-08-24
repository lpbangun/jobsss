import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  HUMAN_ONLY_DOMAIN_TOOLS,
  REPRESENTATIVE_AGENT_TOOLS
} from './helpers/jobsss-gate0.mjs';

const REAL_USER_STATE = [
  path.join(process.env.HOME || '', '.jobos'),
  '/home/logani/projects/Job App/.jobos',
  '/home/logani/projects/Job App/jobos-workspace'
];

function resolveJobosExecutable() {
  const override = process.env.JOBOS_BIN;
  if (override) {
    try {
      accessSync(override, fsConstants.X_OK);
      return override;
    } catch {
      return null;
    }
  }
  const directories = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = path.join(directory, 'jobos');
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

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

function runMcpSession(executable, workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['mcp'], {
      cwd: workspace,
      env: {
        ...process.env,
        JOBOS_HOME: workspace,
        JOBOS_LLM_PROVIDER: '',
        JOBOS_LLM_MODEL: '',
        JOBOS_LLM_API_KEY: '',
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: ''
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`jobos mcp timed out; stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`));
    }, 20_000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
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
      const initialize = frames.find(frame => frame.id === 1 && (frame.result || frame.error));
      const listed = frames.find(frame => frame.id === 2 && (frame.result || frame.error));
      if (initialize && listed) {
        child.stdin.end();
        child.kill('SIGTERM');
        finish();
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', error => finish(error));
    child.stdin.write(frameJsonl({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'jobsss-gate0', version: '0.0.0' }
      }
    }));
    child.stdin.write(frameJsonl({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }));
  });
}

test('B10 basic real JobOS MCP compatibility if executable exists', async t => {
  const executable = resolveJobosExecutable();
  if (!executable) {
    t.skip('jobos executable not resolvable from JOBOS_BIN or PATH; B10 skipped (B1–B9 still required)');
    return;
  }

  const workspace = mkdtempSync(path.join(tmpdir(), 'jobsss-gate0-mcp-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  for (const realState of REAL_USER_STATE) {
    assert.notEqual(path.resolve(workspace), path.resolve(realState));
  }

  const init = spawnSync(executable, ['init', '--json', '--workspace', workspace], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      JOBOS_HOME: workspace,
      JOBOS_LLM_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: ''
    }
  });
  assert.equal(init.status, 0, `jobos init failed in the temporary workspace: ${init.stderr || init.stdout}`);

  const session = await runMcpSession(executable, workspace);
  const frames = parseFrames(session.stdout);
  const initialize = frames.find(frame => frame.id === 1);
  const listed = frames.find(frame => frame.id === 2);
  assert.ok(initialize?.result, `initialize failed: ${JSON.stringify(initialize || session.stderr)}`);
  assert.equal(initialize.result.protocolVersion, '2024-11-05');
  assert.ok(listed?.result?.tools, `tools/list failed: ${JSON.stringify(listed || session.stderr)}`);

  const names = listed.result.tools.map(tool => tool.name);
  for (const tool of REPRESENTATIVE_AGENT_TOOLS) {
    assert.ok(names.includes(tool), `tools/list missing agent-eligible tool ${tool}`);
  }
  const leaked = HUMAN_ONLY_DOMAIN_TOOLS.filter(name => names.includes(name));
  assert.deepEqual(leaked, [], `human-only tools must not appear on MCP: ${leaked.join(', ')}`);
});
