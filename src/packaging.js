// JobSSS native-format packaging definitions.
//
// Single source of truth for the executable containers that a standalone
// release can target. Platform/build mechanics live in this module and are
// intentionally separated from MCP tools, domain behavior, scoring,
// authority, and client adapters: those modules never import or reimplement
// these definitions, and this module never imports them.
//
// Native mutation contract (B49, reviewer-owned):
//   All ELF / Mach-O / PE mutation goes through the pinned Node-supported
//   SEA injector `postject` recorded in src/packaging.lock.json (the
//   officially documented SEA flow: `--sentinel-fuse ...` and, for Mach-O,
//   `--macho-segment-name NODE_SEA`). No ad hoc binary rewriters live here;
//   the known malformed-output defects of the removed custom Mach-O/PE
//   mutators (zero-vmsize NODE_SEA segments, hardcoded PE section-header
//   appends, stale linkedit/symbol/dyld/code-signature offsets, stale
//   SizeOfImage, destroyed overlays/resources) are fixed by using the
//   pinned tool, not by patching around them.
//
//   Custom code in this module only:
//     - identifies and validates the target format/architecture,
//     - consults the checksum-pinned lock and verifies SHA-256 before use,
//     - acquires the pinned postject tarball into a temporary, gitignored
//       cache and verifies its checksum before extraction,
//     - orchestrates postject on a working copy of the base executable,
//     - classifies the PE signing/overlay state read-only BEFORE any tool
//       acquisition: an unsigned image or an image whose trailing overlay is
//       exactly its Security certificate table is injectable; any other
//       overlay fails clearly without mutating the input or running the
//       injector (the post-injection certificate would be invalid anyway),
//     - for a certificate-table-covered overlay (supported signed input),
//       stages ONLY a private unsigned copy (the two Security
//       certificate-table directory DWORDs are zeroed) so the pinned
//       injector's output never carries a stale certificate-table reference;
//       pinned postject drops the trailing certificate bytes itself
//       (LIEF build_overlay(false)) and matching-host re-signing is a later
//       Windows distribution step. No pre-injection signature bytes are ever
//       restored, appended, or re-pointed,
//     - fails clearly when the tool, network, or inputs are unavailable.
//
//   injectSeaPayload returns the pinned postject output bytes unchanged; the
//   only PE work product does is the read-only classification above and the
//   zeroing of the two Security-directory DWORDs in the private injection
//   working copy (never in the caller's input buffer).
//
// Determinism: identical (target, executable, blob) inputs yield
// byte-identical outputs (verified for the pinned postject). The module
// memoizes identical-input injections so repeated builds never re-run the
// injector; the memoized bytes are exactly what a fresh injection would
// produce (the determinism guarantee), so it cannot fabricate success.
//
// Cache: downloaded postject tarballs, extracted tool files, and the
// per-injection working copies live under the temporary cache directory
// (JOBSSS_NATIVE_CACHE or the OS temp dir), never inside the plugin tree.
// The released runtime inherits none of this: postject is build-only and
// never shipped, and the downloaded JobSSS release requires neither Node
// nor JobOS on PATH (B52).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
export const SEA_SEGMENT_NAME = 'NODE_SEA';

// Fragmented so the contiguous sentinel token never appears inside bundled
// runtime source: the SEA blob embeds the bundle, and the pinned injector
// requires exactly one sentinel occurrence in the final binary (the base
// executable carries it once; the blob must add none).
const SEA_FUSE_PREFIX = 'NODE_SEA_FUSE_';
const SEA_FUSE_TAIL = 'fce680ab2cc467b6e072b8b5df1996b2';
export const SEA_FUSE = SEA_FUSE_PREFIX + SEA_FUSE_TAIL;

export const TARGETS = Object.freeze([
  Object.freeze({ id: 'linux-x64', format: 'elf', arch: 'x64', platform: 'linux' }),
  Object.freeze({ id: 'linux-arm64', format: 'elf', arch: 'arm64', platform: 'linux' }),
  Object.freeze({ id: 'darwin-x64', format: 'macho', arch: 'x64', platform: 'darwin' }),
  Object.freeze({ id: 'darwin-arm64', format: 'macho', arch: 'arm64', platform: 'darwin' }),
  Object.freeze({ id: 'win-x64', format: 'pe', arch: 'x64', platform: 'win32' }),
]);

