import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pluginPath } from './jobsss-gate0.mjs';

export const PACKAGING_LOCK_REL = 'src/packaging.lock.json';
export const OFFICIAL_NODE_VERSION = '22.22.3';
export const OFFICIAL_DIST_BASE = `https://nodejs.org/dist/v${OFFICIAL_NODE_VERSION}`;
export const OFFICIAL_SHASUMS_URL = `${OFFICIAL_DIST_BASE}/SHASUMS256.txt`;
export const OFFICIAL_SHASUMS_SHA256 =
  'b99296390cb403042da79c14d81e681076a9ac03af062d13f840dadc4ec751b3';

export const POSTJECT_PIN = Object.freeze({
  id: 'postject',
  name: 'postject',
  version: '1.0.0-alpha.6',
  url: 'https://registry.npmjs.org/postject/-/postject-1.0.0-alpha.6.tgz',
  sha256: 'd1447b53e87d49ddaf7fb3350c870afafa72760eca47f6d5cce4cefd537e7d92',
  source: 'https://github.com/nodejs/postject',
  docs: 'https://nodejs.org/docs/v22.22.3/api/single-executable-applications.html',
  buildOnly: true
});

export const OFFICIAL_NODE_INPUTS = Object.freeze([
  Object.freeze({
    id: 'linux-x64',
    target: 'linux-x64',
    version: OFFICIAL_NODE_VERSION,
    format: 'elf',
    arch: 'x64',
    platform: 'linux',
    url: `${OFFICIAL_DIST_BASE}/node-v${OFFICIAL_NODE_VERSION}-linux-x64.tar.xz`,
    archiveName: `node-v${OFFICIAL_NODE_VERSION}-linux-x64.tar.xz`,
    archiveSha256: '2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f',
    member: `node-v${OFFICIAL_NODE_VERSION}-linux-x64/bin/node`,
    executableName: 'node',
    executableSha256: 'e6ec2c188d83d813f81f2de8aea084d74dce603ac1abedd0a30ad941b10087b2',
    buildOnly: true
  }),
  Object.freeze({
    id: 'linux-arm64',
    target: 'linux-arm64',
    version: OFFICIAL_NODE_VERSION,
    format: 'elf',
    arch: 'arm64',
    platform: 'linux',
    url: `${OFFICIAL_DIST_BASE}/node-v${OFFICIAL_NODE_VERSION}-linux-arm64.tar.xz`,
    archiveName: `node-v${OFFICIAL_NODE_VERSION}-linux-arm64.tar.xz`,
    archiveSha256: '1c4a9933a5e45bc88f54f70b5f91232c127ec49f1a5989d23fb85824c7adf9b7',
    member: `node-v${OFFICIAL_NODE_VERSION}-linux-arm64/bin/node`,
    executableName: 'node',
    executableSha256: '41c1ec75816937af3893453a82b1535c566c65b682c67fbc59a0546b27c027bd',
    buildOnly: true
  }),
  Object.freeze({
    id: 'darwin-x64',
    target: 'darwin-x64',
    version: OFFICIAL_NODE_VERSION,
    format: 'macho',
    arch: 'x64',
    platform: 'darwin',
    url: `${OFFICIAL_DIST_BASE}/node-v${OFFICIAL_NODE_VERSION}-darwin-x64.tar.gz`,
    archiveName: `node-v${OFFICIAL_NODE_VERSION}-darwin-x64.tar.gz`,
    archiveSha256: '45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec',
    member: `node-v${OFFICIAL_NODE_VERSION}-darwin-x64/bin/node`,
    executableName: 'node',
    executableSha256: 'edc0e47adde954e891939bb509a62accdad5f6b15f32ec56ed78f9d6b7dd7308',
    buildOnly: true
  }),
  Object.freeze({
    id: 'darwin-arm64',
    target: 'darwin-arm64',
    version: OFFICIAL_NODE_VERSION,
    format: 'macho',
    arch: 'arm64',
    platform: 'darwin',
    url: `${OFFICIAL_DIST_BASE}/node-v${OFFICIAL_NODE_VERSION}-darwin-arm64.tar.gz`,
    archiveName: `node-v${OFFICIAL_NODE_VERSION}-darwin-arm64.tar.gz`,
    archiveSha256: '0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207',
    member: `node-v${OFFICIAL_NODE_VERSION}-darwin-arm64/bin/node`,
    executableName: 'node',
    executableSha256: '5d9d3872911e2340a43b707962e68143de8a4e8d54628845c0c4f2de1fb7cd5c',
    buildOnly: true
  }),
  Object.freeze({
    id: 'win-x64',
    target: 'win-x64',
    version: OFFICIAL_NODE_VERSION,
    format: 'pe',
    arch: 'x64',
    platform: 'win32',
    url: `${OFFICIAL_DIST_BASE}/node-v${OFFICIAL_NODE_VERSION}-win-x64.zip`,
    archiveName: `node-v${OFFICIAL_NODE_VERSION}-win-x64.zip`,
    archiveSha256: '6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33',
    member: `node-v${OFFICIAL_NODE_VERSION}-win-x64/node.exe`,
    executableName: 'node.exe',
    executableSha256: '780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b',
    buildOnly: true
  })
]);

