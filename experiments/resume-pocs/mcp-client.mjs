import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export function openMcp(dataDir) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../bin/jobsss', import.meta.url)), 'mcp', '--data', dataDir],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map(); let sequence = 0; let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`MCP exited ${code}: ${stderr.slice(-500)}`)));
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const p = pending.get(message.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); child.kill(); }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    async initialize() { await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'resume-pocs', version: '1' } }); },
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args });
      const text = result.content?.find(c => c.type === 'text')?.text;
      if (result.isError) throw new Error(`${name}: ${text}`);
      const value = JSON.parse(text);
      if (value.ok === false || value.error) throw new Error(`${name}: ${JSON.stringify(value)}`);
      return value;
    },
    close() { child.stdin.end(); child.kill(); },
  };
}