export function targetById(id) {
  const value = String(id || '').trim();
  return TARGETS.find(target => target.id === value) || null;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGING_LOCK_REL = 'packaging.lock.json';
export function packagingLockPath() {
  return path.join(MODULE_DIR, PACKAGING_LOCK_REL);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Lock consultation and checksum verification (B48).
// ---------------------------------------------------------------------------

export function readPackagingLock() {
  const abs = packagingLockPath();
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new Error(`packaging lock unreadable at ${PACKAGING_LOCK_REL}: ${error.message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`packaging lock ${PACKAGING_LOCK_REL} must be a JSON object`);
  }
  return doc;
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

export function postjectPin(doc) {
  const pin = lockRecords(doc).find(entry => {
    if (entry.kind !== 'tool') return false;
    const name = `${entry.id || ''} ${entry.name || ''}`.toLowerCase();
    return name.includes('postject');
  });
  if (!pin) fail(`packaging lock ${PACKAGING_LOCK_REL} must pin the Node-supported SEA injector (postject)`);
  return pin;
}

/**
 * Resolve the checksum-pinned official Node input for a concrete target id.
 * The release CLI uses this to require the exact locked executable (not just
 * a matching format/architecture) before any blob generation or injection
 * (reviewer B58).
 */
export function officialNodePin(targetId) {
  const doc = readPackagingLock();
  const inputs = Array.isArray(doc.officialNode) ? doc.officialNode : [];
  const pin = inputs.find(entry => (entry.target || entry.id) === targetId);
  if (!pin) {
    fail(`packaging lock ${PACKAGING_LOCK_REL} must pin an official Node input for target ${targetId}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(pin.executableSha256 || '').toLowerCase())) {
    fail(`packaging lock ${PACKAGING_LOCK_REL} must pin a 64-hex executableSha256 for target ${targetId}`);
  }
  return pin;
}

/**
 * Verify a pinned SHA-256 checksum before any download/extract/injection
 * uses the bytes. Throws a checksum/mismatch error, which callers surface
 * as a clear build failure that never reaches the injector (B48).
 */
export function verifyPinnedChecksum(bytes, sha256Hex) {
  const actual = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const expected = String(sha256Hex || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`checksum/sha256 mismatch: invalid pinned digest ${JSON.stringify(sha256Hex)}`);
  }
  if (actual !== expected) {
    throw new Error(`checksum/sha256 mismatch: got ${actual}, expected ${expected}`);
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Executable identification (strict format + architecture validation).
// ---------------------------------------------------------------------------

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;
const PE_SIGNATURE = Buffer.from('PE\0\0', 'latin1');

function readU16(buf, offset) { return buf.readUInt16LE(offset); }
function readU32(buf, offset) { return buf.readUInt32LE(offset); }
function readU64(buf, offset) { return Number(buf.readBigUInt64LE(offset)); }
function writeU32(buf, offset, value) { buf.writeUInt32LE(value, offset); }
function alignUp(value, alignment) { return Math.ceil(value / alignment) * alignment; }

export function identifyExecutable(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length >= 64 && buf.subarray(0, 4).equals(ELF_MAGIC)) {
    if (buf[4] !== 2) fail('invalid ELF: 64-bit executables are required');
    if (buf[5] !== 1) fail('invalid ELF: little-endian executables are required');
    const machine = readU16(buf, 18);
    const arch = machine === 62 ? 'x64' : machine === 183 ? 'arm64' : '';
    if (!arch) fail(`invalid ELF: unrecognized machine type ${machine}`);
    return { format: 'elf', arch, bits: 64 };
  }
  if (buf.length >= 32) {
    const magic = readU32(buf, 0);
    if (magic === MH_MAGIC_64 || magic === MH_CIGAM_64) {
      const littleEndian = magic === MH_MAGIC_64;
      const cpu = littleEndian ? readU32(buf, 4) : buf.readUInt32BE(4);
      const arch = cpu === CPU_ARM64 ? 'arm64' : cpu === CPU_X86_64 ? 'x64' : '';
      if (!arch) fail(`invalid Mach-O: unrecognized cputype 0x${cpu.toString(16)}`);
      return { format: 'macho', arch, bits: 64 };
    }
  }
  if (buf.length >= 0x40 && buf[0] === 0x4d && buf[1] === 0x5a) {
    const eLfanew = readU32(buf, 0x3c);
    if (eLfanew + 24 > buf.length || !buf.subarray(eLfanew, eLfanew + 4).equals(PE_SIGNATURE)) {
      fail('invalid PE: MZ image is missing a PE signature');
    }
    const machine = readU16(buf, eLfanew + 4);
    const arch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : '';
    if (!arch) fail(`invalid PE: unrecognized machine type 0x${machine.toString(16)}`);
    if (readU16(buf, eLfanew + 24) !== 0x20b) {
      fail('invalid PE: PE32+ (64-bit optional header) is required');
    }
    return { format: 'pe', arch, bits: 64 };
  }
  fail('unrecognized executable format');
}

// ---------------------------------------------------------------------------
// Temporary cache and pinned postject acquisition (build-only).
// ---------------------------------------------------------------------------

export function nativeToolCacheDir() {
  return process.env.JOBSSS_NATIVE_CACHE || path.join(os.tmpdir(), 'jobsss-native-gate-cache');
}

// Synchronous HTTPS download executed by a build-only child Node process so
// the public release/injection API stays synchronous (an async downloader
// returned a Promise that verifyPinnedChecksum rejected with
// ERR_INVALID_ARG_TYPE on an empty cache). The child streams the response to
// a temporary file and exits 0; the parent retries transient failures and
// reads the file back. HTTP status, redirect-loop, oversized-response, and
// child failures are surfaced as clear build errors before any checksum or
// extraction step.
const HTTPS_DOWNLOADER_SRC = [
  "'use strict';",
  '// Build-only synchronous HTTPS download child (never shipped in runtime bundles).',
  "const https = require('https');",
  "const fs = require('fs');",
  "const { URL } = require('url');",
  'const TARGET = process.argv[1];',
  'const MAX_BYTES = Number(process.argv[2] || 0);',
  'const OUT = process.argv[3];',
  'function fail(code, message) {',
  "  if (message) process.stderr.write(String(message) + '\\n');",
  '  process.exit(code);',
  '}',
  'function run(target, redirects) {',
  '  const req = https.get(target, (res) => {',
  "    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {",
  '      res.resume();',
  "      if (redirects >= 5) return fail(2, 'download redirect limit exceeded for ' + TARGET);",
  '      return run(new URL(res.headers.location, target).toString(), redirects + 1);',
  '    }',
  "    if (res.statusCode !== 200) {",
  '      res.resume();',
  "      return fail(3, 'download failed with HTTP ' + res.statusCode + ' for ' + TARGET);",
  '    }',
  '    const chunks = [];',
  '    let size = 0;',
  "    res.on('data', (chunk) => {",
  '      size += chunk.length;',
  "      if (MAX_BYTES > 0 && size > MAX_BYTES) {",
  '        req.destroy();',
  "        return fail(4, 'download exceeds ' + MAX_BYTES + ' bytes for ' + TARGET);",
  '      }',
  '      chunks.push(chunk);',
  '    });',
  "    res.on('end', () => {",
  '      try {',
  '        fs.writeFileSync(OUT, Buffer.concat(chunks));',
  '        process.exit(0);',
  '      } catch (error) {',
  '        fail(6, error.message);',
  '      }',
  "    });",
  "    res.on('error', (error) => fail(5, error.message));",
  '  });',
  "  req.on('error', (error) => fail(5, error.message));",
  '}',
  'run(TARGET, 0);',
  '',
].join('\n');

function httpsDownload(url, { maxBytes = 32 * 1024 * 1024, attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outPath = path.join(os.tmpdir(), `jobsss-download-${process.pid}-${attempt}-${Date.now()}.bin`);
    try {
      const child = spawnSync(
        process.execPath,
        ['-e', HTTPS_DOWNLOADER_SRC, String(url), String(maxBytes), outPath],
        { encoding: 'utf8', timeout: 300_000, maxBuffer: 1024 * 1024 }
      );
      if (child.error) {
        lastError = child.error;
        continue;
      }
      if (child.status !== 0) {
        const detail = String(child.stderr || child.stdout || '').trim().slice(0, 600);
        lastError = new Error(detail || `downloader exited ${child.status}`);
        continue;
      }
      if (!fs.existsSync(outPath)) {
        lastError = new Error('downloader produced no output file');
        continue;
      }
      return fs.readFileSync(outPath);
    } finally {
      try { fs.rmSync(outPath, { force: true }); } catch { /* best effort */ }
    }
  }
  throw new Error(`download failed for ${url}: ${lastError && lastError.message ? lastError.message : 'unknown error'}`);
}

/**
 * Extract a single tar member (512-byte ustar headers) from gunzipped
 * tar bytes. Only plain files are supported; GNU long-name entries are
 * handled for the npm tarball layout used by the pinned tool.
 */
export function extractTarMember(gunzipped, member) {
  const buf = Buffer.from(gunzipped);
  let offset = 0;
  let pendingLongName = null;
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512);
    offset += 512;
    if (block.every(byte => byte === 0)) continue;
    const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeOctal = block.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const typeflag = String.fromCharCode(block[156]);
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const padded = alignUp(size, 512);
    const content = buf.subarray(offset, offset + size);
    offset += padded;
    if (typeflag === 'L') {
      pendingLongName = content.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    const name = pendingLongName || rawName;
    pendingLongName = null;
    if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      if (name === member) return Buffer.from(content);
    }
  }
  return null;
}

