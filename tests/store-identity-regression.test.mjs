import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { doctor, start } from '../src/domain.js';
import { loadStore, saveStore } from '../src/store.js';
import { startMcp } from '../src/mcp.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tempRoot(t, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `jobsss-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function legacyStore({ updatedAt = '2024-01-01T00:00:00.000Z' } = {}) {
  return {
    version: 2, schemaVersion: 2, revision: 3,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt,
    profiles: {}, proofPoints: {}, jobs: {}, scores: {}, applications: {}, artifacts: {}, audit: [],
  };
}

function rpcToolValue(frame) {
  const text = frame?.result?.content?.find(item => item.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

async function mcpDoctor(dataDir, scanRoots) {
  const input = new PassThrough();
  const frames = [];
  const server = startMcp({ dataDir, input, sendResponse: value => frames.push(value) });
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'doctor', arguments: scanRoots === undefined ? {} : { scanRoots },
  } })}\n`);
  await server.completed;
  return { frame: frames.find(item => item.id === 1), value: rpcToolValue(frames.find(item => item.id === 1)) };
}

test('read-only reads report missing store identity without generating or persisting one', t => {
  const dir = path.join(tempRoot(t, 'identity-read'), 'legacy');
  mkdirSync(dir);
  const storeFile = path.join(dir, 'store.json');
  const original = `${JSON.stringify(legacyStore(), null, 2)}\n`;
  writeFileSync(storeFile, original);

  const loaded = loadStore(dir);
  assert.equal(loaded.storeId, undefined, 'loadStore must not invent an ID for a legacy store');
  const first = doctor(dir);
  const second = doctor(dir);
  assert.equal(first.storeId, null);
  assert.equal(first.createdAt, '2024-01-01T00:00:00.000Z');
  assert.equal(first.revision, 3);
  assert.equal(first.storeIdentityMigrationPending, true);
  assert.equal(second.storeId, null, 'repeated diagnostics must remain read-only');
  assert.equal(readFileSync(storeFile, 'utf8'), original, 'reads must not rewrite store.json');
});

test('legacy contract identifiers normalize on read and persist only on the next trusted write', t => {
  const dir = path.join(tempRoot(t, 'identity-contract-read'), 'legacy');
  mkdirSync(dir);
  const storeFile = path.join(dir, 'store.json');
  const persistedBefore = legacyStore();
  persistedBefore.scores = { s1: { contract: 'jobos.fit-score.v1', reasoning: 'Keep jobos.fit-score.v1 as historical prose.' } };
  const original = `${JSON.stringify(persistedBefore, null, 2)}\n`;
  writeFileSync(storeFile, original);

  const loaded = loadStore(dir);
  assert.equal(loaded.storeId, undefined, 'identity is still not minted by read normalization');
  assert.equal(loaded.scores.s1.contract, 'jobsss.fit-score.v1');
  assert.equal(loaded.scores.s1.reasoning, persistedBefore.scores.s1.reasoning);
  assert.ok(loaded.audit.some(event => event.event === 'identity_contract_migration'));
  assert.equal(readFileSync(storeFile, 'utf8'), original, 'read normalization never rewrites canonical bytes');

  start(dir);
  const committed = JSON.parse(readFileSync(storeFile, 'utf8'));
  assert.equal(committed.scores.s1.contract, 'jobsss.fit-score.v1');
  assert.equal(committed.scores.s1.reasoning, persistedBefore.scores.s1.reasoning);
  assert.ok(committed.audit.some(event => event.event === 'identity_contract_migration'));
});

test('start backfills a stable UUID atomically and returns persisted identity metadata', t => {
  const dir = path.join(tempRoot(t, 'identity-backfill'), 'legacy');
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'store.json'), JSON.stringify(legacyStore()));

  const started = start(dir);
  assert.match(started.storeId, UUID);
  assert.equal(started.createdAt, '2024-01-01T00:00:00.000Z');
  assert.ok(Number.isInteger(started.revision));
  const persisted = JSON.parse(readFileSync(path.join(dir, 'store.json'), 'utf8'));
  assert.equal(persisted.storeId, started.storeId);
  assert.equal(persisted.createdAt, started.createdAt);
  assert.ok(persisted.audit.some(event => event.event === 'store_identity_backfill'));

  const afterStart = doctor(dir);
  const restarted = start(dir);
  assert.equal(afterStart.storeId, started.storeId);
  assert.equal(afterStart.storeIdentityMigrationPending, false);
  assert.equal(restarted.storeId, started.storeId, 'restart must retain the same workspace identity');
  assert.equal(restarted.createdAt, started.createdAt);
  const editedSnapshot = loadStore(dir);
  editedSnapshot.storeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  editedSnapshot.createdAt = '1999-01-01T00:00:00.000Z';
  saveStore(dir, editedSnapshot);
  assert.equal(doctor(dir).storeId, started.storeId, 'ordinary saved mutations cannot replace workspace identity');
  assert.equal(doctor(dir).createdAt, started.createdAt);
});

test('doctor marks incomplete identity metadata pending until a trusted write backfills it', t => {
  const dir = path.join(tempRoot(t, 'identity-date'), 'workspace');
  mkdirSync(dir);
  const store = { ...legacyStore(), storeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  delete store.createdAt;
  const storeFile = path.join(dir, 'store.json');
  const before = JSON.stringify(store);
  writeFileSync(storeFile, before);
  const diagnosis = doctor(dir);
  assert.equal(diagnosis.storeId, store.storeId);
  assert.equal(diagnosis.createdAt, null);
  assert.equal(diagnosis.storeIdentityMigrationPending, true);
  assert.equal(readFileSync(storeFile, 'utf8'), before);

  const started = start(dir);
  assert.equal(started.storeId, store.storeId);
  assert.match(started.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(doctor(dir).storeIdentityMigrationPending, false);
});

test('concurrent starts can never persist competing store identities', async t => {
  const dir = path.join(tempRoot(t, 'identity-concurrent'), 'workspace');
  const moduleUrl = new URL('../src/domain.js', import.meta.url).href;
  const script = `import { start } from ${JSON.stringify(moduleUrl)};
