// Independent supplemental closure acceptance; frozen before unknown-tool code correction.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { start } from '../src/domain.js';
import { startMcp } from '../src/mcp.js';

const names = ['closure_nonexistent_tool', 'constructor', 'toString', '__proto__', 'hasOwnProperty'];
function context(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-closure-tool-errors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  start(dir, {});
  // Compare every durable file and directory, not only selected store fields.
  const snapshot = () => fs.readdirSync(dir, { recursive: true }).sort().map(relative => {
    const file = path.join(dir, relative);
    return [relative, fs.statSync(file).isDirectory() ? null : fs.readFileSync(file).toString('base64')];
  });
  return { dir, snapshot };
}
async function wire(dir, messages) {
  const input = new PassThrough();
  const frames = [];
  // No handleRequest override: exercise production framing, handleLine and dispatch.
  const server = startMcp({ dataDir: dir, input, sendResponse: message => frames.push(message) });
  input.end(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
  await server.completed;
  return frames;
}
for (const [index, name] of names.entries()) {
  test(`unknown MCP tool ${name} is -32602, preserves request id and cannot mutate`, { timeout: 5000 }, async t => {
    const c = context(t);
    const before = c.snapshot();
    const id = index === 0 ? 0 : index === 3 ? null : `unknown-tool-${index}`;
    const frames = await wire(c.dir, [{ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } }]);
    assert.equal(frames.length, 1, 'exactly one response, not notification silence');
    assert.equal(frames[0].jsonrpc, '2.0');
    assert.equal(frames[0].id, id, 'preserve numeric, string and explicit null request ids');
    assert.equal(Object.hasOwn(frames[0], 'result'), false, 'never handler success or business tool result');
    assert.deepEqual(c.snapshot(), before, 'unknown tools must not mutate durable state');
    assert.equal(frames[0].error?.code, -32602, 'MCP 2024-11-05 unknown tool is an Invalid params protocol error');
  });
}
test('valid missing-id unknown-tool notifications stay silent without state mutation', { timeout: 5000 }, async t => {
  const c = context(t);
  const before = c.snapshot();
  const frames = await wire(c.dir, names.map(name => ({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: {} } })));
  assert.deepEqual(frames, []);
  assert.deepEqual(c.snapshot(), before);
});