export const CHECKSUM_FAIL_RE = /\b(checksum|sha-?256|sha256|mismatch|digest|hash)\b/i;
export const TOOL_FAIL_RE = /\b(postject|missing tool|unavailable|unsupported|signing|code.?sign)\b/i;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function nativeCacheDir() {
  return process.env.JOBSSS_NATIVE_CACHE || path.join(tmpdir(), 'jobsss-native-gate-cache');
}

export function packagingLockPath() {
  return pluginPath(PACKAGING_LOCK_REL);
}

export function assertChecksum(bytes, expected, label) {
  const actual = sha256(Buffer.from(bytes));
  assert.equal(
    actual,
    String(expected).toLowerCase(),
    `${label} SHA-256 mismatch: got ${actual} expected ${expected}`
  );
  return actual;
}

function runChecked(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${label} failed (exit ${result.status}): ${result.stderr || result.stdout || ''}`.slice(0, 800)
  );
  return result;
}

function downloadTo(url, dest) {
  const partial = `${dest}.partial`;
  rmSync(partial, { force: true });
  runChecked(
    'curl',
    ['-fsSL', '--retry', '3', '--retry-delay', '1', url, '-o', partial],
    `download ${url}`
  );
  writeFileSync(dest, readFileSync(partial));
  rmSync(partial, { force: true });
}

function extractMember(archivePath, member, destFile) {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const tmpOut = `${destFile}.extract`;
  rmSync(tmpOut, { force: true });
  if (archivePath.endsWith('.zip')) {
    const extracted = spawnSync('unzip', ['-p', archivePath, member], { maxBuffer: 200 * 1024 * 1024 });
    if (extracted.error) throw extracted.error;
    assert.equal(extracted.status, 0, `unzip ${member} failed: ${extracted.stderr}`);
    writeFileSync(tmpOut, extracted.stdout);
  } else {
    const dir = path.dirname(tmpOut);
    const args = archivePath.endsWith('.tar.xz')
      ? ['-xJf', archivePath, '-C', dir, member]
      : ['-xzf', archivePath, '-C', dir, member];
    runChecked('tar', args, `tar extract ${member}`);
    const extractedPath = path.join(dir, member);
    writeFileSync(tmpOut, readFileSync(extractedPath));
    rmSync(path.join(dir, member.split('/')[0]), { recursive: true, force: true });
  }
  writeFileSync(destFile, readFileSync(tmpOut));
  rmSync(tmpOut, { force: true });
}

export function officialInput(id) {
  const entry = OFFICIAL_NODE_INPUTS.find(item => item.id === id);
  assert.ok(entry, `unknown official Node input ${id}`);
  return entry;
}

export function ensureOfficialExecutable(id) {
  const entry = officialInput(id);
  const root = nativeCacheDir();
  mkdirSync(root, { recursive: true });
  const archivePath = path.join(root, entry.archiveName);
  if (!existsSync(archivePath) || sha256(readFileSync(archivePath)) !== entry.archiveSha256) {
    downloadTo(entry.url, archivePath);
  }
  assertChecksum(readFileSync(archivePath), entry.archiveSha256, entry.archiveName);

  const extractedDir = path.join(root, 'extracted', entry.id);
  const executablePath = path.join(extractedDir, entry.executableName);
  if (!existsSync(executablePath) || sha256(readFileSync(executablePath)) !== entry.executableSha256) {
    mkdirSync(extractedDir, { recursive: true });
    extractMember(archivePath, entry.member, executablePath);
  }
  const bytes = readFileSync(executablePath);
  assertChecksum(bytes, entry.executableSha256, `${entry.id} executable`);
  return {
    ...entry,
    archivePath,
    executablePath,
    bytes
  };
}

export function ensureAllOfficialExecutables() {
  return Object.fromEntries(OFFICIAL_NODE_INPUTS.map(entry => [entry.id, ensureOfficialExecutable(entry.id)]));
}

export function readPackagingLock() {
  const abs = packagingLockPath();
  assert.equal(existsSync(abs), true, `missing required product file ${PACKAGING_LOCK_REL}`);
  const text = readFileSync(abs, 'utf8');
  assert.ok(text.length < 64 * 1024, `${PACKAGING_LOCK_REL} must be a small lock manifest, not a binary cache`);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    assert.fail(`${PACKAGING_LOCK_REL} must be JSON: ${err.message}`);
  }
  return { abs, doc, text };
}

function lockRecords(doc) {
  const records = [];
  if (doc && typeof doc === 'object') {
    if (doc.tool) records.push({ kind: 'tool', ...doc.tool });
    if (Array.isArray(doc.tools)) {
      for (const tool of doc.tools) records.push({ kind: 'tool', ...tool });
    }
    const inputs = doc.inputs || doc.nodeInputs || doc.nodes || doc.officialNode;
    if (Array.isArray(inputs)) {
      for (const input of inputs) records.push({ kind: 'input', ...input });
    } else if (inputs && typeof inputs === 'object') {
      for (const [id, input] of Object.entries(inputs)) {
        records.push({ kind: 'input', id, ...input });
      }
    }
  }
  return records;
}

export function assertPackagingLockSchema(doc) {
  assert.equal(doc && typeof doc === 'object' && !Array.isArray(doc), true, `${PACKAGING_LOCK_REL} must be a JSON object`);
  const records = lockRecords(doc);
  const tool = records.find(entry => {
    const name = `${entry.id || ''} ${entry.name || ''}`.toLowerCase();
    return entry.kind === 'tool' && name.includes('postject');
  });
  assert.ok(tool, `${PACKAGING_LOCK_REL} must pin the Node-supported injection tool (postject) by identity`);
  assert.equal(String(tool.version || ''), POSTJECT_PIN.version, `${PACKAGING_LOCK_REL} must pin postject ${POSTJECT_PIN.version}`);
  assert.equal(String(tool.url || ''), POSTJECT_PIN.url, `${PACKAGING_LOCK_REL} must pin the official postject tarball URL`);
  assert.equal(
    String(tool.sha256 || tool.sha256sum || '').toLowerCase(),
    POSTJECT_PIN.sha256,
    `${PACKAGING_LOCK_REL} must pin postject SHA-256 ${POSTJECT_PIN.sha256}`
  );
  assert.notEqual(tool.buildOnly, false, 'injection tooling must be build-only');

  for (const required of OFFICIAL_NODE_INPUTS) {
    const input = records.find(entry => {
      if (entry.kind !== 'input') return false;
      const id = String(entry.id || entry.target || entry.name || '').trim();
      return id === required.id || id === required.target;
    });
    assert.ok(input, `${PACKAGING_LOCK_REL} must pin official Node input ${required.id}`);
    assert.equal(String(input.version || doc.nodeVersion || ''), required.version, `${required.id} version must be ${required.version}`);
    assert.equal(String(input.url || ''), required.url, `${required.id} must use the official Node dist URL`);
    assert.equal(
      String(input.sha256 || input.archiveSha256 || input.sha256sum || '').toLowerCase(),
      required.archiveSha256,
      `${required.id} must pin archive SHA-256 ${required.archiveSha256}`
    );
    const format = String(input.format || input.container || '').toLowerCase();
    const arch = String(input.arch || input.architecture || '').toLowerCase();
    if (format) assert.equal(format, required.format, `${required.id} format must be ${required.format}`);
    if (arch) assert.equal(arch === 'amd64' || arch === 'x86_64' ? 'x64' : arch, required.arch);
    assert.notEqual(input.buildOnly, false, `${required.id} must be build-only`);
  }
}

export function assertNoCommittedLargeArtifacts(repoRoot) {
  const skip = new Set(['.git', '.pi', '.tmp', 'node_modules', 'tmp']);
  const hits = [];
  function walk(dir, rel = '') {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, childRel);
        continue;
      }
      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        continue;
      }
      const looksLikeNode = /(node-v\d|node\.exe|\.tar\.(gz|xz)|postject-.*\.tgz|SHASUMS256)/i.test(entry.name);
      if (size > 512 * 1024 && looksLikeNode) hits.push(`${childRel} (${size} bytes)`);
      if (size > 8 * 1024 * 1024) hits.push(`${childRel} (${size} bytes)`);
    }
  }
  walk(repoRoot);
  assert.deepEqual(hits, [], `no official Node archive/executable, generated release binary, or tool cache may be committed: ${hits.join('; ')}`);
}
