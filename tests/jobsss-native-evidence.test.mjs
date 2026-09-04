import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pluginPath, REPO_ROOT, readRequired } from './helpers/jobsss-gate0.mjs';
import {
  callRequest,
  initializeRequest,
  isolate,
  listRelFiles,
  mcp,
  requireOk
} from './helpers/jobsss-live-mcp.mjs';
import {
  OFFICIAL_NODE_INPUTS,
  POSTJECT_PIN,
  sha256
} from './helpers/jobsss-native-inputs.mjs';
import { VALIDATOR_PINS } from './helpers/jobsss-native-validators.mjs';
import { builderEnv, readReleaseManifest, resolveReleasePluginRoot, runRepoJobsss } from './helpers/jobsss-productization.mjs';

const CANONICAL_ARTIFACT_REL = 'evidence/native-validation.json';
const PUBLISHED_BASE_SHA = 'a380827d3cfd58c7c4dca014a109ead0326db18c';
const CANONICAL_CASES = Object.freeze(['darwin-x64', 'darwin-arm64', 'win-x64-before', 'win-x64-after']);
const ABSOLUTE_LEAK_RE = /\/tmp\/|\/var\/tmp\/|\/home\/|\/Users\/|[A-Za-z]:\\Users\\|file:\/\//i;
const TRANSIENT_HELPER_RE = /\/tmp\/gen-canonical-json\.mjs|gen-canonical-json\.mjs/;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function pluginTreeWithoutScratch() {
  return listRelFiles(REPO_ROOT).filter(rel => !rel.startsWith('.tmp/') && !rel.startsWith('tmp/'));
}

function runJobsss(args, env = {}, timeoutMs = 15_000) {
  const launcher = pluginPath('bin/jobsss');
  const result = spawnSync(launcher, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    code: result.status == null ? 1 : result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    signal: result.signal || null
  };
}

