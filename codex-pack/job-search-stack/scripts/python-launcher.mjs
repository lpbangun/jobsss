#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [script, ...args] = process.argv.slice(2);
if (!script) { console.error('python-launcher: script path required'); process.exit(2); }
const candidates = process.platform === 'win32'
  ? [
      process.env.PYTHON,
      path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
      'python.exe',
      'python3.exe'
    ]
  : [process.env.PYTHON, 'python3', 'python'];
for (const candidate of candidates.filter(Boolean)) {
  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
  const result = spawnSync(candidate, [script, ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env });
  if (!result.error) process.exit(result.status ?? 1);
  if (result.error.code !== 'ENOENT') { console.error(result.error.message); process.exit(1); }
}
console.error('python-launcher: no compatible Python runtime found');
process.exit(127);