/**
 * Build-only acquisition of the pinned postject injector. Downloads the
 * exact tarball from the lock when missing, verifies its pinned SHA-256
 * before extraction (and re-verifies an already-cached tarball), extracts
 * `package/dist/api.js`, and writes a static synchronous driver script.
 * Missing tools, checksum mismatches, and download failures fail clearly
 * before any injection.
 */
export function acquirePostject({ cacheDir = nativeToolCacheDir() } = {}) {
  const pin = postjectPin(readPackagingLock());
  const version = String(pin.version || '');
  assert(version, 'postject pin must record an exact version');

  fs.mkdirSync(cacheDir, { recursive: true });
  const tarballPath = path.join(cacheDir, `postject-${version}.tgz`);
  if (!fs.existsSync(tarballPath)) {
    const bytes = httpsDownload(String(pin.url));
    verifyPinnedChecksum(bytes, pin.sha256);
    const pending = `${tarballPath}.pending`;
    fs.writeFileSync(pending, bytes);
    fs.renameSync(pending, tarballPath);
  } else {
    // Reject checksum drift instead of silently reusing a corrupted cache.
    verifyPinnedChecksum(fs.readFileSync(tarballPath), pin.sha256);
  }

  const toolDir = path.join(cacheDir, `postject-${version}`);
  const apiPath = path.join(toolDir, 'dist', 'api.js');
  if (!fs.existsSync(apiPath)) {
    const member = extractTarMember(zlib.gunzipSync(fs.readFileSync(tarballPath)), 'package/dist/api.js');
    assert(member, `postject ${version} archive must contain package/dist/api.js`);
    fs.mkdirSync(path.dirname(apiPath), { recursive: true });
    const pending = `${apiPath}.pending`;
    fs.writeFileSync(pending, member);
    fs.renameSync(pending, apiPath);
  }

  const driverPath = path.join(toolDir, 'inject-driver.cjs');
  if (!fs.existsSync(driverPath)) {
    const pending = `${driverPath}.pending`;
    fs.writeFileSync(pending, INJECT_DRIVER_SRC);
    fs.renameSync(pending, driverPath);
  }
  return { apiPath, driverPath, pin };
}