function combined(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function authoritativePluginVersion() {
  const plugin = JSON.parse(readRequired('plugin.json'));
  assert.match(String(plugin.version || ''), VERSION_RE, 'plugin.json must declare a semver product version');
  return plugin.version;
}

function extractVersion(text) {
  const match = String(text || '').match(/\b(?:v|version['":\s]+)([0-9]+\.[0-9]+\.[0-9]+)\b/i);
  return match ? match[1] : null;
}

function findCase(doc, caseId) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.case === caseId || doc.id === caseId) return doc;
  if (doc.cases && typeof doc.cases === 'object' && !Array.isArray(doc.cases) && doc.cases[caseId]) {
    return doc.cases[caseId];
  }
  const lists = [doc.cases, doc.results, doc.artifacts, doc.targets].filter(Array.isArray);
  for (const list of lists) {
    const hit = list.find(item => item && (item.case === caseId || item.id === caseId));
    if (hit) return hit;
  }
  for (const value of Object.values(doc)) {
    if (value && typeof value === 'object' && (value.case === caseId || value.id === caseId)) return value;
  }
  return null;
}

function extractCanonicalJsonBlock(text, caseId) {
  const marker = `"case":"${caseId}"`;
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = text.lastIndexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function readCanonicalArtifact() {
  const abs = pluginPath(CANONICAL_ARTIFACT_REL);
  assert.equal(
    existsSync(abs),
    true,
    `missing required canonical evidence artifact ${CANONICAL_ARTIFACT_REL}`
  );
  const bytes = readFileSync(abs);
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    assert.fail(`${CANONICAL_ARTIFACT_REL} must be canonical JSON: ${err.message}`);
  }
  return { abs, bytes, text: bytes.toString('utf8'), doc, sha256: sha256(bytes) };
}

function resourceTuple(entry) {
  assert.ok(entry && typeof entry === 'object', 'each PE resource must be an object');
  const type = String(entry.type ?? '');
  const name = String(entry.name ?? entry.id ?? '');
  const language = String(entry.language ?? entry.lang ?? '');
  const size = Number(entry.size ?? entry.byteSize);
  const digest = String(entry.sha256 ?? entry.hash ?? '').toLowerCase();
  assert.ok(type, 'PE resource tuple must include type');
  assert.ok(name, 'PE resource tuple must include name/identifier');
  assert.ok(language, 'PE resource tuple must include language');
  assert.equal(Number.isInteger(size) && size > 0, true, `PE resource ${type}/${name}/${language} must record exact byte size`);
  assert.match(digest, SHA256_RE, `PE resource ${type}/${name}/${language} must record SHA-256`);
  return { type, name, language, size, sha256: digest };
}

function tupleKey(tuple) {
  return `${tuple.type}/${tuple.name}/${tuple.language}/${tuple.size}/${tuple.sha256}`;
}

function peResources(doc) {
  const pe = doc.pe || doc;
  assert.ok(Array.isArray(pe.resources), 'PE case must include a complete resource inventory');
  return pe.resources.map(resourceTuple);
}

function assertNoTransientHelper(text, label) {
  assert.doesNotMatch(
    text,
    TRANSIENT_HELPER_RE,
    `${label} must not depend on /tmp/gen-canonical-json.mjs or any transient helper`
  );
}

function assertEvidenceCommandRecognized() {
  const help = runJobsss(['--help']);
  assert.equal(help.code, 0, `./bin/jobsss --help must exit 0: ${combined(help).slice(0, 400)}`);
  assert.match(
    help.stdout,
    /\bevidence\b/,
    './bin/jobsss --help must document the repository-contained evidence command'
  );
  const probe = runJobsss(['evidence']);
  const text = combined(probe);
  assert.doesNotMatch(
    text,
    /unknown command:\s*evidence/i,
    `./bin/jobsss evidence must be a real repository-contained command, not an unknown CLI verb: ${text.slice(0, 400)}`
  );
}

function runEvidence(outFile, cacheDir, extraEnv = {}, timeoutMs = 600_000) {
  return runJobsss(
    ['evidence', '--out', outFile],
    { JOBSSS_NATIVE_CACHE: cacheDir, ...extraEnv },
    timeoutMs
  );
}

test('B65 one authoritative version through plugin, CLI help/version, doctor, MCP initialize, and generated release-manifest', { timeout: 180_000 }, async t => {
  const version = authoritativePluginVersion();
  const help = runJobsss(['--help']);
  assert.equal(help.code, 0, `./bin/jobsss --help must exit 0: ${combined(help).slice(0, 400)}`);
  assert.match(help.stdout, new RegExp(`\\bv${version}\\b`), `CLI help must print authoritative version ${version}`);
  const cliVersion = runJobsss(['--version']);
  const versionText = combined(cliVersion);
  assert.match(
    versionText,
    new RegExp(`\\bv?${version}\\b`),
    `CLI --version/help-version output must report ${version}, not a drifted runtime version: ${versionText.slice(0, 400)}`
  );
  assert.doesNotMatch(
    versionText,
    /v0\.2\.0/,
    'CLI version surface must not print a second drifted 0.2.0 runtime version'
  );

  const ctx = isolate(t, 'jobsss-b65-version');
  const doctorCli = runJobsss(['doctor', '--data', ctx.dataDir], ctx.env);
  assert.equal(doctorCli.code, 0, `./bin/jobsss doctor --data must exit 0: ${combined(doctorCli).slice(0, 500)}`);
  let doctorDoc;
  try {
    doctorDoc = JSON.parse(doctorCli.stdout);
  } catch (err) {
    assert.fail(`doctor CLI must print JSON: ${err.message}: ${doctorCli.stdout.slice(0, 400)}`);
  }
  assert.equal(doctorDoc.version, version, `doctor CLI version must equal plugin.json ${version}, not ${doctorDoc.version}`);

  const session = await mcp(ctx, [
    initializeRequest(1),
    callRequest(2, 'doctor', {})
  ]);
  const initialize = session.frames.find(frame => frame.id === 1);
  assert.ok(initialize?.result, `MCP initialize failed: ${JSON.stringify(initialize || session.stderr)}`);
  const serverVersion = initialize.result.serverInfo && initialize.result.serverInfo.version;
  assert.equal(
    serverVersion,
    version,
    `MCP initialize.serverInfo.version must equal plugin.json ${version}, not ${serverVersion}`
  );
  const doctorMcp = requireOk(session, 2, 'MCP doctor');
  const mcpDoctorVersion = doctorMcp.version || extractVersion(JSON.stringify(doctorMcp));
  assert.equal(
    mcpDoctorVersion,
    version,
    `MCP doctor version must equal plugin.json ${version}, not ${mcpDoctorVersion}`
  );

  const outDir = path.join(ctx.parent, 'release-out');
  mkdirSync(outDir, { recursive: true });
  const released = await runRepoJobsss(
    ['release', '--out', outDir, '--target', 'current-host'],
    builderEnv(ctx.trap),
    { timeoutMs: 180_000 }
  );
  assert.equal(
    released.code,
    0,
    `current-host release must exit 0 so generated release-manifest.json can be read: ${combined(released).slice(0, 600)}`
  );
  const pluginRoot = resolveReleasePluginRoot(outDir);
  const manifest = readReleaseManifest(outDir, pluginRoot);
  assert.equal(
    manifest.doc.version,
    version,
    `generated release-manifest.json version must equal plugin.json ${version}, not ${manifest.doc.version}`
  );

  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    assert.ok(text.includes(version), `${rel} must record the single authoritative version ${version}`);
  }
});

test('B66 repository-contained evidence command uses explicit output and external cache without /tmp helpers or user state', { timeout: 30_000 }, () => {
  assertEvidenceCommandRecognized();
  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md', 'README.md', 'AGENTS.md']) {
    if (!existsSync(pluginPath(rel))) continue;
    assertNoTransientHelper(readFileSync(pluginPath(rel), 'utf8'), rel);
  }
  const srcRels = listRelFiles(pluginPath('src')).map(rel => path.join('src', rel));
  for (const rel of ['bin/jobsss', ...srcRels]) {
    const file = pluginPath(rel);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /jobsss-native-format|makeIndependentMacho|makeIndependentPe|makeMachoFixture|makePeFixture/,
      `${rel} evidence/packaging path must not import synthetic native fixtures or the in-repo parser`
    );
    assert.doesNotMatch(
      text,
      /tests\/helpers\/jobsss-native/,
      `${rel} must not depend on reviewer test helpers to reproduce native evidence`
    );
    assertNoTransientHelper(text, rel);
  }
  const help = runJobsss(['--help']);
  assert.match(
    help.stdout,
    /evidence[\s\S]{0,200}--out/,
    './bin/jobsss evidence must take an explicit caller-selected --out path'
  );
});

