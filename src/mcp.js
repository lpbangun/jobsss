// Bundled JobSSS MCP server — stdio JSON-RPC.
// Attributed port: framing and MCP lifecycle from JobOS src/mcp.js
// (initialize, tools/list, tools/call, Content-Length / JSONL framing),
// reimplemented for the standalone bundled runtime with isolated PLUGIN_DATA.
import { doctor, start, createProfile, importJob, listJobs, scoreJob, pursueJob, applicationsPlan, reviewQueue } from './domain.js';
import { ensureDataDir } from './store.js';

const TOOLS = [
  { name: 'doctor', description: 'Diagnose bundled ./bin/jobsss runtime and PLUGIN_DATA. Does not require JobOS.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'start', description: 'Initialize durable state under PLUGIN_DATA.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'create_profile', description: 'Create or import a local profile with optional resume.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resumePath: { type: 'string' }, path: { type: 'string' }, filePath: { type: 'string' } }, required: ['name'], additionalProperties: true } },
  { name: 'import_job', description: 'Import a local job fixture for a profile; deduplicates on content hash.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' }, path: { type: 'string' }, filePath: { type: 'string' } }, required: ['profileId'], additionalProperties: true } },
  { name: 'list_jobs', description: 'List imported jobs for a profile.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' } }, required: ['profileId'], additionalProperties: true } },
  { name: 'score_job', description: 'Score a job against a profile locally without API keys.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, profileId: { type: 'string' }, id: { type: 'string' } }, required: ['jobId', 'profileId'], additionalProperties: true } },
  { name: 'pursue_job', description: 'Record local pursuit for a job; never submits, sends, or applies.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, profileId: { type: 'string' }, id: { type: 'string' } }, required: ['jobId', 'profileId'], additionalProperties: true } },
  { name: 'applications_plan', description: 'Local pipeline/readiness plan for a job; never submits or sends.', inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, profileId: { type: 'string' }, id: { type: 'string' } }, required: ['jobId', 'profileId'], additionalProperties: true } },
  { name: 'review_queue', description: 'Local review queue for a profile.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' }, jobId: { type: 'string' } }, required: ['profileId'], additionalProperties: true } },
];

const toolNames = new Set(TOOLS.map(t => t.name));

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function parseDataDir(argv) {
  const idx = argv.indexOf('--data');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find(a => a.startsWith('--data='));
  if (eq) return eq.slice('--data='.length);
  if (process.env.PLUGIN_DATA) return process.env.PLUGIN_DATA;
  return null;
}

async function callTool(dataDir, name, args = {}) {
  if (!toolNames.has(name)) {
    const e = new Error(`Tool is not available: ${name}`);
    e.code = 'mcp_tool_not_available';
    throw e;
  }
  switch (name) {
    case 'doctor': return result(doctor(dataDir));
    case 'start': return result(start(dataDir));
    case 'create_profile': return result(createProfile(dataDir, args));
    case 'import_job': return result(importJob(dataDir, args));
    case 'list_jobs': return result(listJobs(dataDir, args));
    case 'score_job': return result(scoreJob(dataDir, args));
    case 'pursue_job': return result(pursueJob(dataDir, args));
    case 'applications_plan': return result(applicationsPlan(dataDir, args));
    case 'review_queue': return result(reviewQueue(dataDir, args));
    default: throw Object.assign(new Error(`Unknown tool ${name}`), { code: 'unknown_tool' });
  }
}

