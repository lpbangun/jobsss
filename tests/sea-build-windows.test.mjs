import assert from 'node:assert/strict';
import test from 'node:test';
import { transformModule } from '../src/sea-build.js';

test('SEA transform accepts CRLF default and named imports', () => {
  const source = [
    "import fs from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    'export const marker = Boolean(fs && fileURLToPath);',
    '',
  ].join('\r\n');
  const transformed = transformModule(source, './fixture.js', process.cwd());
  assert.match(transformed.body, /const fs = __require\('node:fs'\)/);
  assert.match(transformed.body, /fileURLToPath/);
  assert.deepEqual(transformed.exportsList, ['marker']);
});