test('B67 empty-cache pinned downloads and two fresh processes emit byte-identical canonical JSON', { timeout: 600_000 }, async t => {
  assertEvidenceCommandRecognized();
  const ctx = isolate(t, 'jobsss-b67-evidence');
  const cacheA = path.join(ctx.parent, 'empty-cache-a');
  const cacheB = path.join(ctx.parent, 'empty-cache-b');
  mkdirSync(cacheA, { recursive: true });
  mkdirSync(cacheB, { recursive: true });
  assert.deepEqual(readdirSync(cacheA), [], 'first JOBSSS_NATIVE_CACHE must start empty');
  assert.deepEqual(readdirSync(cacheB), [], 'second JOBSSS_NATIVE_CACHE must start empty');
  const outA = path.join(ctx.parent, 'native-a.json');
  const outB = path.join(ctx.parent, 'native-b.json');
  const pluginBefore = pluginTreeWithoutScratch();

  const first = runEvidence(outA, cacheA);
  const firstText = combined(first);
  assert.equal(first.code, 0, `empty-cache ./bin/jobsss evidence --out must exit 0: ${firstText.slice(0, 800)}`);
  assert.equal(existsSync(outA), true, 'evidence command must write the caller-selected --out file');
  const second = runEvidence(outB, cacheB);
  const secondText = combined(second);
  assert.equal(second.code, 0, `second fresh-process empty-cache evidence command must exit 0: ${secondText.slice(0, 800)}`);
  const bytesA = readFileSync(outA);
  const bytesB = readFileSync(outB);
  assert.equal(
    bytesA.equals(bytesB),
    true,
    `two fresh-process evidence outputs must be byte-identical (${sha256(bytesA)} vs ${sha256(bytesB)})`
  );
  JSON.parse(bytesA.toString('utf8'));

  const committed = readCanonicalArtifact();
  assert.equal(
    sha256(bytesA),
    committed.sha256,
    `generated canonical JSON must match committed ${CANONICAL_ARTIFACT_REL}`
  );

  const cacheListing = readdirSync(cacheA, { recursive: true }).map(String);
  assert.ok(cacheListing.length > 0, 'empty-cache evidence must download pinned inputs into JOBSSS_NATIVE_CACHE');
  const cacheText = cacheListing.join('\n');
  assert.match(cacheText, /postject/, 'empty-cache evidence must download pinned postject');
  assert.match(cacheText, /pefile|macholib/, 'empty-cache evidence must download pinned independent validators');
  assert.equal(
    path.resolve(cacheA).startsWith(`${path.resolve(REPO_ROOT)}${path.sep}`),
    false,
    'JOBSSS_NATIVE_CACHE must stay outside the plugin tree'
  );
  assert.deepEqual(
    pluginTreeWithoutScratch(),
    pluginBefore,
    'evidence generation must not write caches, helpers, or user state into the plugin tree'
  );

  const mismatchCache = path.join(ctx.parent, 'mismatch-cache');
  mkdirSync(mismatchCache, { recursive: true });
  writeFileSync(path.join(mismatchCache, `postject-${POSTJECT_PIN.version}.tgz`), Buffer.from('not-the-pinned-postject'));
  const mismatchOut = path.join(ctx.parent, 'mismatch.json');
  const rejected = runEvidence(mismatchOut, mismatchCache, {}, 60_000);
  const rejectedText = combined(rejected);
  assert.notEqual(rejected.code, 0, `lock/checksum mismatch must fail before validation: ${rejectedText.slice(0, 600)}`);
  assert.match(
    rejectedText,
    /checksum|sha256|mismatch/i,
    `lock mismatch must name checksum/sha256/mismatch before validation: ${rejectedText.slice(0, 600)}`
  );
  assert.equal(existsSync(mismatchOut), false, 'checksum mismatch must not write canonical evidence output');
});