function send(message, framing = 'header') {
  const json = JSON.stringify(message);
  if (framing === 'jsonl') process.stdout.write(`${json}\n`);
  else process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

export function startMcp({ dataDir, input = process.stdin, sendResponse = send, handleRequest = null, maxRequestBytes = 1024 * 1024, maxHeaderBytes = 8 * 1024 } = {}) {
  if (!dataDir) throw new Error('Missing --data <dir> and PLUGIN_DATA');
  // Validate isolation before accepting requests; never create state in the plugin tree.
  dataDir = ensureDataDir(dataDir);

  let buffer = Buffer.alloc(0);
  let active = null;
  let ended = false;
  let closing = false;
  let settled = false;
  let resolveCompleted;
  const completed = new Promise(resolve => { resolveCompleted = resolve; });

  const detach = () => {
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('error', onError);
  };
  const finish = () => {
    if (settled || active) return;
    settled = true;
    detach();
    resolveCompleted();
  };
  const beginClose = ({ destroy = true } = {}) => {
    if (!closing) {
      closing = true;
      buffer = Buffer.alloc(0);
      detach();
      input.pause?.();
      if (destroy && input !== process.stdin && typeof input.destroy === 'function') input.destroy();
    }
    finish();
  };
  const parseError = (message, framing = 'header') => {
    sendResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message } }, framing);
    beginClose();
  };
  const nextFrame = () => {
    if (!buffer.length) return null;
    const prefix = buffer.toString('utf8', 0, Math.min(buffer.length, 15));
    if ('Content-Length:'.startsWith(prefix) || prefix.startsWith('Content-Length:')) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (buffer.length > maxHeaderBytes) throw Object.assign(new Error('MCP header exceeds limit'), { framing: 'header' });
        return null;
      }
      if (headerEnd > maxHeaderBytes) throw Object.assign(new Error('MCP header exceeds limit'), { framing: 'header' });
      const header = buffer.toString('utf8', 0, headerEnd);
      const match = header.match(/^Content-Length:\s*(\d+)\s*$/im);
      const length = Number(match?.[1]);
      if (!Number.isSafeInteger(length)) throw Object.assign(new Error('Missing Content-Length'), { framing: 'header' });
      if (length > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'header' });
      const bodyStart = headerEnd + 4;
      if (buffer.length - bodyStart < length) return null;
      const line = buffer.toString('utf8', bodyStart, bodyStart + length);
      return { line, framing: 'header', consumed: bodyStart + length };
    }
    const newline = buffer.indexOf('\n');
    if (newline < 0) {
      if (buffer.length > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'jsonl' });
      return null;
    }
    if (newline > maxRequestBytes) throw Object.assign(new Error('MCP request exceeds limit'), { framing: 'jsonl' });
    return { line: buffer.toString('utf8', 0, newline).trim(), framing: 'jsonl', consumed: newline + 1 };
  };
  const pump = () => {
    if (active || closing) return;
    let frame;
    try { frame = nextFrame(); } catch (error) { parseError(error.message, error.framing); return; }
    if (!frame) {
      if (ended) {
        if (buffer.length) parseError('Incomplete MCP request');
        else finish();
      } else input.resume?.();
      return;
    }
    buffer = buffer.subarray(frame.consumed);
    if (!frame.line) { pump(); return; }
    input.pause?.();
    const handler = handleRequest || handleLine;
    active = Promise.resolve(handler(dataDir, frame.line, msg => sendResponse(msg, frame.framing)))
      .catch(() => {})
      .finally(() => { active = null; if (closing) finish(); else pump(); });
  };
  const onData = chunk => {
    if (closing) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buffer.length + bytes.length > maxRequestBytes + maxHeaderBytes) { parseError('MCP input buffer exceeds limit'); return; }
    buffer = buffer.length ? Buffer.concat([buffer, bytes]) : Buffer.from(bytes);
    pump();
  };
  const onEnd = () => { ended = true; pump(); };
  const onError = () => beginClose({ destroy: false });
  input.on('data', onData);
  input.once('end', onEnd);
  input.once('error', onError);
  return { completed, close() { beginClose(); } };
}

async function handleLine(dataDir, line, respond) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }); return; }
  try {
    if (msg.method === 'initialize') {
      respond({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'jobsss-bundled', version: '0.1.0' }, capabilities: { tools: {} } } });
      return;
    }
    if (msg.method === 'notifications/initialized') return;
    if (msg.method === 'tools/list') { respond({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }); return; }
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      if (!toolNames.has(name)) {
        const error = new Error(`Tool is not available to MCP agents: ${name || '(missing name)'}`);
        error.code = 'mcp_tool_not_available';
        throw error;
      }
      respond({ jsonrpc: '2.0', id: msg.id, result: await callTool(dataDir, name, args || {}) });
      return;
    }
    respond({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  } catch (e) {
    const message = e?.code ? `${e.code}: ${e.message}` : e.message;
    respond({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32000, message, data: typeof e?.toJSON === 'function' ? e.toJSON() : undefined } });
  }
}

export function runFromArgv(argv = process.argv.slice(2)) {
  const dataDir = parseDataDir(argv);
  if (!dataDir) {
    console.error('jobsss mcp requires --data <dir> (or PLUGIN_DATA)');
    process.exit(2);
  }
  startMcp({ dataDir });
}

// If executed directly via node src/mcp.js
if (import.meta.url === `file://${process.argv[1]}`) {
  runFromArgv();
}