process.stdout.write('READY\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.includes('GO\\n')) {
    try { process.stdout.write(JSON.stringify({ ok: true, value: start(process.argv[1]) }) + '\\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code || null }) + '\\n'); }
  }
});`;
  const launch = () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], {
      cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let stderr = '';
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const done = new Promise((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('READY\n')) readyResolve();
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        const line = output.split(/\r?\n/).findLast(value => value.startsWith('{'));
        if (code !== 0 || !line) reject(new Error(`start process failed (${code}): ${stderr}${output}`));
        else resolve(JSON.parse(line));
      });
    });
    return { child, ready, done };
  };
  const workers = [launch(), launch()];
  await Promise.all(workers.map(worker => worker.ready));
  for (const worker of workers) worker.child.stdin.end('GO\n');
  const results = await Promise.all(workers.map(worker => worker.done));
  assert.ok(results.some(result => result.ok), `at least one start should commit: ${JSON.stringify(results)}`);
  for (const result of results) {
    if (!result.ok) assert.ok(['store_locked', 'EPERM', 'EACCES'].includes(result.code), `unexpected concurrent write failure: ${result.code}`);
    else assert.match(result.value.storeId, UUID);
  }
  const persisted = JSON.parse(readFileSync(path.join(dir, 'store.json'), 'utf8'));
  assert.match(persisted.storeId, UUID);
  assert.equal(doctor(dir).storeId, persisted.storeId);
});

test('explicit doctor scans identify selected and old stores, report errors, and skip symlinks', async t => {
  const root = tempRoot(t, 'identity-scan');
  const selected = path.join(root, 'selected');
  const alternate = path.join(root, 'old-copy');
  const broken = path.join(root, 'broken');
  const oversized = path.join(root, 'oversized');
  mkdirSync(selected);
  mkdirSync(alternate);
  mkdirSync(broken);
  mkdirSync(oversized);
  const selectedStart = start(selected);
  writeFileSync(path.join(alternate, 'store.json'), JSON.stringify({
    ...legacyStore({ updatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString() }),
    storeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }));
  writeFileSync(path.join(broken, 'store.json'), '{broken');
  writeFileSync(path.join(oversized, 'store.json'), Buffer.alloc(2 * 1024 * 1024 + 1));
  const external = path.join(tempRoot(t, 'identity-scan-external'), 'hidden');
  mkdirSync(external);
  writeFileSync(path.join(external, 'store.json'), JSON.stringify({ ...legacyStore(), storeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }));
  let linked = false;
  try { symlinkSync(external, path.join(root, 'linked'), 'dir'); linked = true; } catch { /* host disallows symlinks */ }

  const plain = doctor(selected);
  assert.deepEqual(plain.scans, [], 'doctor must not search disk when no scan roots were supplied');
  assert.deepEqual(plain.warnings, []);
  const inspected = doctor(selected, { scanRoots: [root] });
  assert.equal(inspected.storeId, selectedStart.storeId, 'the caller-selected PLUGIN_DATA identity stays prominent');
  const scan = inspected.scans[0];
  assert.ok(scan.candidates.some(candidate => candidate.selected && candidate.storeId === selectedStart.storeId));
  const old = scan.candidates.find(candidate => candidate.storeId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(old.isEmpty, true);
  assert.equal(old.initializationOnly, false, 'an old empty store is not a recent initialization candidate');
  assert.equal(old.assessment.certainty, 'low');
  assert.equal(inspected.possibleUnusedInitialStores.length, 0);
  assert.equal(inspected.warnings.length, 1, 'an initialization-only selected store plus another visible candidate warns');
  assert.match(scan.errors.map(item => item.message).join('\n'), /Cannot inspect store\.json/);
  assert.match(scan.errors.map(item => item.message).join('\n'), /scan limit/);
  if (linked) {
    assert.equal(scan.symlinksSkipped, 1);
    assert.ok(!scan.candidates.some(candidate => candidate.path.startsWith(external)), 'scanner must not traverse a symlink target');
    const linkedRoot = doctor(selected, { scanRoots: [path.join(root, 'linked')] }).scans[0];
    assert.match(linkedRoot.errors[0].message, /symlink/i, 'a caller-selected symlink root is refused');
  }
  assert.equal(existsSync(path.join(alternate, 'store.json')), true, 'doctor only reports stores; it never deletes them');
  assert.throws(() => doctor(selected, { scanRoots: Array(9).fill(root) }), { code: 'invalid_scan_roots' });

  const mcp = await mcpDoctor(selected, [root]);
  assert.ok(mcp.value?.storeId, `MCP doctor should return store identity: ${JSON.stringify(mcp.frame)}`);
  assert.equal(mcp.value.scans[0].candidates.length, scan.candidates.length);

  const cliScript = `import { runCli } from ${JSON.stringify(new URL('../src/cli.js', import.meta.url).href)}; runCli(process.argv.slice(1));`;
  const cli = spawnSync(process.execPath, ['--input-type=module', '-e', cliScript, 'doctor', '--data', selected, '--scan', root, '--scan', root], {
    cwd: repoRoot, encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const cliValue = JSON.parse(cli.stdout);
  assert.equal(cliValue.scans.length, 2, 'CLI doctor accepts repeated --scan roots');
});

test('recent empty legacy strays are low-certainty possible unused initial stores, even without IDs', t => {
  const root = tempRoot(t, 'identity-unused-initial');
  const selected = path.join(root, 'selected');
  const stray = path.join(root, 'stray');
  mkdirSync(selected);
  mkdirSync(stray);
  start(selected);
  const createdAt = new Date(Date.now() - 25_000).toISOString();
  writeFileSync(path.join(stray, 'store.json'), JSON.stringify({
    ...legacyStore({ updatedAt: new Date().toISOString() }),
    revision: 1,
    createdAt,
  }));

  const diagnosis = doctor(selected, { scanRoots: [root] });
  const candidate = diagnosis.scans[0].candidates.find(item => item.path === path.join(stray, 'store.json'));
  assert.equal(candidate.storeId, null);
  assert.equal(candidate.isEmpty, true);
  assert.equal(candidate.initializationOnly, true);
  assert.equal(candidate.possibleUnusedInitialStore, true);
  assert.equal(candidate.assessment.status, 'possible_unused_initial_store');
  assert.equal(candidate.assessment.certainty, 'low');
  assert.equal(diagnosis.possibleUnusedInitialStores.length, 1);
  assert.match(diagnosis.warnings.join(' '), /selected store looks initialization-only/i);
  assert.doesNotMatch(JSON.stringify(diagnosis), /abandoned/i, 'diagnostics must state uncertainty without asserting abandonment');
});

test('a depth-limited branch does not hide candidates in queued sibling directories', t => {
  const parent = tempRoot(t, 'identity-depth');
  const selected = path.join(parent, 'selected');
  const scanRoot = path.join(parent, 'scan');
  mkdirSync(selected);
  mkdirSync(scanRoot);
  start(selected);
  const deep = path.join(scanRoot, 'aa', 'bb', 'cc', 'dd');
  mkdirSync(deep, { recursive: true });
  mkdirSync(path.join(deep, 'too-deep'));
  const peer = path.join(scanRoot, 'zz', 'yy', 'xx', 'ww');
  mkdirSync(peer, { recursive: true });
  const peerStore = path.join(peer, 'store.json');
  writeFileSync(peerStore, JSON.stringify({
    ...legacyStore({ updatedAt: '2024-01-02T00:00:00.000Z' }),
    storeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  }));

  const scan = doctor(selected, { scanRoots: [scanRoot] }).scans[0];
  assert.equal(scan.truncated, true);
  assert.ok(scan.candidates.some(candidate => candidate.path === peerStore), 'queued sibling candidates remain visible');
  assert.match(scan.errors.map(item => item.message).join('\n'), /Maximum scan depth/);
});