test('B68 canonical evidence artifact records Darwin/Windows provenance without absolute, temp, or user values', () => {
  const artifact = readCanonicalArtifact();
  const blob = JSON.stringify(artifact.doc);
  assert.doesNotMatch(artifact.text, ABSOLUTE_LEAK_RE, `${CANONICAL_ARTIFACT_REL} must not contain absolute/temp/user paths`);
  assert.doesNotMatch(artifact.text, TIMESTAMP_RE, `${CANONICAL_ARTIFACT_REL} must not contain timestamps`);
  assert.doesNotMatch(artifact.text, /api[_-]?key|authorization:|secret/i, `${CANONICAL_ARTIFACT_REL} must not contain credentials`);
  assert.doesNotMatch(
    artifact.text,
    /darwin-(?:x64|arm64)[^\n]{0,80}\bverified\b(?![^\n]*unverified)/i,
    `${CANONICAL_ARTIFACT_REL} must not claim macOS runtime verification`
  );
  assert.doesNotMatch(
    artifact.text,
    /win-x64[^\n]{0,80}\bverified\b(?![^\n]*unverified)/i,
    `${CANONICAL_ARTIFACT_REL} must not claim Windows runtime verification`
  );
  assert.ok(
    blob.includes(PUBLISHED_BASE_SHA) || artifact.text.includes(PUBLISHED_BASE_SHA),
    `${CANONICAL_ARTIFACT_REL} must identify published base ${PUBLISHED_BASE_SHA}`
  );
  assert.ok(
    blob.includes(authoritativePluginVersion()),
    `${CANONICAL_ARTIFACT_REL} must record the authoritative product version`
  );

  for (const caseId of CANONICAL_CASES) {
    const block = findCase(artifact.doc, caseId);
    assert.ok(block, `${CANONICAL_ARTIFACT_REL} must contain first-class case ${caseId}`);
  }

  for (const id of ['darwin-x64', 'darwin-arm64']) {
    const block = findCase(artifact.doc, id);
    const macho = block.macho || block;
    assert.equal(block.format || macho.format, 'macho', `${id} format must be macho`);
    assert.equal(block.arch || macho.arch, id.endsWith('arm64') ? 'arm64' : 'x64', `${id} architecture must be recorded`);
    assert.equal(macho.hasCodeSignature, false, `${id} must record LC_CODE_SIGNATURE removed`);
    assert.ok(macho.NODE_SEA || macho.NODE_SEA_BLOB, `${id} must record NODE_SEA / NODE_SEA_BLOB`);
    assert.match(String(macho.payloadSha256 || block.payloadSha256 || ''), SHA256_RE, `${id} must record payload SHA-256`);
    assert.equal(
      (macho.fuse && macho.fuse.enabled) || macho.fuseEnabled,
      true,
      `${id} fuse must be enabled`
    );
    assert.ok(macho.LINKEDIT || macho.linkedit, `${id} must record relocated __LINKEDIT`);
  }

  const winAfter = findCase(artifact.doc, 'win-x64-after');
  const pe = winAfter.pe || winAfter;
  assert.equal(winAfter.format || pe.format, 'pe');
  assert.equal(pe.FileAlignment || pe.fileAlignment, 0x200);
  assert.equal(pe.SectionAlignment || pe.sectionAlignment, 0x1000);
  assert.equal(pe.security?.fileOffset, 0);
  assert.equal(pe.security?.size, 0);
  assert.equal(typeof pe.computedSizeOfImage, 'number');
  assert.equal(pe.computedSizeOfImage, pe.SizeOfImage);

  assert.ok(blob.includes(POSTJECT_PIN.url) && blob.includes(POSTJECT_PIN.sha256));
  for (const pin of VALIDATOR_PINS) {
    assert.ok(blob.includes(pin.url), `${CANONICAL_ARTIFACT_REL} must record ${pin.id} URL`);
    assert.ok(blob.includes(pin.sha256), `${CANONICAL_ARTIFACT_REL} must record ${pin.id} SHA-256`);
    assert.ok(blob.includes(pin.version), `${CANONICAL_ARTIFACT_REL} must record ${pin.id} version`);
  }
  for (const id of ['darwin-x64', 'darwin-arm64', 'win-x64']) {
    const input = OFFICIAL_NODE_INPUTS.find(entry => entry.id === id);
    assert.ok(blob.includes(input.url), `${CANONICAL_ARTIFACT_REL} must record official ${id} URL`);
    assert.ok(blob.includes(input.archiveSha256), `${CANONICAL_ARTIFACT_REL} must record official ${id} archive SHA-256`);
    assert.ok(blob.includes(input.executableSha256), `${CANONICAL_ARTIFACT_REL} must record official ${id} executable SHA-256`);
    assert.ok(blob.includes(input.version), `${CANONICAL_ARTIFACT_REL} must record official ${id} version`);
    assert.ok(blob.includes(input.arch), `${CANONICAL_ARTIFACT_REL} must record official ${id} architecture`);
  }
  assert.match(artifact.text, /unsupported non-certificate overlay|non-certificate overlay/i);
});