const INJECT_DRIVER_SRC = [
  "'use strict';",
  "// Build-only postject SEA injection driver (never shipped in runtime bundles).",
  "const { inject } = require(process.argv[2]);",
  "const fs = require('fs');",
  `const RESOURCE = ${JSON.stringify(SEA_RESOURCE_NAME)};`,
  `const SENTINEL = ${JSON.stringify(SEA_FUSE_PREFIX)} + ${JSON.stringify(SEA_FUSE_TAIL)};`,
  "function fail(message) {",
  "  console.error(message && message.stack ? message.stack : String(message));",
  "  process.exit(1);",
  "}",
  "function run() {",
  "  const [apiPath, targetFile, blobFile, machoSegmentName] = process.argv.slice(2);",
  "  const options = { sentinelFuse: SENTINEL };",
  "  if (machoSegmentName && machoSegmentName !== 'none') {",
  "    options.machoSegmentName = machoSegmentName;",
  "  }",
  "  Promise.resolve()",
  "    .then(() => inject(targetFile, RESOURCE, fs.readFileSync(blobFile), options))",
  "    .then(() => process.exit(0), fail);",
  "}",
  "run();",
  '',
].join('\n');

function runPinnedInject({ driverPath, apiPath, executablePath, blobPath, machoSegmentName }) {
  const child = spawnSync(
    process.execPath,
    [driverPath, apiPath, executablePath, blobPath, machoSegmentName],
    { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }
  );
  if (child.error) {
    throw new Error(`postject injection failed to run: ${child.error.message}`);
  }
  if (child.status !== 0) {
    const detail = String(child.stderr || child.stdout || '').trim().slice(0, 600);
    throw new Error(`postject injection failed (exit ${child.status}): ${detail || 'no diagnostics'}`);
  }
}