test('B69 PE original resources are preserved by exact type/name/language/size/SHA-256 tuples with one NODE_SEA_BLOB addition', () => {
  const artifact = readCanonicalArtifact();
  const before = findCase(artifact.doc, 'win-x64-before');
  const after = findCase(artifact.doc, 'win-x64-after');
  assert.ok(before, `${CANONICAL_ARTIFACT_REL} must include win-x64-before`);
  assert.ok(after, `${CANONICAL_ARTIFACT_REL} must include win-x64-after`);
  const beforeTuples = peResources(before);
  const afterTuples = peResources(after);
  assert.ok(beforeTuples.length >= 4, 'official node.exe must expose original resources before injection');
  const beforeKeys = beforeTuples.map(tupleKey);
  const afterKeys = afterTuples.map(tupleKey);
  for (const tuple of beforeTuples) {
    assert.ok(
      afterKeys.includes(tupleKey(tuple)),
      `original PE resource ${tupleKey(tuple)} must be preserved with exact type, name, language, byte size, and SHA-256`
    );
  }
  const added = afterTuples.filter(tuple => !beforeKeys.includes(tupleKey(tuple)));
  assert.equal(added.length, 1, `exactly one PE resource may be added, found ${added.map(tupleKey).join(', ') || 'none'}`);
  assert.match(added[0].name, /NODE_SEA_BLOB/);
  assert.match(String(added[0].type), /RCDATA|RT_RCDATA|10/);
  const nodeSeaCount = afterTuples.filter(tuple => /NODE_SEA_BLOB/.test(tuple.name)).length;
  assert.equal(nodeSeaCount, 1, 'after injection there must be exactly one NODE_SEA_BLOB resource');

  const peAfter = after.pe || after;
  assert.equal(peAfter.security?.fileOffset, 0, 'Security directory file offset must be 0');
  assert.equal(peAfter.security?.size, 0, 'Security directory size must be 0');
  assert.equal(peAfter.certificateRestored, false, 'obsolete certificate bytes must be absent');
  assert.equal(typeof peAfter.computedSizeOfImage, 'number');
  assert.equal(peAfter.computedSizeOfImage, peAfter.SizeOfImage);
  assert.equal(peAfter.sectionRangesInBounds, true);
  assert.equal(peAfter.fuse?.enabled || peAfter.fuseEnabled, true);
  assert.match(String(peAfter.payloadSha256 || ''), SHA256_RE);
});

test('B70 reports reference the sole canonical artifact by relative path, SHA-256, and exact command without duplicated JSON', () => {
  const commandNeedle = './bin/jobsss evidence --out';
  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    assertNoTransientHelper(text, rel);
    assert.ok(text.includes(CANONICAL_ARTIFACT_REL), `${rel} must cite repository-relative path ${CANONICAL_ARTIFACT_REL}`);
    assert.ok(text.includes(commandNeedle), `${rel} must record exact runnable command ${commandNeedle} <absfile>`);
    assert.match(
      text,
      /JOBSSS_NATIVE_CACHE=/,
      `${rel} must document the caller-selected external JOBSSS_NATIVE_CACHE`
    );
    for (const caseId of CANONICAL_CASES) {
      const embedded = extractCanonicalJsonBlock(text, caseId);
      assert.equal(
        embedded,
        null,
        `${rel} must not manually duplicate complete canonical JSON for ${caseId}; cite ${CANONICAL_ARTIFACT_REL} instead`
      );
    }
    assert.ok(text.includes(PUBLISHED_BASE_SHA), `${rel} must identify published base ${PUBLISHED_BASE_SHA}`);
    assert.doesNotMatch(
      text,
      /final corrective SHA is [0-9a-f]{40}/i,
      `${rel} must not invent a future corrective commit SHA`
    );
  }

  const release = readFileSync(pluginPath('RELEASE_REPORT.md'), 'utf8');
  for (const id of ['darwin-x64', 'darwin-arm64', 'win-x64']) {
    const input = OFFICIAL_NODE_INPUTS.find(entry => entry.id === id);
    assert.ok(release.includes(input.url), `RELEASE_REPORT.md must record exact official ${id} URL ${input.url}`);
    assert.ok(release.includes(input.archiveSha256), `RELEASE_REPORT.md must record official ${id} archive SHA-256`);
    assert.ok(release.includes(input.executableSha256), `RELEASE_REPORT.md must record official ${id} executable SHA-256`);
  }

  const artifact = readCanonicalArtifact();
  for (const rel of ['PRODUCTIZATION_REVIEW.md', 'RELEASE_REPORT.md']) {
    const text = readFileSync(pluginPath(rel), 'utf8');
    assert.ok(text.includes(artifact.sha256), `${rel} must cite SHA-256 ${artifact.sha256} of ${CANONICAL_ARTIFACT_REL}`);
  }
});