// ---------------------------------------------------------------------------
// PE signing/overlay state classification (read-only staging, not injection).
//
// Pinned postject 1.0.0-alpha.6 rebuilds the PE with LIEF build_overlay(false),
// which drops trailing certificate bytes but leaves the Security
// certificate-table directory DWORDs pointing at bytes that are no longer a
// signature. A post-injection certificate copied from the input would be
// invalid (the image bytes it covers changed) — the auditor-identified
// defect. The safe contract is therefore:
//   - no trailing overlay and no Security directory: unsigned, injectable;
//   - a trailing overlay that is EXACTLY the Security certificate-table entry
//     (security file offset == raw end and sizes match): supported signed
//     input; the signature is stripped and must be re-applied on a matching
//     Windows host after injection, never preserved from the old image;
//   - any other overlay/malformed signing state: fail clearly, before any
//     tool acquisition or mutation, leaving the input bytes untouched.
// The injector input is staged privately only for the supported signed case:
// the two Security certificate-table directory DWORDs in the *working copy*
// are zeroed so postject's output carries no stale certificate-table
// reference. Pinned postject performs every structural mutation (resource
// rebuild, image sizing, section layout) and drops the certificate bytes
// itself; the caller's input buffer is never modified.
// ---------------------------------------------------------------------------

function peOverlayAndSecurity(buf) {
  const eLfanew = readU32(buf, 0x3c);
  const numberOfSections = readU16(buf, eLfanew + 6);
  const sizeOfOptionalHeader = readU16(buf, eLfanew + 20);
  const opt = eLfanew + 24;
  const sectBase = opt + sizeOfOptionalHeader;
  let rawEnd = 0;
  for (let i = 0; i < numberOfSections; i += 1) {
    const off = sectBase + i * 40;
    if (off + 40 > buf.length) break;
    rawEnd = Math.max(rawEnd, readU32(buf, off + 20) + readU32(buf, off + 16));
  }
  const numberOfRvaAndSizes = readU32(buf, opt + 108);
  const security = numberOfRvaAndSizes >= 5
    ? { fileOffset: readU32(buf, opt + 144), size: readU32(buf, opt + 148) }
    : { fileOffset: 0, size: 0 };
  const overlay = rawEnd < buf.length ? Buffer.from(buf.subarray(rawEnd)) : Buffer.alloc(0);
  return { rawEnd, opt, numberOfRvaAndSizes, security, overlay };
}

/**
 * Classify a PE image's signing/overlay state (read-only). Throws a clear
 * signing/overlay/unsupported error for any overlay that is not an empty
 * unsigned image or exactly the Security certificate-table entry, so no
 * injector runs and no input bytes are written for unsupported states.
 */
export function peSigningState(bytes) {
  const buf = Buffer.from(bytes);
  const info = peOverlayAndSecurity(buf);
  const { security, overlay, rawEnd } = info;
  if (security.size === 0 && overlay.length === 0) {
    return { state: 'unsigned', ...info };
  }
  if (security.size > 0 && security.fileOffset === rawEnd && overlay.length === security.size) {
    return { state: 'signed-supported', ...info };
  }
  throw new Error(
    `unsupported PE signing/overlay state: trailing overlay (${overlay.length} bytes at raw end ${rawEnd}) is not exactly the Security certificate-table entry (file offset ${security.fileOffset}, size ${security.size}); only an unsigned image or a certificate-table-covered overlay can be injected`
  );
}

/**
 * Build the private injection working copy for a supported signed PE: a
 * byte-identical copy except that the Security certificate-table directory
 * DWORDs are zeroed. The trailing certificate bytes stay in the staged file
 * and are dropped by pinned postject's documented overlay handling; no
 * pre-injection signature bytes are ever restored into the output.
 */
export function stagePeUnsigned(bytes, state) {
  const staged = Buffer.from(bytes);
  if (state && state.numberOfRvaAndSizes >= 5) {
    writeU32(staged, state.opt + 144, 0);
    writeU32(staged, state.opt + 148, 0);
  }
  return staged;
}

// ---------------------------------------------------------------------------
// Identical-input memo (determinism cache).
// ---------------------------------------------------------------------------

const MEMO_CAPACITY = 64;
const memo = new Map();

function memoKey(targetId, executable, blob) {
  const hash = crypto.createHash('sha256');
  hash.update(String(targetId));
  hash.update(executable);
  hash.update(blob);
  return hash.digest('hex');
}

function memoLookup(key) {
  const hit = memo.get(key);
  if (hit) {
    // Refresh recency.
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  return null;
}

function memoStore(key, bytes) {
  if (memo.has(key)) memo.delete(key);
  memo.set(key, Buffer.from(bytes));
  while (memo.size > MEMO_CAPACITY) {
    const oldest = memo.keys().next().value;
    memo.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Public injection entry: strict validation + pinned postject orchestration.
// ---------------------------------------------------------------------------

export function injectSeaPayload({ target, executable, blob } = {}) {
  const targetId = String(target || '').trim();
  const definition = targetById(targetId);
  if (!definition) {
    throw new Error(
      `unsupported target ${targetId || '<empty>'}; expected one of ${TARGETS.map(entry => entry.id).join(', ')}`
    );
  }
  if (!Buffer.isBuffer(blob)) blob = Buffer.from(blob || []);
  if (blob.length === 0) {
    throw new Error('invalid SEA blob: blob bytes are required');
  }
  if (!Buffer.isBuffer(executable)) executable = Buffer.from(executable || []);
  const ident = identifyExecutable(executable);
  if (ident.format !== definition.format) {
    throw new Error(
      `mismatched container: ${ident.format}/${ident.arch} executable was provided but target ${targetId} requires ${definition.format}/${definition.arch}`
    );
  }
  if (ident.arch !== definition.arch) {
    throw new Error(
      `wrong architecture: ${ident.format}/${ident.arch} executable was provided but target ${targetId} requires ${definition.format}/${definition.arch}`
    );
  }

  // PE signing/overlay classification runs BEFORE memo and BEFORE any tool
  // acquisition: an unsupported overlay fails clearly without downloading or
  // running the pinned injector and never touches the caller's input buffer.
  let peSigning = null;
  if (definition.format === 'pe') {
    peSigning = peSigningState(executable);
  }

  const key = memoKey(targetId, executable, blob);
  const cached = memoLookup(key);
  if (cached) return cached;

  const { apiPath, driverPath } = acquirePostject();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsss-inject-'));
  const executablePath = path.join(work, 'base');
  const blobPath = path.join(work, 'sea.blob');
  try {
    // Only the supported signed-PE case differs: the private working copy
    // has its Security certificate-table directory zeroed (stagePeUnsigned);
    // every other input is written byte-for-byte. The caller's buffer is
    // never mutated and the returned bytes are the pinned postject output
    // unchanged.
    const injectBase = definition.format === 'pe' && peSigning.state === 'signed-supported'
      ? stagePeUnsigned(executable, peSigning)
      : executable;
    fs.writeFileSync(executablePath, injectBase);
    fs.writeFileSync(blobPath, blob);
    const machoSegmentName = definition.format === 'macho' ? SEA_SEGMENT_NAME : 'none';
    runPinnedInject({ driverPath, apiPath, executablePath, blobPath, machoSegmentName });
    const output = Buffer.from(fs.readFileSync(executablePath));
    memoStore(key, output);
    return output;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}